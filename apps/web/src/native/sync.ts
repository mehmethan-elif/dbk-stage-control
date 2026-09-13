import { normalizeBandName, randomUuid } from "@dbk/core";
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
import type { NativeHostEvent, NativeHostPeer } from "./sync-socket";

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

export function helloAcknowledged(
  message: SyncMessage,
  deviceName: string
): boolean {
  if (message.type === "LoadGig" || message.type === "Position") return true;
  if (message.type !== "Peers") return false;
  const name = deviceName.trim();
  if (!name) return message.peers.some((peer) => peer.deviceKind === "client");
  const key = normalizeBandName(name);
  return message.peers.some(
    (peer) => peer.deviceKind === "client" && normalizeBandName(peer.deviceName) === key
  );
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
let hostPumpTimer = 0;
/** Master to client is pushed straight out, so this only paces client to master. */
const HOST_POLL_MS = 250;
let httpEpoch = 0;
let httpSession: { root: string; id: string } | null = null;

/** Without this the master keeps a ghost peer; it only reaps idle sessions after 25s. */
function releaseHttpSession(): void {
  const session = httpSession;
  httpSession = null;
  if (!session) return;
  void fetch(`${session.root}/sync-http/session/${session.id}`, {
    method: "DELETE",
    cache: "no-store",
    keepalive: true
  }).catch(() => {
    // the master reaps idle sessions anyway
  });
}

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

export function announceSyncHello(deviceKind: DeviceKind, deviceName: string): void {
  const name = deviceName.trim();
  if (!name) return;
  sendImpl({
    type: "Hello",
    protocolVersion: PROTOCOL_VERSION,
    deviceKind,
    deviceName: name,
    deviceId: deviceKind === "master" ? "master" : sessionClientId(),
    ...(deviceKind === "master" ? { sessionId: masterBootSessionId() } : {})
  });
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
  store.__dbkMasterSessionId ??= randomUuid();
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
const httpPeerIds = new Set<string>();
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

function applyNativeHostEvent(
  kind: "open" | "close" | "message",
  event: NativeHostEvent,
  hooks: SyncHooks
): void {
  const uuid = String(event.uuid ?? "");
  if (kind === "open") {
    if (!uuid) return;
    connections.add(uuid);
    setLink({ connected: true, hosting: true, peerCount: clientPeerCount(linkState.peers) });
    if (lastShow) sendNativeRaw?.(uuid, lastShow);
    if (lastPosition) sendNativeRaw?.(uuid, lastPosition);
    publishNativeRoster();
    return;
  }
  if (kind === "close") {
    connections.delete(uuid);
    nativePeers.delete(uuid);
    publishNativeRoster();
    return;
  }
  if (uuid) connections.add(uuid);
  const raw = String(event.message ?? "");
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
    sendNativeRaw?.(peer, raw);
  }
  handleIncoming(message, hooks, true);
}

function greetNativeClient(uuid: string, hooks: SyncHooks): void {
  connections.add(uuid);
  if (lastShow) sendNativeRaw?.(uuid, lastShow);
  if (lastPosition) sendNativeRaw?.(uuid, lastPosition);
  hooks.onClientHello();
}

function applyNativePeers(peers: NativeHostPeer[], hooks: SyncHooks): void {
  const seen = new Set<string>();
  let changed = false;
  for (const peer of peers) {
    const uuid = peer.uuid?.trim();
    const deviceName = peer.deviceName?.trim();
    const deviceKind =
      peer.deviceKind === "remote" ? "remote" : peer.deviceKind === "client" ? "client" : null;
    if (!uuid || !deviceName || !deviceKind) continue;
    seen.add(uuid);
    httpPeerIds.add(uuid);
    const next: SyncPeer = {
      deviceId: peer.deviceId?.trim() || uuid,
      deviceKind,
      deviceName
    };
    const prev = nativePeers.get(uuid);
    if (
      prev &&
      prev.deviceId === next.deviceId &&
      prev.deviceKind === next.deviceKind &&
      prev.deviceName === next.deviceName
    ) {
      connections.add(uuid);
      continue;
    }
    nativePeers.set(uuid, next);
    connections.add(uuid);
    changed = true;
    if (!prev) {
      greetNativeClient(uuid, hooks);
    }
  }
  for (const uuid of [...httpPeerIds]) {
    if (seen.has(uuid)) continue;
    httpPeerIds.delete(uuid);
    nativePeers.delete(uuid);
    connections.delete(uuid);
    changed = true;
  }
  if (changed) publishNativeRoster();
}

/**
 * Polling is the only way host events reach the web layer. The native side also queues
 * them, so adding a push listener here would apply every client message twice — once as
 * a rebroadcast to the other clients, and once locally.
 */
function startHostPump(hooks: SyncHooks): void {
  if (hostPumpTimer) return;
  const tick = async () => {
    try {
      const { SyncSocket } = await import("./sync-socket");
      const { events, peers } = await SyncSocket.drainHost();
      for (const event of events ?? []) {
        const kind = event.type === "open" || event.type === "close" ? event.type : "message";
        applyNativeHostEvent(kind, event, hooks);
      }
      applyNativePeers(peers ?? [], hooks);
    } catch {
      // the next tick retries
    }
  };
  hostPumpTimer = window.setInterval(() => void tick(), HOST_POLL_MS);
  void tick();
}

async function startNativeMaster(hooks: SyncHooks): Promise<string | null> {
  const { SyncSocket } = await import("./sync-socket");
  sendNativeRaw = (uuid, message) => {
    void SyncSocket.hostSend({ uuid, message });
  };
  if (!nativeServerStarted) {
    await SyncSocket.startHost({ port: SYNC_PORT });
    nativeServerStarted = true;
  }
  startHostPump(hooks);
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
  const helloName =
    hooks.deviceKind() === "master"
      ? "Master"
      : hooks.deviceKind() === "remote"
        ? hooks.deviceName?.().trim() || REMOTE_DEVICE_NAME
        : hooks.deviceName?.().trim() || clientDeviceName();
  current.onopen = () => {
    if (socket !== current) return;
    window.clearTimeout(giveUp);
    opened = true;
    if (hooks.deviceKind() === "master") setLink({ connected: true, hosting: false });
    sendImpl({
      type: "Hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceKind: hooks.deviceKind(),
      deviceName: helloName,
      deviceId: hooks.deviceKind() === "master" ? "master" : sessionClientId(),
      ...(hooks.deviceKind() === "master" ? { sessionId: masterBootSessionId() } : {})
    });
    if (hooks.deviceKind() === "master") hooks.onMasterOpen();
  };
  current.onmessage = (event) => {
    if (socket !== current) return;
    const message = parseSyncMessage(String(event.data));
    if (!message) return;
    if (helloAcknowledged(message, helloName)) setLink({ connected: true, hosting: false });
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
  const id = `client_${randomUuid()}`;
  sessionStorage.setItem(key, id);
  return id;
}

export function disconnectSyncTransport(): void {
  seenMasterSessionId = null;
  allowReconnect = false;
  httpEpoch += 1;
  releaseHttpSession();
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
  const helloName =
    hooks.deviceKind() === "remote"
      ? hooks.deviceName?.().trim() || REMOTE_DEVICE_NAME
      : hooks.deviceName?.().trim() || clientDeviceName();
  const helloMessage: SyncMessage = {
    type: "Hello",
    protocolVersion: PROTOCOL_VERSION,
    deviceKind: hooks.deviceKind(),
    deviceName: helloName,
    deviceId: hooks.deviceKind() === "master" ? "master" : sessionClientId()
  };
  const hello = JSON.stringify(helloMessage);
  rememberOutgoing(helloMessage, hello);
  const created = await fetch(`${root}/sync-http/session`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: hello,
    signal: AbortSignal.timeout(4000)
  });
  if (!created.ok) throw new Error("http session");
  const { id, messages } = (await created.json()) as { id?: string; messages?: string[] };
  if (!id) throw new Error("http session");
  httpSession = { root, id };
  setLink({ connected: false, hosting: false });
  const postMessage = async (raw: string) => {
    if (epoch !== httpEpoch) return;
    await fetch(`${root}/sync-http/session/${id}`, {
      method: "POST",
      body: raw,
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      signal: AbortSignal.timeout(4000)
    });
  };
  sendImpl = (message) => {
    if (epoch !== httpEpoch) return;
    const raw = JSON.stringify(message);
    rememberOutgoing(message, raw);
    void postMessage(raw);
  };
  const markLive = () => {
    if (epoch === httpEpoch) setLink({ connected: true, hosting: false });
  };
  const applyBatch = (raws: string[]) => {
    for (const raw of raws) {
      const message = parseSyncMessage(raw);
      if (!message) continue;
      if (helloAcknowledged(message, helloName)) markLive();
      handleIncoming(message, hooks, true);
    }
  };
  applyBatch(messages ?? []);
  const poll = async () => {
    while (allowReconnect && epoch === httpEpoch) {
      try {
        const res = await fetch(`${root}/sync-http/session/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error("poll");
        const data = (await res.json()) as { messages?: string[] };
        applyBatch(data.messages ?? []);
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
