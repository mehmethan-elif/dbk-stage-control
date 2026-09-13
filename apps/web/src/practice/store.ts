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
const DB_VERSION = 3;
const GIGS_KEY = "published-gigs";

interface PracticeFileRow {
  key: string;
  folder: string;
  path: string;
  size: number;
  hash?: string;
  data: ArrayBuffer;
}

/**
 * The same rows as `files` minus the payload. Reading a manifest used to mean `getAll` on
 * `files`, which pulls every stem and score into memory just to list paths and sizes — and
 * that runs on every library load and twice per sync.
 */
type PracticeMetaRow = Omit<PracticeFileRow, "data">;

interface PracticeDB extends DBSchema {
  files: {
    key: string;
    value: PracticeFileRow;
    indexes: { folder: string };
  };
  manifest: {
    key: string;
    value: PracticeMetaRow;
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
      async upgrade(database, _from, _to, tx) {
        if (!database.objectStoreNames.contains("files")) {
          const store = database.createObjectStore("files", { keyPath: "key" });
          store.createIndex("folder", "folder");
        }
        if (!database.objectStoreNames.contains("meta")) {
          database.createObjectStore("meta");
        }
        if (!database.objectStoreNames.contains("manifest")) {
          const store = database.createObjectStore("manifest", { keyPath: "key" });
          store.createIndex("folder", "folder");
          // Backfill from any library stored before this store existed. Walked with a
          // cursor so only one file's bytes are resident at a time.
          let cursor = await tx.objectStore("files").openCursor();
          while (cursor) {
            const { key, folder, path, size, hash } = cursor.value;
            await tx.objectStore("manifest").put({ key, folder, path, size, hash });
            cursor = await cursor.continue();
          }
        }
      },
      blocked() {
        // another tab holds the old version; it will retry on next open
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
  const meta: PracticeMetaRow = {
    key: practiceFileKey(keyFolder, keyPath),
    folder: keyFolder,
    path: keyPath,
    size: data.byteLength,
    hash
  };
  await database.put("files", { ...meta, data });
  await database.put("manifest", meta);
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
  // Last resort: find the key through the metadata store so this scan does not have to
  // deserialize every stored file, then fetch only the one that matched.
  const wantPath = fileNameOf(path).toLowerCase();
  for (const row of await database.getAll("manifest")) {
    if (samePracticeFolder(row.folder, folder) && fileNameOf(row.path).toLowerCase() === wantPath) {
      return (await database.get("files", row.key))?.data ?? null;
    }
  }
  return null;
}

/**
 * Rebuilds the metadata store if it does not describe every stored file. It is filled in as
 * files are written and backfilled when the database version changes, but a version change
 * transaction is allowed to commit before a long backfill has walked every row — and a
 * manifest missing entries would report songs as having no audio. Walked with a cursor, so
 * only one file's bytes are resident at a time.
 */
async function repairManifest(database: IDBPDatabase<PracticeDB>): Promise<void> {
  const [files, manifest] = await Promise.all([
    database.count("files"),
    database.count("manifest")
  ]);
  if (files === manifest) return;
  const tx = database.transaction(["files", "manifest"], "readwrite");
  await tx.objectStore("manifest").clear();
  let cursor = await tx.objectStore("files").openCursor();
  while (cursor) {
    const { key, folder, path, size, hash } = cursor.value;
    await tx.objectStore("manifest").put({ key, folder, path, size, hash });
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function listPracticeManifest(): Promise<
  Record<string, { path: string; size: number; hash?: string }[]>
> {
  const database = await db();
  await repairManifest(database);
  const rows = await database.getAll("manifest");
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
  await dropFile(database, practiceFileKey(wantFolder, wantPath));
  const wantName = fileNameOf(path).toLowerCase();
  for (const row of await database.getAll("manifest")) {
    if (samePracticeFolder(row.folder, folder) && fileNameOf(row.path).toLowerCase() === wantName) {
      await dropFile(database, row.key);
    }
  }
}

async function dropFile(database: IDBPDatabase<PracticeDB>, key: string): Promise<void> {
  await database.delete("files", key);
  await database.delete("manifest", key);
}

export async function deletePracticeFolder(folder: string): Promise<void> {
  const database = await db();
  const want = folder.normalize("NFC");
  for (const row of await database.getAll("manifest")) {
    if (row.folder === folder || row.folder.normalize("NFC") === want) {
      await dropFile(database, row.key);
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
    if (settingsRaw) {
      try {
        const settings = JSON.parse(decodeText(settingsRaw)) as {
          view?: unknown;
          metroNotes?: { lyrics?: string; drums?: string };
        };
        if (!packed?.info && settings.view) info = parseSongInfo(settings.view);
        info = parseSongInfo({
          ...info,
          metroNotes: { ...settings.metroNotes, ...info.metroNotes }
        });
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
      // The manifest already knows what is stored, so this no longer reads up to four
      // whole audio files into memory per song just to decide whether a master mix exists.
      // It also records the name that is actually there instead of always claiming .mp3.
      const stored = [...(manifest[folder] ?? []), ...(manifest[song.id] ?? [])].map((item) => item.path);
      const master = practiceMasterAudio(stored);
      if (master) merged.push(master);
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

