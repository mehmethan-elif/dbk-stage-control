import { practiceFolderSlug } from "./practice-files.js";
import { isSongEntry, type Gig } from "./models.js";

export const CLIENT_LIBRARY_NAME = "DBK Stage Control";

export interface ClientLibraryFile {
  path: string;
  size: number;
  hash: string;
}

export interface ClientLibrarySong {
  id: string;
  folder: string;
  title?: string;
  files: ClientLibraryFile[];
}

export interface ClientLibraryIndex {
  name: string;
  songs: ClientLibrarySong[];
  gigs?: ClientLibraryFile;
}

export function lettersForMatch(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\uFFFD/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function resolvePublishedSongId(
  rawId: string,
  songs: readonly { id: string; folder?: string; title?: string }[]
): string | undefined {
  const cleaned = rawId.normalize("NFC").replace(/\uFFFD/g, "").trim();
  const exact = songs.find((song) => song.id === rawId || song.id === cleaned);
  if (exact) return exact.id;
  const want = practiceFolderSlug(cleaned || rawId);
  const bySlug = songs.find(
    (song) =>
      practiceFolderSlug(song.id) === want ||
      practiceFolderSlug(song.folder ?? "") === want ||
      practiceFolderSlug(song.title ?? "") === want
  );
  if (bySlug) return bySlug.id;
  const wantLetters = lettersForMatch(cleaned || rawId);
  if (wantLetters.length < 6) return undefined;
  let best: { id: string; distance: number } | undefined;
  for (const song of songs) {
    const have = lettersForMatch(song.id);
    const distance = editDistance(wantLetters, have);
    if (distance > 2) continue;
    if (!best || distance < best.distance) best = { id: song.id, distance };
    else if (distance === best.distance) return undefined;
  }
  return best?.id;
}

function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid = Array.from({ length: rows }, (_, i) => {
    const row = Array.from({ length: cols }, (__, j) => (i === 0 ? j : j === 0 ? i : 0));
    return row;
  });
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      grid[i]![j] = Math.min(
        (grid[i - 1]![j] ?? 0) + 1,
        (grid[i]![j - 1] ?? 0) + 1,
        (grid[i - 1]![j - 1] ?? 0) + cost
      );
    }
  }
  return grid[left.length]![right.length] ?? 99;
}

export function humanizePracticeFolder(folder: string): string {
  return folder
    .normalize("NFC")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase("tr-TR") + word.slice(1))
    .join(" ");
}

export function publishedSongTitle(song: { id: string; folder: string; title?: string }): string {
  const title = song.title?.normalize("NFC").trim();
  if (title) return title;
  const id = song.id.normalize("NFC").trim();
  const folder = song.folder.normalize("NFC").trim();
  if (id && id !== folder) return id;
  if (folder.includes("_") || (folder && folder === folder.toLowerCase())) {
    return humanizePracticeFolder(folder);
  }
  return folder || id || "—";
}

export function needsClientLibraryDownload(
  local: { size: number; hash?: string } | undefined,
  remote: { size: number; hash: string }
): boolean {
  if (!local) return true;
  if (local.hash && remote.hash) return local.hash !== remote.hash;
  return local.size !== remote.size;
}

export function localFoldersNotOnRemote(localFolders: readonly string[], remoteFolders: readonly string[]): string[] {
  const remote = new Set(remoteFolders);
  return localFolders.filter((folder) => !remote.has(folder));
}

export function dropMissingSetlistSongs(
  gigs: Gig[],
  songs: Iterable<string> | readonly { id: string; folder?: string; title?: string }[]
): Gig[] {
  const list = [...songs];
  const meta = list.every((item) => typeof item === "object")
    ? (list as { id: string; folder?: string; title?: string }[])
    : undefined;
  const ids = new Set(meta ? meta.map((song) => song.id) : (list as string[]));
  return gigs.map((gig) => ({
    ...gig,
    setlist: gig.setlist.filter((entry) => {
      if (!isSongEntry(entry)) return true;
      if (entry.skipped) return true;
      if (ids.has(entry.songId)) return true;
      return Boolean(meta && resolvePublishedSongId(entry.songId, meta));
    })
  }));
}
