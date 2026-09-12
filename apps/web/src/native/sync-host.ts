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

export function practiceSharePageOrigin(): string | null {
  if (typeof window === "undefined") return null;
  if (window.location.port !== String(PRACTICE_SHARE_PORT)) return null;
  return window.location.origin;
}

export function httpSyncOrigin(host: string): string | null {
  const page = practiceSharePageOrigin();
  if (page) return page;
  const hostname = parseSyncHostname(host);
  if (!hostname) return null;
  return `http://${hostname}:${PRACTICE_SHARE_PORT}`;
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
