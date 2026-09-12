import type { DeviceKind, SyncMessage, SyncPeer } from "@dbk/protocol";
import {
  PROTOCOL_VERSION,
  REMOTE_DEVICE_NAME,
  masterSessionUpdate,
  parseSyncMessage
} from "@dbk/protocol";
import { isNativeApp } from "./platform";
import {
  httpSyncOrigin,
  parseSyncHostname,
  PRACTICE_SHARE_PORT,
  practiceSharePageOrigin,
  SYNC_PORT,
  syncSocketUrls
} from "./sync-host";

export { PRACTICE_SHARE_PORT, SYNC_PORT };
export const MASTER_HOST_KEY = "dbk-master-host";
export const STAGE_NAME_KEY = "dbk-stage-name";

export type SyncLinkState = {
  connected: boolean;
  hosting: boolean;
  endpoint: string | null;
  peerCount: number;
  peers: SyncPeer[];
};

export function clientDeviceName(): string {
  if (typeof navigator === "undefined") return "Client";
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone/i.test(ua)) return "iPhone";
  return "Client";
}

function isFollowerKind(kind: DeviceKind): boolean {
  return kind === "client" || kind === "remote";
}

function clientPeerCount(peers: readonly SyncPeer[]): number {
  return peers.filter((peer) => peer.deviceKind === "client").length;
}

const connections = new Set<string>();
let socket: WebSocket | null = null;
let sendImpl: (message: SyncMessage) => void = () => {};
let lastShow = "";
let lastPosition = "";
let reconnectTimer = 0;
let allowReconnect = false;
let seenMasterSessionId: string | null = null;
let nativeServerStarted = false;
let nativeListenersBound = false;
let httpEpoch = 0;
let linkState: SyncLinkState = {
  connected: false,
  hosting: false,
  endpoint: null,
  peerCount: 0,
  peers: []
};
const linkListeners = new Set<(state: SyncLinkState) => void>();

function setLink(patch: Partial<SyncLinkState>): void {
  linkState = { ...linkState, ...patch };
  for (const listener of linkListeners) listener(linkState);
}

export function getSyncLinkState(): SyncLinkState {
  return linkState;
}

export function subscribeSyncLink(listener: (state: SyncLinkState) => void): () => void {
  linkListeners.add(listener);
  listener(linkState);
  return () => {
    linkListeners.delete(listener);
  };
}

export async function refreshJoinAddress(): Promise<string | null> {
  const address = await nativeJoinAddress();
  if (address) setLink({ endpoint: address });
  return address;
}

export function sendSyncMessage(message: SyncMessage): void {
  sendImpl(message);
}

export function rememberOutgoing(message: SyncMessage, raw = JSON.stringify(message)): void {
  if (message.type === "LoadGig") lastShow = raw;
  if (message.type === "Position") lastPosition = raw;
  if (message.type === "Stop") lastPosition = "";
  if (message.type === "LoadSong" && lastPosition) {
    try {
      lastPosition = JSON.stringify({
        ...(JSON.parse(lastPosition) as Record<string, unknown>),
        songId: message.songId,
        setlistEntryId: message.setlistEntryId,
        playing: false
      });
    } catch {
      lastPosition = "";
    }
  }
}

function lanInterfaceRank(name: string): number {
  if (name === "en0") return 0;
  if (name.startsWith("en")) return 1;
  if (name.startsWith("pdp_ip") || name.startsWith("bridge")) return 3;
  return 2;
}

async function lanAddress(): Promise<string | null> {
  try {
    const { SyncSocket } = await import("./sync-socket");
    const result = await SyncSocket.lanAddress();
    if (result.address) return result.address;
  } catch {
    // fall through to the Capacitor plugin if the native hub is missing
  }
  try {
    const { WebsocketServer } = await import("capacitor-websocket-server");
    const interfaces = await WebsocketServer.getInterfaces();
    const names = Object.keys(interfaces).sort((left, right) => lanInterfaceRank(left) - lanInterfaceRank(right));
    for (const name of names) {
      if (name.startsWith("lo") || name.startsWith("utun") || name.startsWith("awdl")) continue;
      const ip = interfaces[name]?.ipv4Addresses?.find(
        (address) => !address.startsWith("127.") && !address.startsWith("169.254.")
      );
      if (ip) return ip;
    }
  } catch {
    return null;
  }
  return null;
}

export async function nativeJoinAddress(): Promise<string | null> {
  if (!isNativeApp()) return null;
  try {
    const ip = await lanAddress();
    return ip ? `${ip}:${SYNC_PORT}` : null;
  } catch {
    return null;
  }
}

type SyncHooks = {
  deviceKind: () => DeviceKind;
  deviceName?: () => string;
  syncHost?: string | null | (() => string | null | undefined);
  onMasterOpen: () => void;
  onClientHello: () => void;
  onMasterSessionReset?: () => void;
  onClientSync: (message: SyncMessage) => void;
};

function masterBootSessionId(): string {
  const key = "__dbkMasterSessionId";
  const store = globalThis as typeof globalThis & { __dbkMasterSessionId?: string };
  store.__dbkMasterSessionId ??= crypto.randomUUID();
  return store.__dbkMasterSessionId;
}

function hookSyncHost(hooks: SyncHooks): string {
  const raw = typeof hooks.syncHost === "function" ? hooks.syncHost() : hooks.syncHost;
  return raw?.trim() ?? "";
}

function handleIncoming(message: SyncMessage, hooks: SyncHooks, fromPeer = false): void {
  if (message.type === "Peers") {
    setLink({ peers: message.peers, peerCount: clientPeerCount(message.peers) });
    if (isFollowerKind(hooks.deviceKind())) {
      const update = masterSessionUpdate(seenMasterSessionId, message.masterSessionId);
      seenMasterSessionId = update.sessionId;
      if (update.restarted) hooks.onMasterSessionReset?.();
    }
    return;
  }
  if (hooks.deviceKind() === "master") {
    if (
      fromPeer &&
      message.type === "Hello" &&
      (message.deviceKind === "client" || message.deviceKind === "remote")
    ) {
      hooks.onClientHello();
    }
    if (fromPeer && message.type === "SetlistEdit") {
      hooks.onClientSync(message);
    }
    if (fromPeer && (message.type === "RemoteControl" || message.type === "RemoteMixer")) {
      hooks.onClientSync(message);
    }
    return;
  }
  if (message.type === "Hello" && message.deviceKind === "master") {
    const update = masterSessionUpdate(seenMasterSessionId, message.sessionId);
    seenMasterSessionId = update.sessionId;
    if (update.restarted) {
      hooks.onMasterSessionReset?.();
      return;
    }
  }
  hooks.onClientSync(message);
}

const nativePeers = new Map<string, SyncPeer>();
let sendNativeRaw: ((uuid: string, message: string) => void) | null = null;

function publishNativeRoster(): void {
  const peers = [...nativePeers.values()];
  const raw = JSON.stringify({
    type: "Peers",
    peers,
    masterSessionId: masterBootSessionId()
  });
  setLink({ peers, peerCount: clientPeerCount(peers) });
  for (const uuid of connections) sendNativeRaw?.(uuid, raw);
}

async function startNativeMaster(hooks: SyncHooks): Promise<string | null> {
  const { SyncSocket } = await import("./sync-socket");
  sendNativeRaw = (uuid, message) => {
    void SyncSocket.hostSend({ uuid, message });
  };
  if (!nativeListenersBound) {
    nativeListenersBound = true;
    await SyncSocket.addListener("hostOpen", (event) => {
      const uuid = String(event.uuid ?? "");
      if (!uuid) return;
      connections.add(uuid);
      setLink({ connected: true, hosting: true, peerCount: clientPeerCount(linkState.peers) });
      if (lastShow) void SyncSocket.hostSend({ uuid, message: lastShow });
      if (lastPosition) void SyncSocket.hostSend({ uuid, message: lastPosition });
    });
    await SyncSocket.addListener("hostClose", (event) => {
      const uuid = String(event.uuid ?? "");
      connections.delete(uuid);
      nativePeers.delete(uuid);
      publishNativeRoster();
    });
    await SyncSocket.addListener("hostMessage", (event) => {
      const uuid = String(event.uuid ?? "");
      const raw = String(event.message ?? event.data ?? "");
      const message = parseSyncMessage(raw);
      if (!message) return;
      rememberOutgoing(message, raw);
      if (message.type === "Hello") {
        for (const [id, peer] of nativePeers) {
          if (peer.deviceId === message.deviceId) nativePeers.delete(id);
        }
        nativePeers.set(uuid, {
          deviceId: message.deviceId,
          deviceKind: message.deviceKind,
          deviceName: message.deviceName
        });
        publishNativeRoster();
      }
      for (const peer of connections) {
        if (peer === uuid) continue;
        void SyncSocket.hostSend({ uuid: peer, message: raw });
      }
      handleIncoming(message, hooks, true);
    });
  }
  if (!nativeServerStarted) {
    await SyncSocket.startHost({ port: SYNC_PORT });
    nativeServerStarted = true;
  }
  sendImpl = (message) => {
    const raw = JSON.stringify(message);
    rememberOutgoing(message, raw);
    for (const uuid of connections) {
      void SyncSocket.hostSend({ uuid, message: raw });
    }
  };
  hooks.onMasterOpen();
  try {
    await SyncSocket.advertise({ port: SYNC_PORT });
  } catch {
    // Bonjour is only for the iOS local-network prompt
  }
  const address = await nativeJoinAddress();
  setLink({
    connected: true,
    hosting: true,
    endpoint: address,
    peers: [...nativePeers.values()],
    peerCount: clientPeerCount([...nativePeers.values()])
  });
  return address;
}

function connectBrowserSocket(
  url: string,
  hooks: SyncHooks,
  onConnectFail: () => void,
  retryAll: () => void
): void {
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // replace the previous socket
    }
    socket = null;
  }
  try {
    socket = new WebSocket(url);
  } catch {
    onConnectFail();
    return;
  }
  const current = socket;
  let opened = false;
  const giveUp = window.setTimeout(() => {
    if (opened || socket !== current) return;
    current.onclose = null;
    try {
      current.close();
    } catch {
      // abandon this attempt
    }
    onConnectFail();
  }, 2000);
  sendImpl = (message) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const raw = JSON.stringify(message);
    rememberOutgoing(message, raw);
    socket.send(raw);
  };
  current.onopen = () => {
    if (socket !== current) return;
    window.clearTimeout(giveUp);
    opened = true;
    setLink({ connected: true, hosting: false });
    sendImpl({
      type: "Hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceKind: hooks.deviceKind(),
      deviceName:
        hooks.deviceKind() === "master"
          ? "Master"
          : hooks.deviceKind() === "remote"
            ? hooks.deviceName?.().trim() || REMOTE_DEVICE_NAME
            : hooks.deviceName?.().trim() || clientDeviceName(),
      deviceId: hooks.deviceKind() === "master" ? "master" : sessionClientId(),
      ...(hooks.deviceKind() === "master" ? { sessionId: masterBootSessionId() } : {})
    });
    if (hooks.deviceKind() === "master") hooks.onMasterOpen();
  };
  current.onmessage = (event) => {
    if (socket !== current) return;
    const message = parseSyncMessage(String(event.data));
    if (!message) return;
    handleIncoming(message, hooks, true);
  };
  current.onclose = () => {
    if (socket !== current) return;
    window.clearTimeout(giveUp);
    setLink({ connected: false, hosting: false, peerCount: 0, peers: [] });
    window.clearTimeout(reconnectTimer);
    if (!allowReconnect) return;
    if (!opened) {
      onConnectFail();
      return;
    }
    reconnectTimer = window.setTimeout(retryAll, 2000);
  };
}

function sessionClientId(): string {
  const key = "dbk-client-id";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = `client_${crypto.randomUUID()}`;
  sessionStorage.setItem(key, id);
  return id;
}

export function disconnectSyncTransport(): void {
  seenMasterSessionId = null;
  allowReconnect = false;
  httpEpoch += 1;
  window.clearTimeout(reconnectTimer);
  void dropNativeClientListeners();
  void import("./sync-socket")
    .then(({ SyncSocket }) => SyncSocket.close())
    .catch(() => undefined);
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // already closed
    }
    socket = null;
  }
  sendImpl = () => {};
  setLink({ connected: false, hosting: false, peerCount: 0, peers: [] });
}

export async function connectSyncTransport(hooks: SyncHooks): Promise<string | null> {
  window.clearTimeout(reconnectTimer);
  allowReconnect = true;
  if (isNativeApp() && hooks.deviceKind() === "master") {
    return startNativeMaster(hooks);
  }
  const host = hookSyncHost(hooks);
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const hostname = parseSyncHostname(host) || practiceSharePageOrigin()?.replace(/^https?:\/\//, "").replace(/:\d+$/, "") || "";
  const urls = hostname
    ? syncSocketUrls(hostname)
    : [`${protocol}://${window.location.host}/sync`];
  const httpRoot = practiceSharePageOrigin() ?? httpSyncOrigin(host);
  setLink({
    connected: false,
    hosting: false,
    endpoint: hostname ? `${hostname}:${SYNC_PORT}` : null,
    peerCount: 0,
    peers: []
  });
  const retry = () => {
    if (!allowReconnect) return;
    if (isFollowerKind(hooks.deviceKind()) && !hookSyncHost(hooks) && !practiceSharePageOrigin()) return;
    void connectSyncTransport(hooks);
  };
  if (httpRoot) void connectPreferHttp(httpRoot, urls, hooks, retry);
  else connectFollower(urls, hooks, retry);
  return hostname ? `${hostname}:${SYNC_PORT}` : null;
}

async function connectPreferHttp(
  httpRoot: string,
  urls: string[],
  hooks: SyncHooks,
  retryAll: () => void
): Promise<void> {
  try {
    const probe = await fetch(`${httpRoot}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500)
    });
    if (probe.ok) {
      await connectHttpFollower(httpRoot, hooks, retryAll);
      return;
    }
  } catch {
    // sockets next
  }
  connectFollower(urls, hooks, retryAll);
}

async function connectHttpFollower(
  root: string,
  hooks: SyncHooks,
  retryAll: () => void
): Promise<void> {
  const epoch = ++httpEpoch;
  const created = await fetch(`${root}/sync-http/session`, { method: "POST", cache: "no-store" });
  if (!created.ok) throw new Error("http session");
  const { id } = (await created.json()) as { id?: string };
  if (!id) throw new Error("http session");
  setLink({ connected: true, hosting: false });
  sendImpl = (message) => {
    if (epoch !== httpEpoch) return;
    const raw = JSON.stringify(message);
    rememberOutgoing(message, raw);
    void fetch(`${root}/sync-http/session/${id}`, { method: "POST", body: raw, cache: "no-store" });
  };
  sendImpl({
    type: "Hello",
    protocolVersion: PROTOCOL_VERSION,
    deviceKind: hooks.deviceKind(),
    deviceName:
      hooks.deviceKind() === "remote"
        ? hooks.deviceName?.().trim() || REMOTE_DEVICE_NAME
        : hooks.deviceName?.().trim() || clientDeviceName(),
    deviceId: hooks.deviceKind() === "master" ? "master" : sessionClientId()
  });
  const poll = async () => {
    while (allowReconnect && epoch === httpEpoch) {
      try {
        const res = await fetch(`${root}/sync-http/session/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error("poll");
        const data = (await res.json()) as { messages?: string[] };
        for (const raw of data.messages ?? []) {
          const message = parseSyncMessage(raw);
          if (message) handleIncoming(message, hooks, true);
        }
      } catch {
        if (epoch !== httpEpoch || !allowReconnect) return;
        setLink({ connected: false, hosting: false, peerCount: 0, peers: [] });
        retryAll();
        return;
      }
    }
  };
  void poll();
}

function connectFollower(urls: string[], hooks: SyncHooks, retryAll: () => void): void {
  let index = 0;
  const attempt = () => {
    const url = urls[index];
    if (!url) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(retryAll, 2000);
      return;
    }
    index += 1;
    if (isNativeApp()) void connectNativeClientSocket(url, hooks, attempt, retryAll);
    else connectBrowserSocket(url, hooks, attempt, retryAll);
  };
  attempt();
}

let nativeClientUnsubs: Array<{ remove: () => Promise<void> }> = [];

async function dropNativeClientListeners(): Promise<void> {
  const pending = nativeClientUnsubs;
  nativeClientUnsubs = [];
  await Promise.all(pending.map((handle) => handle.remove().catch(() => undefined)));
}

async function connectNativeClientSocket(
  url: string,
  hooks: SyncHooks,
  onConnectFail: () => void,
  retryAll: () => void
): Promise<void> {
  const { SyncSocket } = await import("./sync-socket");
  await dropNativeClientListeners();
  try {
    await SyncSocket.close();
  } catch {
    // first connect
  }
  sendImpl = (message) => {
    const raw = JSON.stringify(message);
    rememberOutgoing(message, raw);
    void SyncSocket.send({ message: raw });
  };
  nativeClientUnsubs = await Promise.all([
    SyncSocket.addListener("message", (event) => {
      const message = parseSyncMessage(String(event.data ?? ""));
      if (!message) return;
      handleIncoming(message, hooks, true);
    }),
    SyncSocket.addListener("close", () => {
      setLink({ connected: false, hosting: false, peerCount: 0, peers: [] });
      window.clearTimeout(reconnectTimer);
      if (!allowReconnect) return;
      reconnectTimer = window.setTimeout(retryAll, 2000);
    })
  ]);
  try {
    await SyncSocket.wakeLocalNetwork();
    await Promise.race([
      SyncSocket.connect({ url }),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("timeout")), 2500);
      })
    ]);
    setLink({ connected: true, hosting: false });
    sendImpl({
      type: "Hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceKind: hooks.deviceKind(),
      deviceName:
        hooks.deviceKind() === "remote"
          ? hooks.deviceName?.().trim() || REMOTE_DEVICE_NAME
          : hooks.deviceName?.().trim() || clientDeviceName(),
      deviceId: hooks.deviceKind() === "master" ? "master" : sessionClientId()
    });
  } catch {
    try {
      await SyncSocket.close();
    } catch {
      // try the next address
    }
    setLink({ connected: false, hosting: false, peerCount: 0, peers: [] });
    if (!allowReconnect) return;
    onConnectFail();
  }
}
