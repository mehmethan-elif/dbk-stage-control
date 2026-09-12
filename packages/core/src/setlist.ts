import { hasPlaybackAudio } from "./audio-engine.js";
import type { BreakSetlistEntry, Gig, SetlistEntry, Song, SongSetlistEntry } from "./models.js";
import {
  ELIF_KONUSMA_LABEL,
  STOP_LABEL,
  FinishMode,
  PlayMode,
  entryPlayMode,
  isLockedElif,
  isSongEntry,
  isStopMarker,
  isTalkEntry,
  parseSongInfo
} from "./models.js";
import { firstSectionNamed } from "./timeline.js";

export function songEntries(gig: Gig): SongSetlistEntry[] {
  return gig.setlist.filter(isSongEntry);
}

export function visibleSetlistEntries(setlist: SetlistEntry[]): SetlistEntry[] {
  return setlist.filter((entry) => isSongEntry(entry) || isTalkEntry(entry));
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

/** After a song ends: land on STOP, otherwise the next unskipped song (ELIF is skipped). */
export function nextEndedSelectionId(
  setlist: SetlistEntry[],
  currentIndex: number
): string | null {
  for (let i = currentIndex + 1; i < setlist.length; i++) {
    const entry = setlist[i];
    if (!entry) continue;
    if (isStopMarker(entry)) return entry.entryId;
    if (isTalkEntry(entry)) continue;
    if (isSongEntry(entry) && !entry.skipped) return entry.entryId;
  }
  return null;
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
    entryPlayMode(entry, song.info) !== PlayMode.View ? song.key : parseSongInfo(song.info).key;
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
  let lastPlayable: SongSetlistEntry | undefined;
  let manualElifPending = false;
  for (const entry of visible) {
    if (isSongEntry(entry) && entry.skipped) {
      next.push(entry);
      continue;
    }
    if (isTalkEntry(entry)) {
      next.push(entry);
      manualElifPending = true;
      continue;
    }
    if (
      isSongEntry(entry) &&
      lastPlayable &&
      !manualElifPending &&
      songsHaveDifferentKeys(lastPlayable, entry, map)
    ) {
      next.push(lockedElifEntry(lastPlayable.entryId, entry.entryId));
    }
    next.push(entry);
    if (isSongEntry(entry)) {
      lastPlayable = entry;
      manualElifPending = false;
    }
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
    if (isTalkEntry(entry)) return true;
    if (isSongEntry(entry)) {
      if (entry.skipped) continue;
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
    if (entry && isTalkEntry(entry) && (last < 0 || i >= last)) return false;
  }
  return true;
}

export function trimElifAfterLastSong(setlist: SetlistEntry[]): SetlistEntry[] {
  const last = lastSongIndex(setlist);
  return setlist.filter((entry, index) => !isTalkEntry(entry) || (last >= 0 && index < last));
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

export function insertElifAfterSelected(
  setlist: SetlistEntry[],
  selectedEntryId: string | null,
  entryId: string
): SetlistEntry[] {
  if (!canInsertElifAfter(setlist, selectedEntryId)) return setlist;
  const index = setlist.findIndex((entry) => entry.entryId === selectedEntryId);
  if (index < 0) return setlist;
  const next = setlist.slice();
  next.splice(index + 1, 0, { type: "talk", entryId, label: STOP_LABEL });
  return next;
}

/** True when the song should start as metronome instead of a playback deck. */
export function songPlaysAsMetronome(
  song?: Song,
  entry?: { playMode?: PlayMode }
): boolean {
  const requested = entry?.playMode ?? song?.info?.playMode;
  if (requested === PlayMode.View || requested === PlayMode.Free) return true;
  if (requested === PlayMode.Playback || requested === PlayMode.ClickOnly) {
    return !hasPlaybackAudio(song);
  }
  return !hasPlaybackAudio(song);
}

/** Metronome START is SERBEST (song info) or the chart begins with a SERBEST section. */
export function metronomeStartsSerbest(song?: Song): boolean {
  if (parseSongInfo(song?.info).startMode === "SERBEST") return true;
  return firstSectionNamed(song?.sections, "SERBEST");
}

export function shouldAutoStartMetronome(song?: Song): boolean {
  return !metronomeStartsSerbest(song);
}

export function effectiveFinishMode(
  _entry: SongSetlistEntry,
  lastSong: boolean,
  setlist?: SetlistEntry[],
  index?: number,
  songs?: Map<string, Song>
): FinishMode {
  if (lastSong) return FinishMode.Stop;
  if (setlist && index !== undefined && nextUnskippedSongIndex(setlist, index) === -1) {
    return FinishMode.Stop;
  }
  if (setlist && index !== undefined && songFollowedByElif(setlist, index, songs)) {
    return FinishMode.Stop;
  }
  if (setlist && index !== undefined && songs) {
    const current = setlist[index];
    if (current && isSongEntry(current) && !hasPlaybackAudio(songs.get(current.songId))) {
      return FinishMode.Stop;
    }
    const next = setlist[nextUnskippedSongIndex(setlist, index)];
    const nextSong = next && isSongEntry(next) ? songs.get(next.songId) : undefined;
    if (next && isSongEntry(next) && !songPlaysAsMetronome(nextSong, next) && !hasPlaybackAudio(nextSong)) {
      return FinishMode.Stop;
    }
    if (
      next &&
      isSongEntry(next) &&
      !songPlaysAsMetronome(nextSong, next) &&
      firstSectionNamed(songs.get(next.songId)?.sections, "SERBEST")
    ) {
      return FinishMode.Stop;
    }
  }
  return FinishMode.PlayNext;
}

export function entryStartAt(entry: SongSetlistEntry, song?: Song): number {
  return Math.max(0, parseSongInfo(song?.info).startAt ?? entry.startAt ?? 0);
}

/** Where a chained PLAY_NEXT should start the following song. */
export function songChainStartAt(song: Song | undefined, entry: SongSetlistEntry): number {
  const explicit = entryStartAt(entry, song);
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
    if (!entry || !isSongEntry(entry) || entry.skipped) continue;
    const song = songs.get(entry.songId);
    if (!song) continue;
    const last = nextUnskippedSongIndex(gig.setlist, i) === -1;
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

export function keepSkippedSongsInPlace(
  original: SetlistEntry[],
  next: SetlistEntry[]
): SetlistEntry[] {
  const nextIds = new Set(next.map((entry) => entry.entryId));
  const missing = original.filter(
    (entry) => isSongEntry(entry) && entry.skipped && !nextIds.has(entry.entryId)
  );
  if (missing.length === 0) return next;
  const result = next.slice();
  for (const entry of missing) {
    const at = original.findIndex((item) => item.entryId === entry.entryId);
    let insertAt = 0;
    for (let i = at - 1; i >= 0; i--) {
      const neighbor = original[i];
      const idx = result.findIndex((item) => item.entryId === neighbor?.entryId);
      if (idx >= 0) {
        insertAt = idx + 1;
        break;
      }
    }
    result.splice(insertAt, 0, { ...entry, skipped: true });
  }
  return result;
}

export function applyRemoteSetlist(
  current: SetlistEntry[],
  incoming: readonly SetlistEntry[]
): SetlistEntry[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((entry) => [entry.entryId, entry]));
  const merged = incoming.map((entry) => {
    const existing = byId.get(entry.entryId);
    if (entry.type === "song") {
      const prior = existing && isSongEntry(existing) ? existing : undefined;
      return {
        ...(prior ?? { type: "song" as const, entryId: entry.entryId, songId: entry.songId }),
        entryId: entry.entryId,
        songId: entry.songId,
        skipped: entry.skipped ? true : undefined
      };
    }
    if (existing && existing.type !== "song") {
      return { ...existing, ...entry };
    }
    return entry;
  });
  return keepSkippedSongsInPlace(current, merged);
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
