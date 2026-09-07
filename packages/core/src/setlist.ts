import { hasBackingAudio } from "./audio-engine.js";
import type { BreakSetlistEntry, Gig, SetlistEntry, Song, SongSetlistEntry } from "./models.js";
import {
  ELIF_KONUSMA_LABEL,
  FinishMode,
  PlayMode,
  entryPlayMode,
  isElifKonusma,
  isLockedElif,
  isSongEntry,
  parseSongInfo
} from "./models.js";
import { firstSectionNamed } from "./timeline.js";

export function songEntries(gig: Gig): SongSetlistEntry[] {
  return gig.setlist.filter(isSongEntry);
}

export function visibleSetlistEntries(setlist: SetlistEntry[]): SetlistEntry[] {
  return setlist.filter((entry) => isSongEntry(entry) || isElifKonusma(entry));
}

export function findSongEntryIndex(setlist: SetlistEntry[], fromIndex: number, direction: 1 | -1): number {
  let i = fromIndex;
  while (i >= 0 && i < setlist.length) {
    const entry = setlist[i];
    if (entry && isSongEntry(entry)) return i;
    i += direction;
  }
  return -1;
}

export function nextSongIndex(setlist: SetlistEntry[], currentIndex: number): number {
  return findSongEntryIndex(setlist, currentIndex + 1, 1);
}

export function previousSongIndex(setlist: SetlistEntry[], currentIndex: number): number {
  return findSongEntryIndex(setlist, currentIndex - 1, -1);
}

export function nextUnskippedSongIndex(setlist: SetlistEntry[], currentIndex: number): number {
  let i = currentIndex + 1;
  while (i < setlist.length) {
    const entry = setlist[i];
    if (entry && isSongEntry(entry) && !entry.skipped) return i;
    i += 1;
  }
  return -1;
}

export function isLastSongEntry(setlist: SetlistEntry[], index: number): boolean {
  return nextSongIndex(setlist, index) === -1;
}

export function lastSongIndex(setlist: SetlistEntry[]): number {
  return findSongEntryIndex(setlist, setlist.length - 1, -1);
}

export function listedSongKey(song: Song | undefined, entry: SongSetlistEntry): string {
  if (!song) return "";
  const key =
    entryPlayMode(entry) === PlayMode.Playback ? song.key : parseSongInfo(song.info).key;
  return (key ?? "").trim().toLocaleUpperCase("tr-TR");
}

function songMapOf(songs: Map<string, Song> | readonly Song[]): Map<string, Song> {
  return songs instanceof Map ? songs : new Map(songs.map((song) => [song.id, song]));
}

export function songsHaveDifferentKeys(
  left: SongSetlistEntry,
  right: SongSetlistEntry,
  songs: Map<string, Song>
): boolean {
  const a = listedSongKey(songs.get(left.songId), left);
  const b = listedSongKey(songs.get(right.songId), right);
  if (!a && !b) return false;
  return a !== b;
}

export function lockedElifEntry(afterEntryId: string, beforeEntryId: string): BreakSetlistEntry {
  return {
    type: "talk",
    entryId: `elif_key_${afterEntryId}_${beforeEntryId}`,
    label: ELIF_KONUSMA_LABEL,
    locked: true
  };
}

export function withKeyChangeElifs(
  setlist: SetlistEntry[],
  songs: Map<string, Song> | readonly Song[]
): SetlistEntry[] {
  const map = songMapOf(songs);
  const visible = visibleSetlistEntries(setlist).filter((entry) => !isLockedElif(entry));
  const next: SetlistEntry[] = [];
  for (let i = 0; i < visible.length; i++) {
    const entry = visible[i];
    const prev = visible[i - 1];
    if (
      entry &&
      prev &&
      isSongEntry(prev) &&
      isSongEntry(entry) &&
      songsHaveDifferentKeys(prev, entry, map)
    ) {
      next.push(lockedElifEntry(prev.entryId, entry.entryId));
    }
    if (entry) next.push(entry);
  }
  return next;
}

export function songFollowedByElif(
  setlist: SetlistEntry[],
  index: number,
  songs?: Map<string, Song>
): boolean {
  const current = setlist[index];
  for (let i = index + 1; i < setlist.length; i++) {
    const entry = setlist[i];
    if (!entry) continue;
    if (isElifKonusma(entry)) return true;
    if (isSongEntry(entry)) {
      if (!current || !isSongEntry(current) || !songs) return false;
      return songsHaveDifferentKeys(current, entry, songs);
    }
  }
  return false;
}

export function elifPlacementValid(setlist: SetlistEntry[]): boolean {
  const last = lastSongIndex(setlist);
  for (let i = 0; i < setlist.length; i++) {
    const entry = setlist[i];
    if (entry && isElifKonusma(entry) && (last < 0 || i >= last)) return false;
  }
  return true;
}

export function trimElifAfterLastSong(setlist: SetlistEntry[]): SetlistEntry[] {
  const last = lastSongIndex(setlist);
  return setlist.filter((entry, index) => !isElifKonusma(entry) || (last >= 0 && index < last));
}

export function insertAfterSelected(
  setlist: SetlistEntry[],
  selectedEntryId: string | null | undefined,
  entry: SetlistEntry
): SetlistEntry[] {
  const index = indexAfterSelected(setlist, selectedEntryId);
  const next = setlist.slice();
  next.splice(index, 0, entry);
  return next;
}

function indexAfterSelected(
  setlist: SetlistEntry[],
  selectedEntryId: string | null | undefined
): number {
  if (!selectedEntryId) return setlist.length;
  const direct = setlist.findIndex((item) => item.entryId === selectedEntryId);
  if (direct >= 0) return direct + 1;
  const afterLocked = setlist.findIndex((item) =>
    selectedEntryId.startsWith(`elif_key_${item.entryId}_`)
  );
  if (afterLocked >= 0) return afterLocked + 1;
  return setlist.length;
}

export function canInsertElifAfter(setlist: SetlistEntry[], entryId: string | null): boolean {
  if (!entryId) return false;
  const index = setlist.findIndex((entry) => entry.entryId === entryId);
  const last = lastSongIndex(setlist);
  return index >= 0 && last >= 0 && index < last;
}

export function effectiveFinishMode(
  _entry: SongSetlistEntry,
  lastSong: boolean,
  setlist?: SetlistEntry[],
  index?: number,
  songs?: Map<string, Song>
): FinishMode {
  if (lastSong) return FinishMode.Stop;
  if (setlist && index !== undefined && songFollowedByElif(setlist, index, songs)) {
    return FinishMode.Stop;
  }
  if (setlist && index !== undefined && songs) {
    const current = setlist[index];
    if (current && isSongEntry(current) && !hasBackingAudio(songs.get(current.songId))) {
      return FinishMode.Stop;
    }
    const next = setlist[nextSongIndex(setlist, index)];
    if (next && isSongEntry(next) && !hasBackingAudio(songs.get(next.songId))) {
      return FinishMode.Stop;
    }
    if (
      next &&
      isSongEntry(next) &&
      entryPlayMode(next) === PlayMode.Playback &&
      firstSectionNamed(songs.get(next.songId)?.sections, "SERBEST")
    ) {
      return FinishMode.Stop;
    }
  }
  return FinishMode.PlayNext;
}

export function entryStartAt(entry: SongSetlistEntry): number {
  return Math.max(0, entry.startAt ?? 0);
}

/** Where a chained PLAY_NEXT should start the following song. */
export function songChainStartAt(song: Song | undefined, entry: SongSetlistEntry): number {
  const explicit = entryStartAt(entry);
  if (explicit > 0) return explicit;
  const first = song?.sections[0];
  const second = song?.sections[1];
  if (first && second && first.name.trim().toUpperCase() === "BOS") {
    return Math.max(0, second.start);
  }
  return 0;
}

export function estimateSetDuration(gig: Gig, songs: Map<string, Song>): number {
  let total = 0;
  for (let i = 0; i < gig.setlist.length; i++) {
    const entry = gig.setlist[i];
    if (!entry || !isSongEntry(entry)) continue;
    const song = songs.get(entry.songId);
    if (!song) continue;
    const last = isLastSongEntry(gig.setlist, i);
    const finish = effectiveFinishMode(entry, last, gig.setlist, i, songs);
    if (finish === FinishMode.PlayNext) {
      total += (song.nextSongAt ?? song.clickDuration ?? song.duration) || song.info?.duration || 0;
    } else {
      total += song.duration || song.info?.duration || 0;
    }
  }
  return total;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export function moveEntry(setlist: SetlistEntry[], from: number, to: number): SetlistEntry[] {
  if (from === to) return setlist.slice();
  if (from < 0 || from >= setlist.length || to < 0 || to >= setlist.length) {
    return setlist.slice();
  }
  const next = setlist.slice();
  const [item] = next.splice(from, 1);
  if (!item) return setlist.slice();
  next.splice(to, 0, item);
  return next;
}
