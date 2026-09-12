import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { parseSongInfo, type Song, type SongInfo } from "@dbk/core";
import { isNativeApp } from "./platform";

const LIBRARY_ROOT = "library/songs";

export interface LibraryIndex {
  songs: Song[];
  fileIndex: Record<string, string[]>;
}

const folderBySongId: Record<string, string> = {};

export function folderForSong(songId: string): string {
  return folderBySongId[songId] ?? songId;
}

export function registerSongFolder(songId: string, folder: string): void {
  folderBySongId[songId] = folder;
}

export function resetSongFolders(): void {
  for (const key of Object.keys(folderBySongId)) delete folderBySongId[key];
}

let fileOverride: ((songId: string, relPath: string) => Promise<ArrayBuffer | null>) | null = null;

export function setLibraryFileOverride(
  reader: ((songId: string, relPath: string) => Promise<ArrayBuffer | null>) | null
): void {
  fileOverride = reader;
}

function webSongUrl(songId: string, relPath: string): string {
  return `/library/songs/${encodeURIComponent(songId)}/${relPath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

function nativePath(folder: string, relPath = ""): string {
  return relPath ? `${LIBRARY_ROOT}/${folder}/${relPath}` : `${LIBRARY_ROOT}/${folder}`;
}

async function listFiles(folder: string, prefix = ""): Promise<string[]> {
  const path = prefix ? nativePath(folder, prefix) : nativePath(folder);
  let entries: { name: string; type: string }[] = [];
  try {
    const result = await Filesystem.readdir({ path, directory: Directory.Documents });
    entries = result.files;
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === "directory") out.push(...(await listFiles(folder, rel)));
    else out.push(rel);
  }
  return out;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseInfo(raw: unknown): SongInfo {
  return parseSongInfo(raw);
}

function infoIsComplete(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const record = raw as Record<string, unknown>;
  return (
    positiveInt(record.bpm, 0) > 0 &&
    positiveInt(record.numerator, 0) > 0 &&
    positiveInt(record.denominator, 0) > 0
  );
}

function playbackInfo(packed: Record<string, unknown> | null): SongInfo {
  if (!packed) return parseInfo(undefined);
  const map = packed.tempoMap;
  const first =
    Array.isArray(map) && map[0] && typeof map[0] === "object" && !Array.isArray(map[0])
      ? (map[0] as Record<string, unknown>)
      : undefined;
  return parseInfo({
    bpm: first?.bpm,
    numerator: first?.numerator,
    denominator: first?.denominator,
    duration: packed.duration,
    key: packed.key,
    scale: packed.scale,
    style: packed.style
  });
}

async function readUtf8(path: string): Promise<string | null> {
  try {
    const file = await Filesystem.readFile({
      path,
      directory: Directory.Documents,
      encoding: Encoding.UTF8
    });
    return typeof file.data === "string" ? file.data : null;
  } catch {
    return null;
  }
}

async function readJson(path: string): Promise<unknown> {
  const text = await readUtf8(path);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function writeUtf8(path: string, contents: string): Promise<void> {
  await Filesystem.writeFile({
    path,
    directory: Directory.Documents,
    data: contents,
    encoding: Encoding.UTF8
  });
}

function stubSong(folder: string, info: SongInfo): Song {
  return {
    id: folder,
    version: 1,
    title: folder,
    folder,
    duration: 0,
    assets: [],
    tempoMap: [
      {
        time: 0,
        measure: 1,
        bpm: info.bpm,
        numerator: info.numerator,
        denominator: info.denominator
      }
    ],
    sections: [],
    info
  };
}

async function ensureInfo(folder: string, packed: Record<string, unknown> | null): Promise<SongInfo> {
  const settingsPath = nativePath(folder, "settings.json");
  const settingsRaw = await readJson(settingsPath);
  const settings =
    settingsRaw && typeof settingsRaw === "object" && !Array.isArray(settingsRaw)
      ? { ...(settingsRaw as Record<string, unknown>) }
      : {};
  const baseline = infoIsComplete(settings.view) ? settings.view : playbackInfo(packed);
  const info = parseInfo({
    ...(baseline && typeof baseline === "object" ? baseline : {}),
    ...(settings.performance && typeof settings.performance === "object"
      ? settings.performance
      : {}),
    ...(settings.notes && typeof settings.notes === "object"
      ? { pageNotes: settings.notes }
      : {}),
    ...(packed?.info && typeof packed.info === "object" ? packed.info : {}),
    metroNotes: {
      ...(settings.metroNotes && typeof settings.metroNotes === "object" ? settings.metroNotes : {}),
      ...(packed?.info && typeof packed.info === "object" && (packed.info as { metroNotes?: unknown }).metroNotes
        ? (packed.info as { metroNotes?: unknown }).metroNotes
        : {})
    }
  });
  if (packed && JSON.stringify(parseInfo(packed.info)) !== JSON.stringify(info)) {
    try {
      await writeUtf8(
        nativePath(folder, "song.json"),
        `${JSON.stringify({ ...packed, info }, null, 2)}\n`
      );
    } catch {
      // list the folder even if the migrated song file cannot be written
    }
  }
  if ("view" in settings || "performance" in settings || "notes" in settings) {
    const { view: _view, performance: _performance, notes: _notes, ...remaining } = settings;
    try {
      await writeUtf8(settingsPath, `${JSON.stringify(remaining, null, 2)}\n`);
    } catch {
      // song.json is authoritative even if legacy settings cleanup fails
    }
  }
  return info;
}

async function scanNativeLibrary(): Promise<LibraryIndex> {
  for (const key of Object.keys(folderBySongId)) delete folderBySongId[key];
  const songs: Song[] = [];
  const fileIndex: Record<string, string[]> = {};
  let folders: { name: string; type: string }[] = [];
  try {
    const result = await Filesystem.readdir({
      path: LIBRARY_ROOT,
      directory: Directory.Documents
    });
    folders = result.files;
  } catch {
    return { songs, fileIndex };
  }
  for (const entry of folders) {
    if (entry.type !== "directory" || entry.name.startsWith(".")) continue;
    const folder = entry.name;
    const packedRaw = await readJson(nativePath(folder, "song.json"));
    const packed =
      packedRaw && typeof packedRaw === "object" && !Array.isArray(packedRaw)
        ? (packedRaw as Record<string, unknown>)
        : null;
    const info = await ensureInfo(folder, packed);
    const files = await listFiles(folder);
    const song = {
      ...stubSong(folder, info),
      ...(packed ?? {}),
      folder,
      title: typeof packed?.title === "string" && packed.title.trim() ? packed.title : folder,
      id: typeof packed?.id === "string" && packed.id.length > 0 ? packed.id : folder,
      info
    } as Song;
    folderBySongId[song.id] = folder;
    fileIndex[song.id] = files;
    songs.push(song);
  }
  return { songs, fileIndex };
}

function fetchTimeout(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function scanWebLibrary(): Promise<LibraryIndex> {
  const response = await fetch("/library/index.json", { signal: fetchTimeout(5_000) });
  if (!response.ok) throw new Error(`Library ${response.status}`);
  return (await response.json()) as LibraryIndex;
}

export async function loadLibraryIndex(): Promise<LibraryIndex> {
  if (isNativeApp()) return scanNativeLibrary();
  return scanWebLibrary();
}

export async function libraryFileUrl(songId: string, relPath: string): Promise<string> {
  if (!isNativeApp()) return webSongUrl(songId, relPath);
  const { uri } = await Filesystem.getUri({
    path: nativePath(folderForSong(songId), relPath),
    directory: Directory.Documents
  });
  return Capacitor.convertFileSrc(uri);
}

export async function readSongFile(songId: string, relPath: string): Promise<ArrayBuffer> {
  if (fileOverride) {
    const overridden = await fileOverride(songId, relPath);
    if (overridden) return overridden;
    throw new Error(`Missing ${relPath}`);
  }
  if (!isNativeApp()) {
    const response = await fetch(await libraryFileUrl(songId, relPath));
    if (!response.ok) throw new Error(`Missing ${relPath}`);
    return response.arrayBuffer();
  }
  const folder = folderForSong(songId);
  const path = nativePath(folder, relPath);
  try {
    const response = await fetch(await libraryFileUrl(songId, relPath));
    if (response.ok) return await response.arrayBuffer();
  } catch {
    /* iOS sometimes cannot fetch the converted file URL; read bytes instead. */
  }
  const file = await Filesystem.readFile({ path, directory: Directory.Documents });
  const data = file.data;
  if (typeof data !== "string") {
    if (data instanceof ArrayBuffer) return data;
    throw new Error(`Missing ${relPath}`);
  }
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function readSongJsonFile(songId: string, relPath: string): Promise<unknown | null> {
  if (fileOverride) {
    const overridden = await fileOverride(songId, relPath);
    if (!overridden) return null;
    try {
      return JSON.parse(new TextDecoder().decode(overridden)) as unknown;
    } catch {
      return null;
    }
  }
  if (!isNativeApp()) {
    const response = await fetch(webSongUrl(songId, relPath), { signal: fetchTimeout(5_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${relPath} ${response.status}`);
    return response.json() as Promise<unknown>;
  }
  const raw = await readJson(nativePath(folderForSong(songId), relPath));
  return raw ?? null;
}

export async function writeSongJsonFile(songId: string, relPath: string, data: unknown): Promise<void> {
  const body = `${JSON.stringify(data, null, 2)}\n`;
  if (!isNativeApp()) {
    const response = await fetch(webSongUrl(songId, relPath), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
      signal: fetchTimeout(5_000)
    });
    if (!response.ok) throw new Error(`Could not save ${relPath} (${response.status}).`);
    return;
  }
  await writeUtf8(nativePath(folderForSong(songId), relPath), body);
}

export async function writeSongBytes(
  songId: string,
  relPath: string,
  data: ArrayBuffer | Uint8Array
): Promise<void> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isNativeApp()) {
    const response = await fetch(webSongUrl(songId, relPath), {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      body: bytes,
      signal: fetchTimeout(30_000)
    });
    if (!response.ok) throw new Error(`Could not save ${relPath} (${response.status}).`);
    return;
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  await Filesystem.writeFile({
    path: nativePath(folderForSong(songId), relPath),
    directory: Directory.Documents,
    data: btoa(binary)
  });
}
