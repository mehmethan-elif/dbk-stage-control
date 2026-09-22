import {
  isSongEntry,
  isTalkEntry,
  secondsPerMeasure,
  tempoAt,
  type Section,
  type SetlistEntry,
  type Song
} from "@dbk/core";
import { findSongByRef } from "../../store/song-library";

const TIME_EPS = 0.05;
const LEAD_IN_MIN_SECONDS = 8;

export function isPlayingLastSection(song: Song | undefined, time: number): boolean {
  const last = song?.sections.at(-1);
  if (!last) return false;
  return time + TIME_EPS >= last.start;
}

export function upcomingLeadInWindowSeconds(song: Song | undefined, time: number): number {
  const point = tempoAt(song?.tempoMap ?? [], time);
  return Math.max(LEAD_IN_MIN_SECONDS, secondsPerMeasure(point) * 2);
}

/** Last two bars, or the last 8 seconds — not the whole last section. */
export function isUpcomingLeadInTime(song: Song | undefined, time: number): boolean {
  if (!song) return false;
  const last = song.sections.at(-1);
  const end = Math.max(song.duration, last?.end ?? 0);
  if (end <= 0) return false;
  if (last && time + TIME_EPS < last.start) return false;
  return end - time <= upcomingLeadInWindowSeconds(song, time) + TIME_EPS;
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
    if (isTalkEntry(entry)) return entry;
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
    if (isTalkEntry(entry)) return undefined;
    if (isSongEntry(entry) && !entry.skipped) return entry;
  }
  return undefined;
}

/** Next unskipped song, skipping ELIF KONUSMA so the transport pulse can keep running. */
export function nextTransportSongEntry(
  entries: readonly SetlistEntry[],
  currentEntryId: string | undefined
): Extract<SetlistEntry, { type: "song" }> | undefined {
  if (!currentEntryId) return undefined;
  const from = entries.findIndex((entry) => entry.entryId === currentEntryId);
  if (from < 0) return undefined;
  for (let i = from + 1; i < entries.length; i++) {
    const entry = entries[i];
    if (entry && isSongEntry(entry) && !entry.skipped) return entry;
  }
  return undefined;
}

export function songLeadInSection(song: Song | undefined): Section | undefined {
  if (!song) return undefined;
  const first = song.sections[0];
  if (first) return first;
  return { name: song.title, start: 0, end: Math.max(song.duration, 1) };
}

const HANDOFF_SCROLL_PREFIX = "handoff:";

/** Engine already opened the next song (time ≈ 0) while the page still names this one. */
export function songHandoffRewind(prevTime: number, time: number, duration: number): boolean {
  if (!(duration > 0) || !(prevTime > 0)) return false;
  const late = Math.max(8, duration * 0.05);
  return prevTime >= duration - late && time < 1 && time + 2 < prevTime;
}

export function outgoingSongHandoff(opts: {
  playingEntryId: string | undefined;
  clockEntryId: string | undefined;
  prevTime: number;
  time: number;
  duration: number;
  nextEntryId: string | undefined;
}): string | undefined {
  if (!opts.playingEntryId) return undefined;
  const clockMoved =
    Boolean(opts.clockEntryId) &&
    opts.clockEntryId !== opts.playingEntryId &&
    (opts.time < 2 || songHandoffRewind(opts.prevTime, opts.time, opts.duration));
  if (clockMoved) return opts.clockEntryId;
  if (songHandoffRewind(opts.prevTime, opts.time, opts.duration)) return opts.nextEntryId;
  return undefined;
}

export function handoffScrollKey(entryId: string): string {
  return `${HANDOFF_SCROLL_PREFIX}${entryId}`;
}

export function handoffScrollEntryId(key: string): string | undefined {
  return key.startsWith(HANDOFF_SCROLL_PREFIX) ? key.slice(HANDOFF_SCROLL_PREFIX.length) || undefined : undefined;
}

/** Keep the next song until the playhead actually belongs to it — one wrap frame is not enough. */
export function nextSongFollowId(opts: {
  playingEntryId: string | undefined;
  clockEntryId: string | undefined;
  upcomingId: string | undefined;
  latchedId: string | undefined;
  prevTime: number;
  time: number;
  duration: number;
  nextEntryId: string | undefined;
}): string | undefined {
  const detected =
    outgoingSongHandoff({
      playingEntryId: opts.playingEntryId,
      clockEntryId: opts.clockEntryId,
      prevTime: opts.prevTime,
      time: opts.time,
      duration: opts.duration,
      nextEntryId: opts.nextEntryId
    }) ?? opts.upcomingId;
  if (opts.latchedId && (opts.clockEntryId === opts.latchedId || opts.playingEntryId === opts.latchedId)) {
    return undefined;
  }
  if (detected) return detected;
  if (opts.latchedId && opts.playingEntryId !== opts.latchedId) return opts.latchedId;
  return undefined;
}

/** Outgoing song clock wrapped to bar 1 while the next song is already the follow target. */
export function ignoreOutgoingPlayhead(
  song: Song | undefined,
  time: number,
  chainNext: boolean
): boolean {
  if (!chainNext || !song) return false;
  return time < 1;
}

export function upcomingSongLeadIn(
  entries: readonly SetlistEntry[],
  songs: readonly Song[],
  currentEntryId: string | undefined,
  currentSong: Song | undefined,
  time: number
): { entryId: string; song: Song; section: Section } | undefined {
  if (!isUpcomingLeadInTime(currentSong, time)) return undefined;
  const next = nextSetlistSongEntry(entries, currentEntryId);
  if (!next) return undefined;
  const song = findSongByRef(songs, next.songId);
  const section = songLeadInSection(song);
  if (!song || !section) return undefined;
  return { entryId: next.entryId, song, section };
}
