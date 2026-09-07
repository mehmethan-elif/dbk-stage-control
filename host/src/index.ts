import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { parseSyncMessage } from "@dbk/protocol";
import { publishClientLibrary } from "./publish-client-library";

const PORT = Number(process.env.DBK_HOST_PORT ?? 8787);
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const LIBRARY = join(ROOT, "library", "songs");

function lanIpv4(): string[] {
  const ips: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      const v4 = net.family === "IPv4" || net.family === 4;
      if (v4 && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

const WRITE_FILES = new Set(["settings.json"]);
const MAX_PUT_BYTES = 256 * 1024;

const MIME: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
  ".xml": "application/vnd.recordare.musicxml+xml",
  ".musicxml": "application/vnd.recordare.musicxml+xml",
  ".txt": "text/plain; charset=utf-8"
};

function isPracticeFile(relPath: string): boolean {
  const name = relPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (name === "song.json" || name === "settings.json" || name === "lyrics.json" || name === "lyrics.txt") {
    return true;
  }
  if (name === "master.mp3" || name === "master.flac") return true;
  return name.endsWith(".pdf") || name.endsWith(".musicxml");
}

interface LibraryIndex {
  songs: unknown[];
  fileIndex: Record<string, string[]>;
}

function listFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

const DEFAULT_INFO = { bpm: 120, numerator: 4, denominator: 4 };

type SongInfo = {
  bpm: number;
  numerator: number;
  denominator: number;
  beats?: boolean[];
  startMode?: "COUNT" | "SERBEST";
  duration?: number;
  key?: string;
  scale?: string;
  style?: string;
  notes?: string;
};

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function parseBeats(numerator: number, raw: unknown): boolean[] {
  const count = Math.max(1, Math.floor(numerator) || DEFAULT_INFO.numerator);
  const stored = Array.isArray(raw) && raw.length > 0 ? raw : undefined;
  return Array.from({ length: count }, (_, i) => (stored ? stored[i] === true : i === 0));
}

function parseInfo(raw: unknown): SongInfo {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
  const numerator = positiveInt(record?.numerator, DEFAULT_INFO.numerator);
  const info: SongInfo = {
    bpm: positiveInt(record?.bpm, DEFAULT_INFO.bpm),
    numerator,
    denominator: positiveInt(record?.denominator, DEFAULT_INFO.denominator),
    beats: parseBeats(numerator, record?.beats)
  };
  const duration = positiveInt(record?.duration, 0);
  if (duration > 0) info.duration = duration;
  if (record?.startMode === "COUNT" || record?.startMode === "SERBEST") {
    info.startMode = record.startMode;
  }
  const key = optionalText(record?.key);
  const scale = optionalText(record?.scale);
  const style = optionalText(record?.style);
  const notes = optionalText(record?.notes);
  if (key) info.key = key;
  if (scale) info.scale = scale;
  if (style) info.style = style;
  if (notes) info.notes = notes;
  return info;
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

function ensureInfoJson(dir: string): SongInfo {
  const settingsPath = join(dir, "settings.json");
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      const raw = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        settings = { ...(raw as Record<string, unknown>) };
      }
    } catch {
      settings = {};
    }
  }
  if (infoIsComplete(settings.view)) return parseInfo(settings.view);

  const info = playbackInfo(readSongJson(dir));
  settings.view = info;
  try {
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  } catch {
    // still list the folder even if the default file cannot be written
  }
  return info;
}

function readSongJson(dir: string): Record<string, unknown> | null {
  const songPath = join(dir, "song.json");
  if (!existsSync(songPath)) return null;
  try {
    const song = JSON.parse(readFileSync(songPath, "utf8")) as unknown;
    if (!song || typeof song !== "object" || Array.isArray(song)) return null;
    return song as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stubSong(folder: string, info: SongInfo): Record<string, unknown> {
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

function scanLibrary(): LibraryIndex {
  const songs: unknown[] = [];
  const fileIndex: Record<string, string[]> = {};
  if (!existsSync(LIBRARY)) return { songs, fileIndex };
  for (const folder of readdirSync(LIBRARY)) {
    if (folder.startsWith(".")) continue;
    const dir = join(LIBRARY, folder);
    if (!statSync(dir).isDirectory()) continue;
    const info = ensureInfoJson(dir);
    const files = listFiles(dir);
    const packed = readSongJson(dir);
    const song = packed
      ? {
          ...packed,
          folder,
          title: typeof packed.title === "string" && packed.title.trim() ? packed.title : folder,
          id: typeof packed.id === "string" && packed.id.length > 0 ? packed.id : folder,
          info
        }
      : stubSong(folder, info);
    const key = String(song.id);
    fileIndex[key] = files;
    songs.push(song);
  }
  return { songs, fileIndex };
}

function scanPracticeLibrary(): {
  songs: { id: string; folder: string; files: { path: string; size: number }[] }[];
} {
  const full = scanLibrary();
  const songs: { id: string; folder: string; files: { path: string; size: number }[] }[] = [];
  for (const raw of full.songs) {
    const song = raw as { id?: string; folder?: string };
    const id = String(song.id ?? song.folder ?? "");
    const folder = String(song.folder ?? song.id ?? "");
    if (!id || !folder) continue;
    const dir = findSongDirectory(folder) ?? findSongDirectory(id);
    if (!dir) continue;
    const files = (full.fileIndex[id] ?? []).filter(isPracticeFile).map((path) => {
      const fullPath = join(dir, path);
      return { path, size: existsSync(fullPath) ? statSync(fullPath).size : 0 };
    });
    songs.push({ id, folder, files });
  }
  return { songs };
}

function namesMatch(left: string, right: string): boolean {
  return left === right || left.normalize("NFC") === right.normalize("NFC");
}

function findSongDirectory(head: string): string | null {
  if (!existsSync(LIBRARY)) return null;
  const direct = join(LIBRARY, head);
  if (existsSync(direct) && statSync(direct).isDirectory()) return direct;
  const nfcHead = head.normalize("NFC");
  const nfcDirect = join(LIBRARY, nfcHead);
  if (nfcDirect !== direct && existsSync(nfcDirect) && statSync(nfcDirect).isDirectory()) return nfcDirect;
  for (const folder of readdirSync(LIBRARY)) {
    if (folder.startsWith(".")) continue;
    const dir = join(LIBRARY, folder);
    if (!statSync(dir).isDirectory()) continue;
    if (namesMatch(folder, head)) return dir;
    const packed = readSongJson(dir);
    if (packed && typeof packed.id === "string" && namesMatch(packed.id, head)) return dir;
  }
  return null;
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw new Error("too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function librarySongFile(reqPath: string): { dir: string; full: string; name: string } | null {
  const relativePath = decodeURIComponent(reqPath.replace(/^\/library\/songs\//, ""));
  const slash = relativePath.indexOf("/");
  const head = slash === -1 ? relativePath : relativePath.slice(0, slash);
  const rest = slash === -1 ? "" : relativePath.slice(slash + 1);
  const dir = findSongDirectory(head);
  if (!dir || !rest) return null;
  const full = resolve(dir, rest);
  const rel = relative(dir, full);
  if (rel.startsWith("..") || normalize(rel).startsWith("..") || rel.includes("/") || rel.includes("\\")) {
    return null;
  }
  return { dir, full, name: rest };
}

async function putLibraryFile(req: IncomingMessage, res: ServerResponse, reqPath: string): Promise<void> {
  const target = librarySongFile(reqPath);
  if (!target || !WRITE_FILES.has(target.name)) {
    send(res, 403, "Forbidden", "text/plain");
    return;
  }
  try {
    const body = await readBody(req, MAX_PUT_BYTES);
    JSON.parse(body);
    writeFileSync(target.full, body, "utf8");
    send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
  } catch {
    send(res, 400, "Bad request", "text/plain");
  }
}

function send(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, {
    "content-type": type,
    "access-control-allow-origin": "*",
    "cache-control": "no-store"
  });
  res.end(body);
}

function serveFile(reqPath: string, res: ServerResponse): void {
  const relativePath = decodeURIComponent(reqPath.replace(/^\/library\/songs\//, ""));
  const slash = relativePath.indexOf("/");
  const head = slash === -1 ? relativePath : relativePath.slice(0, slash);
  const rest = slash === -1 ? "" : relativePath.slice(slash + 1);
  const dir = findSongDirectory(head);
  if (!dir) {
    send(res, 404, "Not found", "text/plain");
    return;
  }
  const full = rest ? resolve(dir, rest) : dir;
  const rel = relative(dir, full);
  if (rel.startsWith("..") || normalize(rel).startsWith("..")) {
    send(res, 403, "Forbidden", "text/plain");
    return;
  }
  if (!existsSync(full) || statSync(full).isDirectory()) {
    send(res, 404, "Not found", "text/plain");
    return;
  }
  const type = MIME[extname(full).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "access-control-allow-origin": "*",
    "cache-control": "no-store"
  });
  createReadStream(full).pipe(res);
}

function handler(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, PUT, POST, OPTIONS",
      "access-control-allow-headers": "*"
    });
    res.end();
    return;
  }

  if (url.pathname === "/library/index.json") {
    send(res, 200, JSON.stringify(scanLibrary()), "application/json; charset=utf-8");
    return;
  }

  if (url.pathname === "/practice/index.json") {
    send(res, 200, JSON.stringify(scanPracticeLibrary()), "application/json; charset=utf-8");
    return;
  }

  if (url.pathname.startsWith("/practice/songs/")) {
    const mapped = url.pathname.replace(/^\/practice\/songs\//, "/library/songs/");
    const relativePath = decodeURIComponent(mapped.replace(/^\/library\/songs\//, ""));
    const slash = relativePath.indexOf("/");
    const rest = slash === -1 ? "" : relativePath.slice(slash + 1);
    if (!isPracticeFile(rest)) {
      send(res, 404, "Not found", "text/plain");
      return;
    }
    serveFile(mapped, res);
    return;
  }

  if (url.pathname === "/client-library/publish") {
    if (req.method !== "POST") {
      send(res, 405, "Method not allowed", "text/plain");
      return;
    }
    void (async () => {
      try {
        const body = await readBody(req, 1024 * 1024);
        const parsed = body.trim() ? (JSON.parse(body) as { gigs?: unknown }) : {};
        const result = publishClientLibrary(parsed.gigs ?? []);
        send(res, 200, JSON.stringify({ ok: true, ...result }), "application/json; charset=utf-8");
      } catch {
        send(res, 400, "Could not publish library", "text/plain");
      }
    })();
    return;
  }

  if (url.pathname === "/health") {
    send(res, 200, JSON.stringify({ ok: true, addresses: lanIpv4() }), "application/json; charset=utf-8");
    return;
  }

  if (url.pathname.startsWith("/library/songs/")) {
    if (req.method === "PUT") {
      void putLibraryFile(req, res, url.pathname);
      return;
    }
    serveFile(url.pathname, res);
    return;
  }

  send(res, 404, "Not found", "text/plain");
}

const server = createServer(handler);
const wss = new WebSocketServer({ server, path: "/sync" });

const clients = new Set<WebSocket>();
let lastPosition = "";
let lastShow = "";

wss.on("connection", (socket) => {
  clients.add(socket);
  if (lastShow) socket.send(lastShow);
  if (lastPosition) socket.send(lastPosition);
  socket.on("message", (data) => {
    const raw = String(data);
    const message = parseSyncMessage(raw);
    if (!message) return;
    if (message.type === "LoadGig") lastShow = raw;
    if (message.type === "Position") lastPosition = raw;
    if (message.type === "Stop") lastPosition = "";
    for (const client of clients) {
      if (client !== socket && client.readyState === client.OPEN) client.send(raw);
    }
  });
  socket.on("close", () => clients.delete(socket));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[DBK host] http://127.0.0.1:${PORT}`);
  console.log(`[DBK host] library ${LIBRARY}`);
});
