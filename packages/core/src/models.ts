import type { MixerBank } from "./mixer.js";
import { snapSongToMeasureGrid } from "./timeline.js";

export const FinishMode = {
  Stop: "STOP",
  PlayNext: "PLAY_NEXT"
} as const;

export type FinishMode = (typeof FinishMode)[keyof typeof FinishMode];

export const PlayMode = {
  View: "VIEW",
  Playback: "PLAYBACK",
  ClickOnly: "CLICK_ONLY"
} as const;

export type PlayMode = (typeof PlayMode)[keyof typeof PlayMode];

export const SetlistPerformanceMode = {
  FollowSongInfo: "FOLLOW_SONG_INFO",
  ClickOnly: "CLICK_ONLY",
  MetronomeContinuous: "METRONOME_CONTINUOUS",
  Free: "FREE"
} as const;

export type SetlistPerformanceMode =
  (typeof SetlistPerformanceMode)[keyof typeof SetlistPerformanceMode];

export function entryPlayMode(
  entry: { playMode?: PlayMode } | undefined,
  info?: { playMode?: PlayMode }
): PlayMode {
  if (info?.playMode === PlayMode.Playback) return PlayMode.Playback;
  if (info?.playMode === PlayMode.ClickOnly) return PlayMode.ClickOnly;
  if (info?.playMode === PlayMode.View) return PlayMode.View;
  if (entry?.playMode === PlayMode.ClickOnly) return PlayMode.ClickOnly;
  return entry?.playMode === PlayMode.Playback ? PlayMode.Playback : PlayMode.View;
}

export const AppMode = {
  Preparation: "PREPARATION",
  Performance: "PERFORMANCE"
} as const;

export type AppMode = (typeof AppMode)[keyof typeof AppMode];

export const PlaybackState = {
  Idle: "IDLE",
  Loading: "LOADING",
  Ready: "READY",
  Playing: "PLAYING",
  Transitioning: "TRANSITIONING",
  Stopping: "STOPPING",
  Error: "ERROR"
} as const;

export type PlaybackState = (typeof PlaybackState)[keyof typeof PlaybackState];

export const BusId = {
  Main: "MAIN",
  Cue: "CUE"
} as const;

export type BusId = (typeof BusId)[keyof typeof BusId];

export const DeckId = {
  A: "A",
  B: "B"
} as const;

export type DeckId = (typeof DeckId)[keyof typeof DeckId];

export const KNOWN_ROLES = ["vocal", "guitar", "baglama", "kaval"] as const;
export type KnownRoleId = (typeof KNOWN_ROLES)[number];
export type RoleId = KnownRoleId | (string & {});

export const ROLE_LABELS: Record<KnownRoleId, string> = {
  vocal: "Vocal",
  guitar: "Guitar",
  baglama: "Bağlama",
  kaval: "Kaval"
};

export function roleLabel(role: RoleId): string {
  if (role in ROLE_LABELS) return ROLE_LABELS[role as KnownRoleId];
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export type AssetKind = "audio" | "musicxml" | "lyrics" | "chords" | "timeline";
export type AudioRole = "backing" | "click" | "cue" | "stem";

export interface AssetRef {
  id: string;
  kind: AssetKind;
  role?: RoleId;
  audioRole?: AudioRole;
  bus?: BusId;
  path: string;
  hash: string;
  label?: string;
}

export interface TempoPoint {
  time: number;
  measure: number;
  bpm: number;
  numerator: number;
  denominator: number;
}

export interface Section {
  name: string;
  start: number;
  end: number;
}

export interface LyricLine {
  time: number;
  end?: number;
  measure: number;
  beat?: number;
  text: string;
}

export interface PatternNote {
  time: number;
  end?: number;
  pitch: number;
  channel?: number;
  velocity?: number;
  measure?: number;
  beat?: number;
  numerator: number;
  denominator: number;
}

export interface ChordEvent extends LyricLine {
  notes?: PatternNote[];
}

export interface PatternEvent {
  text: string;
  time: number;
  end: number;
  length: number;
  measure: number;
  beat?: number;
  numerator: number;
  denominator: number;
  notes: PatternNote[];
}

export interface SongInfo {
  bpm: number;
  numerator: number;
  denominator: number;
  beats?: boolean[];
  startMode?: "COUNT" | "SERBEST";
  duration?: number;
  key?: string;
  scale?: string;
  style?: string;
  notes?: string;
  playMode?: PlayMode;
  startAt?: number;
  pageNotes?: Partial<Record<"lyrics" | "score" | "chord" | "drums", string>>;
}

export const DEFAULT_METRONOME_BPM = 120;
export const DEFAULT_METRONOME_NUMERATOR = 4;
export const DEFAULT_METRONOME_DENOMINATOR = 4;

export interface Song {
  id: string;
  version: number;
  title: string;
  folder?: string;
  duration: number;
  clickDuration?: number;
  nextSongAt?: number;
  key?: string;
  scale?: string;
  style?: string;
  assets: AssetRef[];
  tempoMap: TempoPoint[];
  sections: Section[];
  lyrics?: LyricLine[];
  chords?: ChordEvent[];
  patterns?: PatternEvent[];
  tags?: string[];
  info?: SongInfo;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

export function clickBeats(numerator: number, raw?: unknown): boolean[] {
  const count = Math.max(1, Math.floor(numerator) || DEFAULT_METRONOME_NUMERATOR);
  const stored = Array.isArray(raw) && raw.length > 0 ? raw : undefined;
  return Array.from({ length: count }, (_, i) => (stored ? stored[i] === true : i === 0));
}

export function parseSongInfo(raw: unknown): SongInfo {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
  const numerator = positiveInt(record?.numerator, DEFAULT_METRONOME_NUMERATOR);
  const info: SongInfo = {
    bpm: positiveInt(record?.bpm, DEFAULT_METRONOME_BPM),
    numerator,
    denominator: positiveInt(record?.denominator, DEFAULT_METRONOME_DENOMINATOR),
    beats: clickBeats(numerator, record?.beats)
  };
  const duration = positiveInt(record?.duration, 0);
  if (duration > 0) info.duration = duration;
  if (record?.startMode === "COUNT" || record?.startMode === "SERBEST") {
    info.startMode = record.startMode;
  }
  const key = optionalText(record?.key);
  const scale = optionalText(record?.scale);
  const style = optionalText(record?.style);
  const notes = optionalText(record?.notes);
  if (key) info.key = key;
  if (scale) info.scale = scale;
  if (style) info.style = style;
  if (notes) info.notes = notes;
  if (
    record?.playMode === PlayMode.View ||
    record?.playMode === PlayMode.Playback ||
    record?.playMode === PlayMode.ClickOnly
  ) {
    info.playMode = record.playMode;
  }
  const startAt = Number(record?.startAt);
  if (Number.isFinite(startAt) && startAt >= 0) info.startAt = startAt;
  if (record?.pageNotes && typeof record.pageNotes === "object") {
    const pageNotes: NonNullable<SongInfo["pageNotes"]> = {};
    for (const page of ["lyrics", "score", "chord", "drums"] as const) {
      const text = optionalText((record.pageNotes as Record<string, unknown>)[page]);
      if (text) pageNotes[page] = text;
    }
    if (Object.keys(pageNotes).length > 0) info.pageNotes = pageNotes;
  }
  return info;
}

export function songInfoFromPlayback(
  song: Pick<Song, "duration" | "tempoMap" | "key" | "scale" | "style">
): SongInfo {
  const point = song.tempoMap?.[0];
  return parseSongInfo({
    bpm: point?.bpm,
    numerator: point?.numerator,
    denominator: point?.denominator,
    duration: song.duration,
    key: song.key,
    scale: song.scale,
    style: song.style
  });
}

export function normalizeSong(raw: unknown, folder?: string): Song {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const info = parseSongInfo(record.info);
  const folderName =
    (typeof record.folder === "string" && record.folder.trim()) || folder?.trim() || "";
  const id = (typeof record.id === "string" && record.id.trim()) || folderName || "song";
  const title = (typeof record.title === "string" && record.title.trim()) || folderName || id;
  const duration = Number(record.duration);
  return snapSongToMeasureGrid({
    id,
    version: positiveInt(record.version, 1),
    title,
    folder: folderName || undefined,
    duration: Number.isFinite(duration) && duration >= 0 ? duration : (info.duration ?? 0),
    clickDuration: typeof record.clickDuration === "number" ? record.clickDuration : undefined,
    nextSongAt: typeof record.nextSongAt === "number" ? record.nextSongAt : undefined,
    key: typeof record.key === "string" ? record.key : info.key,
    scale: typeof record.scale === "string" ? record.scale : info.scale,
    style: typeof record.style === "string" ? record.style : info.style,
    assets: Array.isArray(record.assets) ? (record.assets as AssetRef[]) : [],
    tempoMap:
      Array.isArray(record.tempoMap) && record.tempoMap.length > 0
        ? (record.tempoMap as TempoPoint[])
        : metronomeTempoMap(info),
    sections: Array.isArray(record.sections) ? (record.sections as Section[]) : [],
    lyrics: Array.isArray(record.lyrics) ? (record.lyrics as LyricLine[]) : undefined,
    chords: Array.isArray(record.chords) ? (record.chords as ChordEvent[]) : undefined,
    patterns: Array.isArray(record.patterns) ? (record.patterns as PatternEvent[]) : undefined,
    tags: Array.isArray(record.tags) ? (record.tags as string[]) : undefined,
    info
  });
}

export function metronomeTempoMap(info: SongInfo | undefined): TempoPoint[] {
  const parsed = parseSongInfo(info);
  return [
    {
      time: 0,
      measure: 1,
      bpm: parsed.bpm,
      numerator: parsed.numerator,
      denominator: parsed.denominator
    }
  ];
}

export function metronomeSongView(song: Song): Song {
  const info = parseSongInfo(song.info);
  return {
    ...song,
    duration: info.duration ?? song.duration,
    key: info.key ?? song.key,
    scale: info.scale ?? song.scale,
    style: info.style ?? song.style,
    tempoMap: song.info ? metronomeTempoMap(info) : song.tempoMap
  };
}

function visibleSongName(value: string | undefined): string {
  return value?.normalize("NFC").trim() ?? "";
}

export function songDisplayName(song: Pick<Song, "title" | "folder"> | undefined): string {
  return visibleSongName(song?.title) || visibleSongName(song?.folder) || "—";
}

export function songPlaybackName(song: Pick<Song, "title" | "folder"> | undefined): string {
  return visibleSongName(song?.title) || visibleSongName(song?.folder) || "—";
}

export interface Musician {
  id: string;
  name: string;
  defaultRole: RoleId;
  notes?: string;
}

export interface GigMusician {
  musicianId: string;
  role: RoleId;
}

export interface SongSetlistEntry {
  type: "song";
  entryId: string;
  songId: string;
  /** Legacy/runtime fields. Persisted setlists store only identity and order. */
  finishMode?: FinishMode;
  playMode?: PlayMode;
  skipped?: boolean;
  startAt?: number;
  notes?: string;
}

export interface BreakSetlistEntry {
  type: "break" | "talk" | "costume_change" | "set_marker";
  entryId: string;
  label: string;
  locked?: boolean;
}

export type SetlistEntry = SongSetlistEntry | BreakSetlistEntry;

export interface Gig {
  id: string;
  name: string;
  date: string;
  venue?: string;
  notes?: string;
  musicians: GigMusician[];
  setlist: SetlistEntry[];
  busMix?: MixerBank;
  metronomeVolume?: number;
  performanceMode?: SetlistPerformanceMode;
  stageNames?: string[];
}

export interface PerformanceClock {
  songId: string;
  setlistEntryId: string;
  time: number;
  measure: number;
  beat: number;
  section?: string;
  playing: boolean;
  nextSongId?: string;
  finishMode?: FinishMode;
}

export type HardwareOutputId = string;

export interface HardwareOutput {
  id: HardwareOutputId;
  label: string;
  channels: number;
}

export interface LoadedTrack {
  id: string;
  asset: AssetRef;
  duration: number;
  payload?: unknown;
}

export interface LoadedBuffers {
  tracks: LoadedTrack[];
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function isSongEntry(entry: SetlistEntry): entry is SongSetlistEntry {
  return entry.type === "song";
}

export const ELIF_KONUSMA_LABEL = "ELIF KONUSMA";

export function isElifKonusma(entry: SetlistEntry): entry is BreakSetlistEntry {
  return entry.type === "talk" && entry.label === ELIF_KONUSMA_LABEL;
}

export function isLockedElif(entry: SetlistEntry): entry is BreakSetlistEntry {
  return isElifKonusma(entry) && entry.locked === true;
}
