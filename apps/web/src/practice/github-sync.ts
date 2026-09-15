import {
  isMasterPracticeAudio,
  isPracticeFile,
  localFoldersNotOnRemote,
  publishedLibraryMissing,
  publishedSongTitle,
  type ClientLibraryFile,
  type ClientLibraryIndex,
  type ClientLibrarySong,
  type Gig
} from "@dbk/core";
import {
  deletePracticeFile,
  deletePracticeFolder,
  listPracticeManifest,
  readPracticeFileBuffer,
  writePracticeFile,
  writePublishedGigs
} from "./store";

function clientLibraryUrl(relPath = ""): string {
  const base = import.meta.env.BASE_URL || "/";
  const root = base.endsWith("/") ? `${base}client-library` : `${base}/client-library`;
  if (!relPath) return root;
  return `${root}/${relPath.replace(/^\//, "")}`;
}

function encodeRel(rel: string): string {
  return rel
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function bufferLooksLikeSongJson(data: ArrayBuffer): boolean {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as unknown;
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

async function practiceChartLooksValid(folder: string, path: string): Promise<boolean> {
  const raw = await readPracticeFileBuffer(folder, path);
  return Boolean(raw && bufferLooksLikeSongJson(raw));
}

async function fetchClientLibraryIndex(): Promise<ClientLibraryIndex | null> {
  const response = await fetch(`${clientLibraryUrl("index.json")}?t=${Date.now()}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Library ${response.status}`);
  return (await response.json()) as ClientLibraryIndex;
}

export type LibrarySyncProgress = {
  message: string;
};

type QueuedFile = { folder: string; title: string; file: ClientLibraryFile };

export type LibrarySyncResult = {
  songs: number;
  files: number;
  gigs: number;
  /** Backing tracks, still arriving after the readable files are in. Null when none are wanted. */
  tracks: Promise<number> | null;
};

export type LibrarySyncOptions = {
  /** STAGE is a viewer and never plays the tracks, so it does not carry them at all. */
  tracks?: boolean;
  onTracks?: (progress: LibrarySyncProgress) => void;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function fetchPublishedBuffer(url: string): Promise<ArrayBuffer> {
  let lastError = "Network error";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        await wait(400 * attempt);
        continue;
      }
      return await response.arrayBuffer();
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Network error";
      await wait(400 * attempt);
    }
  }
  throw new Error(lastError);
}

async function downloadQueue(
  queue: readonly QueuedFile[],
  changedFolders: Set<string>,
  onProgress?: (progress: LibrarySyncProgress) => void
): Promise<number> {
  let files = 0;
  for (const [indexNum, item] of queue.entries()) {
    onProgress?.({
      message: `Downloading ${item.title} (${indexNum + 1}/${queue.length})…`
    });
    const payload = await fetchPublishedBuffer(
      clientLibraryUrl(`songs/${encodeRel(item.folder)}/${encodeRel(item.file.path)}`)
    );
    if (item.file.path.toLowerCase() === "song.json" && !bufferLooksLikeSongJson(payload)) {
      throw new Error(`Could not download ${item.title}: song.json`);
    }
    await writePracticeFile(item.folder, item.file.path, payload, item.file.hash);
    changedFolders.add(item.folder);
    files += 1;
  }
  return files;
}

export async function syncPublishedLibrary(
  onProgress?: (progress: LibrarySyncProgress) => void,
  options: LibrarySyncOptions = {}
): Promise<LibrarySyncResult> {
  onProgress?.({ message: "Checking library…" });
  const index = await fetchClientLibraryIndex();
  if (!index) return { songs: 0, files: 0, gigs: 0, tracks: null };

  const local = await listPracticeManifest();
  const remoteFolders = new Set(index.songs.map((song) => song.folder));
  const queue = publishedLibraryMissing(index, local);
  for (const song of index.songs) {
    const chart = song.files.find((file) => file.path.toLowerCase() === "song.json");
    if (!chart) continue;
    if (await practiceChartLooksValid(song.folder, chart.path)) continue;
    if (queue.some((item) => item.folder === song.folder && item.file.path === chart.path)) continue;
    queue.push({ folder: song.folder, title: publishedSongTitle(song), file: chart });
  }

  // Backing tracks are around seven eighths of the download, and nothing reads them off the
  // screen. STAGE skips them outright; PRACTICE takes them, but only once the caller has been
  // handed back control, so the charts are up in seconds instead of behind megabytes of audio.
  const trackQueue = options.tracks === false ? [] : queue.filter((item) => isMasterPracticeAudio(item.file.path));
  const readable = queue.filter((item) => !isMasterPracticeAudio(item.file.path));

  let songs = 0;
  const changedFolders = new Set<string>();
  const files = await downloadQueue(readable, changedFolders, onProgress);

  for (const song of index.songs) {
    const remotePaths = new Set(
      song.files.filter((file) => isPracticeFile(file.path)).map((file) => file.path)
    );
    for (const item of local[song.folder] ?? []) {
      if (item.path.toLowerCase() === "song.json" && !remotePaths.has(item.path)) continue;
      if (!remotePaths.has(item.path)) {
        await deletePracticeFile(song.folder, item.path);
        changedFolders.add(song.folder);
      }
    }
    await applyPublishedSongTitle(song);
    if (changedFolders.has(song.folder) || !local[song.folder]) songs += 1;
  }

  // Only what was promised for this phase: the tracks are deliberately still missing here.
  const leftover = publishedLibraryMissing(index, await listPracticeManifest()).filter(
    (item) => !isMasterPracticeAudio(item.file.path)
  );
  if (leftover.length > 0) {
    const first = leftover[0];
    throw new Error(`Library incomplete: ${first?.title ?? "song"} (${leftover.length} files left).`);
  }

  for (const folder of localFoldersNotOnRemote(Object.keys(local), [...remoteFolders])) {
    await deletePracticeFolder(folder);
  }

  let gigs: Gig[] = [];
  if (index.gigs) {
    onProgress?.({ message: "Downloading setlist…" });
    const payload = JSON.parse(
      new TextDecoder().decode(await fetchPublishedBuffer(clientLibraryUrl(index.gigs.path)))
    ) as { gigs?: Gig[] };
    gigs = Array.isArray(payload.gigs) ? payload.gigs : [];
  }
  await writePublishedGigs(gigs);
  onProgress?.({ message: "Library ready." });

  const tracks =
    trackQueue.length > 0
      ? downloadQueue(trackQueue, new Set<string>(), options.onTracks ?? onProgress)
      : null;

  return { songs, files, gigs: gigs.length, tracks };
}

async function applyPublishedSongTitle(song: ClientLibrarySong): Promise<void> {
  const title = publishedSongTitle(song);
  const raw = await readPracticeFileBuffer(song.folder, "song.json");
  if (!raw) return;
  try {
    const packed = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
    const current = typeof packed.title === "string" ? packed.title.trim() : "";
    if (current === title) return;
    if (current && current !== song.folder && current !== song.id) return;
    packed.title = title;
    if (typeof packed.id !== "string" || !packed.id.trim()) packed.id = song.id;
    const body = new TextEncoder().encode(`${JSON.stringify(packed, null, 2)}\n`);
    await writePracticeFile(
      song.folder,
      "song.json",
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    );
  } catch {
    // keep the downloaded song file
  }
}
