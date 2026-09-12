export const SYNC_PORT = 8787;
export const PRACTICE_SHARE_PORT = 8788;

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
  return syncSocketUrls(host)[0] ?? null;
}

/** Prefer the HTTP share port — that listener is up even when 8787 never bound. */
export function syncSocketUrls(host: string): string[] {
  const hostname = parseSyncHostname(host);
  if (!hostname) return [];
  return [
    `ws://${hostname}:${PRACTICE_SHARE_PORT}/sync`,
    `ws://${hostname}:${SYNC_PORT}/sync`,
    `ws://${hostname}:${SYNC_PORT}/`
  ];
}
