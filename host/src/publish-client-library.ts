import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CLIENT_LIBRARY_NAME = "DBK Stage Control";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const LIBRARY = join(ROOT, "library", "songs");
export const CLIENT_LIBRARY = join(ROOT, "client-library");

const CHART_NAMES = new Set(["song.json", "settings.json", "lyrics.json", "lyrics.txt"]);
const MASTER_AUDIO = new Set(["master.mp3", "master.flac"]);

function isPracticeFile(name: string): boolean {
  const base = name.toLowerCase();
  if (CHART_NAMES.has(base) || MASTER_AUDIO.has(base)) return true;
  return base.endsWith(".pdf") || base.endsWith(".musicxml");
}

function isSafeFolder(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}

function slug(value: string): string {
  const map: Record<string, string> = {
    ç: "c",
    Ç: "c",
    ğ: "g",
    Ğ: "g",
    ı: "i",
    İ: "i",
    ö: "o",
    Ö: "o",
    ş: "s",
    Ş: "s",
    ü: "u",
    Ü: "u"
  };
  const ascii = [...value.normalize("NFC").trim()].map((char) => map[char] ?? char).join("");
  return ascii.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "song";
}

function exportFolder(id: string, folder: string): string {
  if (isSafeFolder(id)) return id;
  if (isSafeFolder(folder)) return folder;
  return slug(folder || id);
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function listFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

export interface PublishedLibrarySummary {
  songs: number;
  files: number;
  gigs: number;
  root: string;
}

export function publishClientLibrary(gigs: unknown = []): PublishedLibrarySummary {
  const songsOut = join(CLIENT_LIBRARY, "songs");
  rmSync(songsOut, { recursive: true, force: true });
  mkdirSync(songsOut, { recursive: true });

  const songs: {
    id: string;
    folder: string;
    files: { path: string; size: number; hash: string }[];
  }[] = [];

  if (existsSync(LIBRARY)) {
    for (const folder of readdirSync(LIBRARY)) {
      if (folder.startsWith(".")) continue;
      const dir = join(LIBRARY, folder);
      if (!statSync(dir).isDirectory()) continue;
      let id = folder;
      let title = folder.normalize("NFC").trim() || folder;
      const songJson = join(dir, "song.json");
      if (existsSync(songJson)) {
        try {
          const packed = JSON.parse(readFileSync(songJson, "utf8")) as { id?: unknown; title?: unknown };
          if (typeof packed.id === "string" && packed.id.trim()) id = packed.id.trim();
          if (typeof packed.title === "string" && packed.title.trim()) title = packed.title.trim();
        } catch {
          // keep folder name
        }
      }
      const destFolder = exportFolder(id, folder);
      const destDir = join(songsOut, destFolder);
      mkdirSync(destDir, { recursive: true });
      const files: { path: string; size: number; hash: string }[] = [];
      for (const rel of listFiles(dir)) {
        const name = rel.split("/").pop() ?? rel;
        if (!isPracticeFile(name)) continue;
        const data = readFileSync(join(dir, rel));
        writeFileSync(join(destDir, name), data);
        files.push({ path: name, size: data.byteLength, hash: sha256(data) });
      }
      if (!files.some((file) => file.path.toLowerCase() === "song.json")) {
        const body = Buffer.from(`${JSON.stringify({ id, version: 1, title, folder: destFolder }, null, 2)}\n`);
        writeFileSync(join(destDir, "song.json"), body);
        files.push({ path: "song.json", size: body.byteLength, hash: sha256(body) });
      }
      if (files.length === 0) {
        rmSync(destDir, { recursive: true, force: true });
        continue;
      }
      songs.push({ id, folder: destFolder, title, files });
    }
  }

  songs.sort((a, b) => a.folder.localeCompare(b.folder));
  const gigList = Array.isArray(gigs) ? gigs : [];
  const gigsBody = `${JSON.stringify({ gigs: gigList }, null, 2)}\n`;
  const gigsBuf = Buffer.from(gigsBody, "utf8");
  writeFileSync(join(CLIENT_LIBRARY, "gigs.json"), gigsBuf);
  const index = {
    name: CLIENT_LIBRARY_NAME,
    gigs: { path: "gigs.json", size: gigsBuf.byteLength, hash: sha256(gigsBuf) },
    songs
  };
  writeFileSync(join(CLIENT_LIBRARY, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return {
    songs: songs.length,
    files: songs.reduce((sum, song) => sum + song.files.length, 0),
    gigs: gigList.length,
    root: CLIENT_LIBRARY
  };
}
