import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { fileNameOf, parseSongInfo, samePracticeFolder, type Song } from "@dbk/core";
import { registerSongFolder, type LibraryIndex } from "../native/library";

const DB_NAME = "dbk-practice";
const DB_VERSION = 1;

interface PracticeDB extends DBSchema {
  files: {
    key: string;
    value: { key: string; folder: string; path: string; size: number; data: ArrayBuffer };
    indexes: { folder: string };
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
      }
    });
  }
  return dbPromise;
}

export function practiceFileKey(folder: string, path: string): string {
  return `${folder}/${path}`;
}

export async function writePracticeFile(folder: string, path: string, data: ArrayBuffer): Promise<void> {
  const keyFolder = folder.normalize("NFC");
  const keyPath = path.normalize("NFC");
  const database = await db();
  await database.put("files", {
    key: practiceFileKey(keyFolder, keyPath),
    folder: keyFolder,
    path: keyPath,
    size: data.byteLength,
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

export async function listPracticeManifest(): Promise<Record<string, { path: string; size: number }[]>> {
  const rows = await (await db()).getAll("files");
  const out: Record<string, { path: string; size: number }[]> = {};
  for (const row of rows) {
    const list = out[row.folder] ?? [];
    list.push({ path: row.path, size: row.size });
    out[row.folder] = list;
  }
  return out;
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
    let info = parseSongInfo(undefined);
    if (settingsRaw) {
      try {
        const settings = JSON.parse(decodeText(settingsRaw)) as { view?: unknown };
        if (settings.view) info = parseSongInfo(settings.view);
      } catch {
        // keep default info
      }
    }
    const song = packed
      ? ({
          ...packed,
          folder,
          title:
            typeof packed.title === "string" && packed.title.trim()
              ? packed.title.normalize("NFC")
              : folder,
          id: typeof packed.id === "string" && packed.id.length > 0 ? packed.id : folder,
          info
        } as Song)
      : stubSong(folder);
    registerSongFolder(song.id, folder);
    fileIndex[song.id] = files;
    songs.push(song);
  }
  return { songs, fileIndex };
}

export async function clearPracticeLibrary(): Promise<void> {
  const database = await db();
  await database.clear("files");
}
