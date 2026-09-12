export const SYNC_PORT = 8787;

/** Hostname only — `192.168.1.184:8787` and `http://192.168.1.184:8788/client` both work. */
export function parseSyncHostname(host: string): string {
  return host
    .trim()
    .replace(/^wss?:\/\//i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

export function syncSocketUrl(host: string): string | null {
  const hostname = parseSyncHostname(host);
  if (!hostname) return null;
  return `ws://${hostname}:${SYNC_PORT}/sync`;
}
