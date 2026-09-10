import type { DeviceKind, SyncMessage, SyncPeer } from "@dbk/protocol";
import {
  PROTOCOL_VERSION,
  REMOTE_DEVICE_NAME,
  masterSessionUpdate,
  parseSyncMessage
} from "@dbk/protocol";
import { isNativeApp } from "./platform";

export const SYNC_PORT = 8787;
export const PRACTICE_SHARE_PORT = 8788;
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
}

async function lanAddress(): Promise<string | null> {
  const { WebsocketServer } = await import("capacitor-websocket-server");
  const interfaces = await WebsocketServer.getInterfaces();
  for (const [name, info] of Object.entries(interfaces)) {
    if (name.startsWith("lo") || name.startsWith("utun") || name.startsWith("awdl")) continue;
    const ip = info.ipv4Addresses?.find(
      (address) => !address.startsWith("127.") && !address.startsWith("169.254.")
    );
    if (ip) return ip;
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
  const { WebsocketServer } = await import("capacitor-websocket-server");
  sendNativeRaw = (uuid, message) => {
    void WebsocketServer.send({ uuid, message });
  };
  if (!nativeListenersBound) {
    nativeListenersBound = true;
    await WebsocketServer.addListener("onOpen", (event) => {
      connections.add(event.connection.uuid);
      setLink({ connected: true, hosting: true, peerCount: clientPeerCount(linkState.peers) });
      if (lastShow) void WebsocketServer.send({ uuid: event.connection.uuid, message: lastShow });
      if (lastPosition) void WebsocketServer.send({ uuid: event.connection.uuid, message: lastPosition });
    });
    await WebsocketServer.addListener("onClose", (event) => {
      connections.delete(event.uuid);
      nativePeers.delete(event.uuid);
      publishNativeRoster();
    });
    await WebsocketServer.addListener("onMessage", (event) => {
      if (event.isBinary) return;
      const raw = event.message;
      const message = parseSyncMessage(raw);
      if (!message) return;
      rememberOutgoing(message, raw);
      if (message.type === "Hello") {
        for (const [uuid, peer] of nativePeers) {
          if (peer.deviceId === message.deviceId) nativePeers.delete(uuid);
        }
        nativePeers.set(event.uuid, {
          deviceId: message.deviceId,
          deviceKind: message.deviceKind,
          deviceName: message.deviceName
        });
        publishNativeRoster();
      }
      for (const uuid of connections) {
        if (uuid === event.uuid) continue;
        void WebsocketServer.send({ uuid, message: raw });
      }
      handleIncoming(message, hooks, true);
    });
  }
  if (!nativeServerStarted) {
    await WebsocketServer.start({ port: SYNC_PORT, tcpNoDelay: true });
    nativeServerStarted = true;
  }
  sendImpl = (message) => {
    const raw = JSON.stringify(message);
    rememberOutgoing(message, raw);
    for (const uuid of connections) {
      void WebsocketServer.send({ uuid, message: raw });
    }
  };
  hooks.onMasterOpen();
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

function connectBrowserSocket(url: string, hooks: SyncHooks, retry: () => void): void {
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
    return;
  }
  const current = socket;
  sendImpl = (message) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const raw = JSON.stringify(message);
    rememberOutgoing(message, raw);
    socket.send(raw);
  };
  current.onopen = () => {
    if (socket !== current) return;
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
    setLink({ connected: false, hosting: false, peerCount: 0, peers: [] });
    window.clearTimeout(reconnectTimer);
    if (!allowReconnect) return;
    reconnectTimer = window.setTimeout(retry, 2000);
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
  window.clearTimeout(reconnectTimer);
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
  const hostname = host
    ? host.replace(/^wss?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "")
    : "";
  const url =
    hostname.length > 0
      ? `ws://${hostname}:${SYNC_PORT}/sync`
      : `${protocol}://${window.location.host}/sync`;
  setLink({
    connected: false,
    hosting: false,
    endpoint: hostname ? `${hostname}:${SYNC_PORT}` : null,
    peerCount: 0,
    peers: []
  });
  connectBrowserSocket(url, hooks, () => {
    if (!allowReconnect) return;
    if (isFollowerKind(hooks.deviceKind()) && !hookSyncHost(hooks)) return;
    void connectSyncTransport(hooks);
  });
  return host ? `${host.replace(/:\d+$/, "")}:${SYNC_PORT}` : null;
}
