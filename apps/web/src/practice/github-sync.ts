import {
  isPracticeFile,
  localFoldersNotOnRemote,
  needsClientLibraryDownload,
  publishedSongTitle,
  type ClientLibraryIndex,
  type Gig
} from "@dbk/core";
import {
  deletePracticeFile,
  deletePracticeFolder,
  listPracticeManifest,
  writePracticeFile,
  writePublishedGigs
} from "./store";

export function clientLibraryUrl(relPath = ""): string {
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

export async function fetchClientLibraryIndex(): Promise<ClientLibraryIndex | null> {
  const response = await fetch(clientLibraryUrl("index.json"), { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Library ${response.status}`);
  return (await response.json()) as ClientLibraryIndex;
}

export async function syncPublishedLibrary(): Promise<{ songs: number; files: number; gigs: number }> {
  const index = await fetchClientLibraryIndex();
  if (!index) return { songs: 0, files: 0, gigs: 0 };

  const local = await listPracticeManifest();
  const remoteFolders = new Set(index.songs.map((song) => song.folder));
  let files = 0;
  let songs = 0;

  for (const song of index.songs) {
    const have = new Map((local[song.folder] ?? []).map((item) => [item.path, item]));
    let changed = false;
    const remotePaths = new Set<string>();
    for (const file of song.files) {
      if (!isPracticeFile(file.path)) continue;
      remotePaths.add(file.path);
      if (!needsClientLibraryDownload(have.get(file.path), file)) continue;
      const response = await fetch(clientLibraryUrl(`songs/${encodeRel(song.folder)}/${encodeRel(file.path)}`), {
        cache: "no-store"
      });
      if (!response.ok) continue;
      await writePracticeFile(song.folder, file.path, await response.arrayBuffer(), file.hash);
      changed = true;
      files += 1;
    }
    for (const item of local[song.folder] ?? []) {
      if (item.path.toLowerCase() === "song.json" && ![...remotePaths].some((path) => path.toLowerCase() === "song.json")) {
        continue;
      }
      if (!remotePaths.has(item.path)) {
        await deletePracticeFile(song.folder, item.path);
        changed = true;
      }
    }
    if (changed || !local[song.folder]) songs += 1;
  }

  for (const song of index.songs) {
    const names = (await listPracticeManifest())[song.folder]?.map((item) => item.path.toLowerCase()) ?? [];
    if (names.includes("song.json")) continue;
    const body = new TextEncoder().encode(
      `${JSON.stringify(
        {
          id: song.id,
          version: 1,
          title: publishedSongTitle(song),
          folder: song.folder,
          duration: 0,
          assets: [],
          tempoMap: [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }],
          sections: []
        },
        null,
        2
      )}\n`
    );
    await writePracticeFile(
      song.folder,
      "song.json",
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    );
  }

  for (const folder of localFoldersNotOnRemote(Object.keys(local), [...remoteFolders])) {
    await deletePracticeFolder(folder);
  }

  let gigs: Gig[] = [];
  if (index.gigs) {
    const response = await fetch(clientLibraryUrl(index.gigs.path), { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as { gigs?: Gig[] };
      gigs = Array.isArray(payload.gigs) ? payload.gigs : [];
    }
  }
  await writePublishedGigs(gigs);
  return { songs, files, gigs: gigs.length };
}
