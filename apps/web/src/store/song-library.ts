import {
  isSongEntry,
  parseSongInfo,
  resolvePublishedSongId,
  type Gig,
  type SetlistEntry,
  type Song
} from "@dbk/core";
import { practiceEntryId } from "../practice/gig";

export const SONG_LIBRARY_GIG_ID = "__song_library__";
export const SONG_LIBRARY_NAME = "Song Library";

export function songLibraryEntryId(songId: string): string {
  return `song_library_${songId}`;
}

let cachedLibrarySongs: readonly Song[] | undefined;
let cachedLibraryGig: Gig | undefined;
let cachedListedGigs: readonly Gig[] | undefined;
let cachedListedSongs: readonly Song[] | undefined;
let cachedListed: Gig[] | undefined;

export function songLibraryGig(songs: readonly Song[], previous?: Gig): Gig {
  const performanceMode = isSongLibraryGig(previous) ? previous.performanceMode : undefined;
  const stageNames = isSongLibraryGig(previous) ? previous.stageNames : undefined;
  if (
    cachedLibraryGig &&
    cachedLibrarySongs === songs &&
    cachedLibraryGig.performanceMode === performanceMode &&
    cachedLibraryGig.stageNames === stageNames
  ) {
    return cachedLibraryGig;
  }
  cachedLibrarySongs = songs;
  cachedLibraryGig = {
    id: SONG_LIBRARY_GIG_ID,
    name: SONG_LIBRARY_NAME,
    date: "",
    musicians: [],
    setlist: songs.map((song) => ({
      type: "song" as const,
      entryId: songLibraryEntryId(song.id),
      songId: song.id
    })),
    ...(performanceMode ? { performanceMode } : {}),
    ...(stageNames ? { stageNames } : {})
  };
  return cachedLibraryGig;
}

export function isSongLibraryGig(gig: Gig | undefined): boolean {
  return gig?.id === SONG_LIBRARY_GIG_ID;
}

export function listedGigs(gigs: readonly Gig[], songs: readonly Song[]): Gig[] {
  if (cachedListed && cachedListedGigs === gigs && cachedListedSongs === songs) {
    return cachedListed;
  }
  const saved = gigs.filter((gig) => !isSongLibraryGig(gig));
  const previousLibrary = gigs.find((gig) => isSongLibraryGig(gig));
  cachedListedGigs = gigs;
  cachedListedSongs = songs;
  cachedListed = [songLibraryGig(songs, previousLibrary), ...saved];
  return cachedListed;
}

export function setlistNameTaken(
  gigs: readonly Gig[],
  name: string,
  exceptId?: string | null
): boolean {
  const key = name.trim().toLowerCase();
  if (!key || key === SONG_LIBRARY_NAME.toLowerCase()) return true;
  return gigs.some(
    (gig) =>
      !isSongLibraryGig(gig) && gig.id !== exceptId && gig.name.trim().toLowerCase() === key
  );
}

export function selectedLibraryEntries(
  entries: readonly SetlistEntry[],
  selectedEntryId: string | null
): SetlistEntry[] {
  const selected = selectedEntryId
    ? entries.find((entry) => entry.entryId === selectedEntryId)
    : undefined;
  if (selected) return [selected];
  const first = entries.find(isSongEntry);
  return first ? [first] : [];
}

export function librarySongIdFromEntry(
  gig: Gig | undefined,
  entryId: string | null
): string | null {
  if (!gig || !entryId) return null;
  const entry = gig.setlist.find((item) => item.entryId === entryId);
  return entry && isSongEntry(entry) ? entry.songId : null;
}

export function pickLibraryEntryId(
  songs: readonly Song[],
  rememberedSongId: string | null,
  fallbackSongId: string | null
): string | null {
  const remembered = findSongByRef(songs, rememberedSongId ?? undefined);
  if (remembered) return songLibraryEntryId(remembered.id);
  const fallback = findSongByRef(songs, fallbackSongId ?? undefined);
  if (fallback) return songLibraryEntryId(fallback.id);
  return songs[0] ? songLibraryEntryId(songs[0].id) : null;
}

export function findSongByRef(songs: readonly Song[], songId: string | undefined): Song | undefined {
  if (!songId) return undefined;
  const exact = songs.find((song) => song.id === songId || song.folder === songId);
  if (exact) return exact;
  const resolved = resolvePublishedSongId(songId, songs);
  return resolved ? songs.find((song) => song.id === resolved) : undefined;
}

export function librarySongsNotOnSetlist(songs: Song[], entries: SetlistEntry[]): Song[] {
  const onSetlist = entries.filter(isSongEntry);
  return songs.filter(
    (song) =>
      !onSetlist.some(
        (entry) =>
          entry.songId === song.id ||
          entry.songId === song.folder ||
          resolvePublishedSongId(entry.songId, [song]) === song.id
      )
  );
}

export function withSelectedLibrarySong(
  entries: SetlistEntry[],
  songs: Song[],
  selectedEntryId: string | null
): SetlistEntry[] {
  if (!selectedEntryId) return entries;
  if (entries.some((entry) => entry.entryId === selectedEntryId)) return entries;
  const song =
    songs.find(
      (item) =>
        practiceEntryId(item.id) === selectedEntryId ||
        practiceEntryId(item.folder ?? "") === selectedEntryId ||
        item.id === selectedEntryId
    ) ??
    (selectedEntryId.startsWith("practice_")
      ? findSongByRef(songs, selectedEntryId.slice("practice_".length))
      : findSongByRef(songs, selectedEntryId));
  if (!song) return entries;
  return [...entries, { type: "song", entryId: practiceEntryId(song.id), songId: song.id }];
}

/** Copy master song.info onto practice songs so client icons match without stems. */
export function overlayHostSongMeta(practice: Song[], host: Song[]): Song[] {
  if (host.length === 0) return practice;
  return practice.map((song) => {
    const hostId =
      resolvePublishedSongId(song.id, host) ??
      (song.folder ? resolvePublishedSongId(song.folder, host) : undefined) ??
      (song.title ? resolvePublishedSongId(song.title, host) : undefined);
    const hostSong = hostId ? host.find((item) => item.id === hostId) : undefined;
    if (!hostSong) return song;
    const local = parseSongInfo(song.info);
    const remote = parseSongInfo(hostSong.info);
    const thinChart = song.sections.length === 0;
    return {
      ...song,
      title: hostSong.title?.trim() || song.title,
      key: hostSong.key ?? song.key,
      scale: hostSong.scale ?? song.scale,
      style: hostSong.style ?? song.style,
      kita: hostSong.kita ?? song.kita,
      duration: song.duration > 0 ? song.duration : hostSong.duration,
      nextSongAt: song.nextSongAt ?? hostSong.nextSongAt,
      tempoMap: thinChart && hostSong.tempoMap.length > 0 ? hostSong.tempoMap : song.tempoMap,
      sections: thinChart ? hostSong.sections : song.sections,
      lyrics: (song.lyrics?.length ?? 0) > 0 ? song.lyrics : hostSong.lyrics,
      chords: (song.chords?.length ?? 0) > 0 ? song.chords : hostSong.chords,
      patterns: (song.patterns?.length ?? 0) > 0 ? song.patterns : hostSong.patterns,
      info: parseSongInfo({
        ...local,
        ...remote,
        kita: remote.kita ?? hostSong.kita ?? local.kita ?? song.kita,
        pageNotes: { ...local.pageNotes, ...remote.pageNotes },
        metroNotes: { ...local.metroNotes, ...remote.metroNotes }
      })
    };
  });
}
