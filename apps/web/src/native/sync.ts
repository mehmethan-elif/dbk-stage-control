import type { DeviceKind, SyncMessage } from "@dbk/protocol";
import { PROTOCOL_VERSION, parseSyncMessage } from "@dbk/protocol";
import { isNativeApp } from "./platform";

export const SYNC_PORT = 8787;
export const PRACTICE_SHARE_PORT = 8788;
export const MASTER_HOST_KEY = "dbk-master-host";

export type SyncLinkState = {
  connected: boolean;
  hosting: boolean;
  endpoint: string | null;
  peerCount: number;
};

const connections = new Set<string>();
let socket: WebSocket | null = null;
let sendImpl: (message: SyncMessage) => void = () => {};
let lastShow = "";
let lastPosition = "";
let reconnectTimer = 0;
let nativeServerStarted = false;
let nativeListenersBound = false;
let linkState: SyncLinkState = {
  connected: false,
  hosting: false,
  endpoint: null,
  peerCount: 0
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
  syncHost?: string | null;
  onMasterOpen: () => void;
  onClientHello: () => void;
  onClientSync: (message: SyncMessage) => void;
};

function handleIncoming(message: SyncMessage, hooks: SyncHooks, fromPeer = false): void {
  if (hooks.deviceKind() === "master") {
    if (fromPeer && message.type === "Hello" && message.deviceKind === "client") {
      hooks.onClientHello();
    }
    return;
  }
  hooks.onClientSync(message);
}

async function startNativeMaster(hooks: SyncHooks): Promise<string | null> {
  const { WebsocketServer } = await import("capacitor-websocket-server");
  if (!nativeListenersBound) {
    nativeListenersBound = true;
    await WebsocketServer.addListener("onOpen", (event) => {
      connections.add(event.connection.uuid);
      setLink({ connected: true, hosting: true, peerCount: connections.size });
      if (lastShow) void WebsocketServer.send({ uuid: event.connection.uuid, message: lastShow });
      if (lastPosition) void WebsocketServer.send({ uuid: event.connection.uuid, message: lastPosition });
    });
    await WebsocketServer.addListener("onClose", (event) => {
      connections.delete(event.uuid);
      setLink({ peerCount: connections.size });
    });
    await WebsocketServer.addListener("onMessage", (event) => {
      if (event.isBinary) return;
      const raw = event.message;
      const message = parseSyncMessage(raw);
      if (!message) return;
      rememberOutgoing(message, raw);
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
  setLink({ connected: true, hosting: true, endpoint: address, peerCount: connections.size });
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
      deviceName: hooks.deviceKind() === "master" ? "Master" : "Client",
      deviceId: hooks.deviceKind() === "master" ? "master" : sessionClientId()
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
    setLink({ connected: false, hosting: false, peerCount: 0 });
    window.clearTimeout(reconnectTimer);
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
  setLink({ connected: false, hosting: false, peerCount: 0 });
}

export async function connectSyncTransport(hooks: SyncHooks): Promise<string | null> {
  window.clearTimeout(reconnectTimer);
  if (isNativeApp() && hooks.deviceKind() === "master") {
    return startNativeMaster(hooks);
  }
  const host = hooks.syncHost?.trim();
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
    peerCount: 0
  });
  connectBrowserSocket(url, hooks, () => {
    void connectSyncTransport(hooks);
  });
  return host ? `${host.replace(/:\d+$/, "")}:${SYNC_PORT}` : null;
}
