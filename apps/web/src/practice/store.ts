import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  fileNameOf,
  parseSongInfo,
  practiceMasterAudio,
  publishedSongTitle,
  samePracticeFolder,
  type Gig,
  type Song
} from "@dbk/core";
import { registerSongFolder, resetSongFolders, type LibraryIndex } from "../library/api";

const DB_NAME = "dbk-practice";
const DB_VERSION = 2;
const GIGS_KEY = "published-gigs";

interface PracticeFileRow {
  key: string;
  folder: string;
  path: string;
  size: number;
  hash?: string;
  data: ArrayBuffer;
}

interface PracticeDB extends DBSchema {
  files: {
    key: string;
    value: PracticeFileRow;
    indexes: { folder: string };
  };
  meta: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<PracticeDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<PracticeDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains("files")) {
          const store = database.createObjectStore("files", { keyPath: "key" });
          store.createIndex("folder", "folder");
        }
        if (!database.objectStoreNames.contains("meta")) {
          database.createObjectStore("meta");
        }
      }
    });
  }
  return dbPromise;
}

export function practiceFileKey(folder: string, path: string): string {
  return `${folder}/${path}`;
}

export async function writePracticeFile(
  folder: string,
  path: string,
  data: ArrayBuffer,
  hash?: string
): Promise<void> {
  const keyFolder = folder.normalize("NFC");
  const keyPath = path.normalize("NFC");
  const database = await db();
  await database.put("files", {
    key: practiceFileKey(keyFolder, keyPath),
    folder: keyFolder,
    path: keyPath,
    size: data.byteLength,
    hash,
    data
  });
}

export async function readPracticeFileBuffer(folder: string, path: string): Promise<ArrayBuffer | null> {
  const database = await db();
  const exact = await database.get("files", practiceFileKey(folder, path));
  if (exact) return exact.data;
  const nfcKey = practiceFileKey(folder.normalize("NFC"), path.normalize("NFC"));
  if (nfcKey !== practiceFileKey(folder, path)) {
    const nfc = await database.get("files", nfcKey);
    if (nfc) return nfc.data;
  }
  const wantPath = fileNameOf(path).toLowerCase();
  const rows = await database.getAll("files");
  for (const row of rows) {
    if (samePracticeFolder(row.folder, folder) && fileNameOf(row.path).toLowerCase() === wantPath) {
      return row.data;
    }
  }
  return null;
}

export async function listPracticeFiles(folder: string): Promise<string[]> {
  const rows = await (await db()).getAllFromIndex("files", "folder", folder);
  return rows.map((row) => row.path);
}

export async function listPracticeManifest(): Promise<
  Record<string, { path: string; size: number; hash?: string }[]>
> {
  const rows = await (await db()).getAll("files");
  const out: Record<string, { path: string; size: number; hash?: string }[]> = {};
  for (const row of rows) {
    const list = out[row.folder] ?? [];
    list.push({ path: row.path, size: row.size, hash: row.hash });
    out[row.folder] = list;
  }
  return out;
}

export async function deletePracticeFile(folder: string, path: string): Promise<void> {
  const database = await db();
  const wantFolder = folder.normalize("NFC");
  const wantPath = path.normalize("NFC");
  await database.delete("files", practiceFileKey(wantFolder, wantPath));
  const rows = await database.getAll("files");
  for (const row of rows) {
    if (samePracticeFolder(row.folder, folder) && fileNameOf(row.path).toLowerCase() === fileNameOf(path).toLowerCase()) {
      await database.delete("files", row.key);
    }
  }
}

export async function deletePracticeFolder(folder: string): Promise<void> {
  const database = await db();
  const want = folder.normalize("NFC");
  const rows = await database.getAll("files");
  for (const row of rows) {
    if (row.folder === folder || row.folder.normalize("NFC") === want) {
      await database.delete("files", row.key);
    }
  }
}

export async function writePublishedGigs(gigs: Gig[]): Promise<void> {
  await (await db()).put("meta", gigs, GIGS_KEY);
}

export async function readPublishedGigs(): Promise<Gig[]> {
  const raw = await (await db()).get("meta", GIGS_KEY);
  return Array.isArray(raw) ? (raw as Gig[]) : [];
}

function decodeText(data: ArrayBuffer): string {
  return new TextDecoder().decode(data);
}

function stubSong(folder: string): Song {
  const info = parseSongInfo(undefined);
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

export async function loadPracticeLibrary(): Promise<LibraryIndex> {
  resetSongFolders();
  const manifest = await listPracticeManifest();
  const songs: Song[] = [];
  const fileIndex: Record<string, string[]> = {};
  for (const folder of Object.keys(manifest).sort((a, b) => a.localeCompare(b))) {
    const files = (manifest[folder] ?? []).map((item) => item.path);
    const raw = await readPracticeFileBuffer(folder, "song.json");
    let packed: Record<string, unknown> | null = null;
    if (raw) {
      try {
        const parsed = JSON.parse(decodeText(raw)) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          packed = parsed as Record<string, unknown>;
        }
      } catch {
        packed = null;
      }
    }
    const settingsRaw = await readPracticeFileBuffer(folder, "settings.json");
    let info = parseSongInfo(packed?.info);
    if (!packed?.info && settingsRaw) {
      try {
        const settings = JSON.parse(decodeText(settingsRaw)) as { view?: unknown };
        if (settings.view) info = parseSongInfo(settings.view);
      } catch {
        // keep default info
      }
    }
    const base = stubSong(folder);
    const song = packed
      ? ({
          ...base,
          ...packed,
          folder,
          title: publishedSongTitle({
            id: typeof packed.id === "string" && packed.id.trim() ? packed.id : folder,
            folder,
            title: typeof packed.title === "string" ? packed.title : undefined
          }),
          id: typeof packed.id === "string" && packed.id.length > 0 ? packed.id : folder,
          assets: Array.isArray(packed.assets) ? packed.assets : base.assets,
          tempoMap:
            Array.isArray(packed.tempoMap) && packed.tempoMap.length > 0 ? packed.tempoMap : base.tempoMap,
          sections: Array.isArray(packed.sections) ? packed.sections : base.sections,
          duration: typeof packed.duration === "number" ? packed.duration : base.duration,
          info
        } as Song)
      : base;
    registerSongFolder(song.id, folder);
    registerSongFolder(folder, folder);
    const existing = songs.find((item) => item.id === song.id);
    const merged = [...new Set([...(fileIndex[song.id] ?? []), ...files])];
    if (!practiceMasterAudio(merged)) {
      const master =
        (await readPracticeFileBuffer(folder, "Master.mp3")) ??
        (await readPracticeFileBuffer(song.id, "Master.mp3")) ??
        (await readPracticeFileBuffer(folder, "Master.flac")) ??
        (await readPracticeFileBuffer(song.id, "Master.flac"));
      if (master) merged.push("Master.mp3");
    }
    fileIndex[song.id] = merged;
    if (existing) {
      existing.folder = folder;
      if (!existing.duration && song.duration) existing.duration = song.duration;
    } else {
      songs.push(song);
    }
  }
  return { songs, fileIndex };
}

export async function clearPracticeLibrary(): Promise<void> {
  const database = await db();
  await database.clear("files");
}
