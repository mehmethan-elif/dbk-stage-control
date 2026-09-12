export const METRO_INTRO_FILES = ["1.flac", "2.flac"] as const;

const FLAC_MAGIC = [0x66, 0x4c, 0x61, 0x43];

export function metroIntroFileName(url: string): (typeof METRO_INTRO_FILES)[number] | undefined {
  const name = url.split("/").pop()?.split("?")[0] ?? "";
  return METRO_INTRO_FILES.find((file) => file === name.toLowerCase());
}

export function bufferLooksLikeFlac(data: ArrayBuffer | undefined): data is ArrayBuffer {
  if (!data || data.byteLength < FLAC_MAGIC.length) return false;
  const bytes = new Uint8Array(data);
  return FLAC_MAGIC.every((byte, index) => bytes[index] === byte);
}

function withSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

/** HTTP URLs that work from `/client`, GitHub pages, and the Capacitor bundle. */
export function metroIntroHttpUrls(name: string, origin: string, baseUrl = "/"): string[] {
  if (!origin) return [];
  const root = withSlash(origin);
  const urls: string[] = [];
  if (baseUrl.startsWith("http://") || baseUrl.startsWith("https://") || baseUrl.startsWith("/")) {
    const base = withSlash(baseUrl);
    const pageRoot = base.startsWith("http") ? base : new URL(base.replace(/^\//, ""), root).href;
    urls.push(new URL(`library/${name}`, pageRoot).href);
    urls.push(new URL(`client-library/${name}`, pageRoot).href);
  }
  urls.push(new URL(`library/${name}`, root).href);
  urls.push(new URL(`client-library/${name}`, root).href);
  return [...new Set(urls)];
}
