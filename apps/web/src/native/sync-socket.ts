import { registerPlugin, WebPlugin } from "@capacitor/core";

export type NativeHostEvent = {
  type?: string;
  uuid?: string;
  message?: string;
};

export type NativeHostPeer = {
  uuid?: string;
  deviceId?: string;
  deviceKind?: string;
  deviceName?: string;
};

type SyncSocketApi = {
  connect(options: { url: string }): Promise<void>;
  send(options: { message: string }): Promise<void>;
  close(): Promise<void>;
  wakeLocalNetwork(): Promise<void>;
  advertise(options: { port: number }): Promise<void>;
  startHost(options: { port: number }): Promise<{ address?: string }>;
  hostSend(options: { uuid: string; message: string }): Promise<void>;
  drainHost(): Promise<{ events?: NativeHostEvent[]; peers?: NativeHostPeer[] }>;
  lanAddress(): Promise<{ address?: string }>;
  addListener(
    eventName: "open" | "message" | "close",
    listener: (event: { data?: string }) => void
  ): Promise<{ remove: () => Promise<void> }>;
};

class SyncSocketWeb extends WebPlugin implements SyncSocketApi {
  private socket: WebSocket | null = null;

  async connect(options: { url: string }): Promise<void> {
    await this.close();
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(options.url);
      this.socket = socket;
      socket.onopen = () => {
        this.notifyListeners("open", {});
        resolve();
      };
      socket.onerror = () => reject(new Error("Could not reach master"));
      socket.onmessage = (event) => {
        this.notifyListeners("message", { data: String(event.data) });
      };
      socket.onclose = () => {
        this.notifyListeners("close", {});
      };
    });
  }

  async send(options: { message: string }): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(options.message);
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // already closed
    }
  }

  async wakeLocalNetwork(): Promise<void> {}

  async advertise(): Promise<void> {}

  async startHost(): Promise<{ address?: string }> {
    return {};
  }

  async hostSend(): Promise<void> {}

  async drainHost(): Promise<{ events?: NativeHostEvent[]; peers?: NativeHostPeer[] }> {
    return { events: [], peers: [] };
  }

  async lanAddress(): Promise<{ address?: string }> {
    return {};
  }
}

export const SyncSocket = registerPlugin<SyncSocketApi>("SyncSocket", {
  web: () => new SyncSocketWeb()
});
