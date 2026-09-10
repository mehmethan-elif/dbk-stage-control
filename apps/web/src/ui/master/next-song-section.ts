import { isElifKonusma, isSongEntry, type Section, type SetlistEntry, type Song } from "@dbk/core";
import { findSongByRef } from "../../store/song-library";

const TIME_EPS = 0.05;

export function isPlayingLastSection(song: Song | undefined, time: number): boolean {
  const last = song?.sections.at(-1);
  if (!last) return false;
  return time + TIME_EPS >= last.start;
}

export function nextTransportEntry(
  entries: readonly SetlistEntry[],
  currentEntryId: string | undefined
): SetlistEntry | undefined {
  if (!currentEntryId) return undefined;
  const from = entries.findIndex((entry) => entry.entryId === currentEntryId);
  if (from < 0) return undefined;
  for (let i = from + 1; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    if (isElifKonusma(entry)) return entry;
    if (isSongEntry(entry) && !entry.skipped) return entry;
  }
  return undefined;
}

export function nextSetlistSongEntry(
  entries: readonly SetlistEntry[],
  currentEntryId: string | undefined
): Extract<SetlistEntry, { type: "song" }> | undefined {
  if (!currentEntryId) return undefined;
  const from = entries.findIndex((entry) => entry.entryId === currentEntryId);
  if (from < 0) return undefined;
  for (let i = from + 1; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    if (isElifKonusma(entry)) return undefined;
    if (isSongEntry(entry) && !entry.skipped) return entry;
  }
  return undefined;
}

export function upcomingSongLeadIn(
  entries: readonly SetlistEntry[],
  songs: readonly Song[],
  currentEntryId: string | undefined,
  currentSong: Song | undefined,
  time: number
): { entryId: string; song: Song; section: Section } | undefined {
  if (!isPlayingLastSection(currentSong, time)) return undefined;
  const next = nextSetlistSongEntry(entries, currentEntryId);
  if (!next) return undefined;
  const song = findSongByRef(songs, next.songId);
  const section = song?.sections[0];
  if (!song || !section) return undefined;
  return { entryId: next.entryId, song, section };
}
