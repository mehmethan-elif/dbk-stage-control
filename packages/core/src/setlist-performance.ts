import { hasBackingAudio, hasClickFlac } from "./audio-engine.js";
import {
  PlayMode,
  SetlistPerformanceMode,
  parseSongInfo,
  type Song
} from "./models.js";

const MODE_VALUES = new Set<string>(Object.values(SetlistPerformanceMode));
const LEGACY_METRONOME_MODES = new Set(["METRONOME_AUTO_STOP", "METRONOME_VISUAL_ONLY"]);

export function parseSetlistPerformanceMode(raw: unknown): SetlistPerformanceMode {
  if (typeof raw !== "string") return SetlistPerformanceMode.FollowSongInfo;
  if (LEGACY_METRONOME_MODES.has(raw)) return SetlistPerformanceMode.MetronomeContinuous;
  return MODE_VALUES.has(raw)
    ? (raw as SetlistPerformanceMode)
    : SetlistPerformanceMode.FollowSongInfo;
}

export function resolvedSongPlayMode(
  song: Song | undefined,
  files?: string[],
  requested?: PlayMode
): PlayMode {
  const requestedMode = requested ?? parseSongInfo(song?.info).playMode ?? PlayMode.View;
  const canBacking = hasBackingAudio(song, files);
  const canClick = Boolean(song && hasClickFlac(song, files));
  if (requestedMode === PlayMode.Playback) {
    return canBacking ? PlayMode.Playback : canClick ? PlayMode.ClickOnly : PlayMode.View;
  }
  if (requestedMode === PlayMode.ClickOnly && !canClick) return PlayMode.View;
  return requestedMode;
}

export function effectivePlayMode(
  song: Song | undefined,
  files: string[] | undefined,
  setlistMode?: SetlistPerformanceMode | string
): PlayMode {
  const songMode = resolvedSongPlayMode(song, files);
  const mode = parseSetlistPerformanceMode(setlistMode);
  if (mode === SetlistPerformanceMode.FollowSongInfo) return songMode;
  if (mode === SetlistPerformanceMode.ClickOnly) {
    return song && hasClickFlac(song, files) ? PlayMode.ClickOnly : songMode;
  }
  return PlayMode.View;
}

export function isMetronomeSetlistMode(mode?: SetlistPerformanceMode | string): boolean {
  return parseSetlistPerformanceMode(mode) === SetlistPerformanceMode.MetronomeContinuous;
}

export function isFreeSetlistMode(mode?: SetlistPerformanceMode | string): boolean {
  return parseSetlistPerformanceMode(mode) === SetlistPerformanceMode.Free;
}

export function setlistModeIsSilent(mode?: SetlistPerformanceMode | string): boolean {
  return isFreeSetlistMode(mode);
}

export const STAGE_NAME_SLOTS = 6;
export const MASTER_BAND_NAME = "Mehmethan";
export const VOCAL_BAND_NAME = "Elif";
export const CORE_BAND_NAMES = [MASTER_BAND_NAME, VOCAL_BAND_NAME] as const;

export function padStageNames(raw?: readonly string[] | null): string[] {
  return Array.from({ length: STAGE_NAME_SLOTS }, (_, index) => {
    const value = raw?.[index];
    return typeof value === "string" ? value : "";
  });
}

export function stageNamesFilled(raw?: readonly string[] | null): boolean {
  return padStageNames(raw).some((name) => name.trim());
}

export function mergeStageNames(
  incoming?: readonly string[] | null,
  previous?: readonly string[] | null
): string[] {
  const next = padStageNames(incoming);
  if (stageNamesFilled(next) || !stageNamesFilled(previous)) return next;
  return padStageNames(previous);
}

export function normalizeBandName(value: string): string {
  return value.trim().toLocaleLowerCase("tr");
}

export function extraStageNames(raw?: readonly string[] | null): string[] {
  const seen = new Set<string>(CORE_BAND_NAMES.map((name) => normalizeBandName(name)));
  const extras: string[] = [];
  for (const name of padStageNames(raw)) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = normalizeBandName(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push(trimmed);
  }
  return extras;
}

export function bandRoster(gig?: { stageNames?: readonly string[] } | null): string[] {
  return [...CORE_BAND_NAMES, ...extraStageNames(gig?.stageNames)];
}

export function isMasterBandName(name: string): boolean {
  return normalizeBandName(name) === normalizeBandName(MASTER_BAND_NAME);
}

export function isVocalBandName(name: string): boolean {
  return normalizeBandName(name) === normalizeBandName(VOCAL_BAND_NAME);
}

export function clientBandRoster(gig?: { stageNames?: readonly string[] } | null): string[] {
  return bandRoster(gig).filter((name) => !isMasterBandName(name));
}

export function connectedBandKeys(
  peers: readonly { deviceKind?: string; deviceName?: string }[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const peer of peers) {
    if (peer.deviceKind !== "client") continue;
    const key = normalizeBandName(peer.deviceName ?? "");
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function isBandNameConnected(
  name: string,
  peers: readonly { deviceKind?: string; deviceName?: string }[]
): boolean {
  return (connectedBandKeys(peers).get(normalizeBandName(name)) ?? 0) > 0;
}

export type LanRosterState = "ready" | "waiting" | "problem";

export function lanRosterState(
  roster: readonly string[],
  peers: readonly { deviceKind?: string; deviceName?: string }[],
  syncConnected: boolean,
  masterOnline = false
): LanRosterState {
  if (!syncConnected) return "problem";
  const counts = connectedBandKeys(peers);
  const masterKey = normalizeBandName(MASTER_BAND_NAME);
  if ((counts.get(masterKey) ?? 0) > 0) return "problem";
  if (masterOnline) counts.set(masterKey, 1);
  const rosterKeys = roster.map((name) => normalizeBandName(name)).filter(Boolean);
  const rosterSet = new Set(rosterKeys);
  for (const [key, count] of counts) {
    if (!rosterSet.has(key) || count > 1) return "problem";
  }
  if (rosterKeys.length > 0 && rosterKeys.every((key) => counts.get(key) === 1)) {
    return "ready";
  }
  return "waiting";
}

export function songForcedClickOnly(song: Song, files?: string[]): Song {
  if (!hasClickFlac(song, files)) return song;
  const info = parseSongInfo(song.info);
  if (info.playMode === PlayMode.ClickOnly) return song;
  return { ...song, info: { ...info, playMode: PlayMode.ClickOnly } };
}

export function songsForcedClickOnly(songs: Song[], fileIndex: Record<string, string[]>): Song[] {
  return songs.map((song) => songForcedClickOnly(song, fileIndex[song.id]));
}

export function songsForSetlistPerformance(
  songs: Song[],
  fileIndex: Record<string, string[]>,
  setlistMode?: SetlistPerformanceMode | string
): Song[] {
  if (parseSetlistPerformanceMode(setlistMode) !== SetlistPerformanceMode.ClickOnly) {
    return songs;
  }
  return songsForcedClickOnly(songs, fileIndex);
}

export const SETLIST_MODE_ICON_COLOR = {
  follow: "#ffffff",
  click: "#e24a4a",
  continuous: "#8b5cf6",
  free: "#22d3ee"
} as const;

export function declaredSongPlayMode(song?: Song): PlayMode {
  return parseSongInfo(song?.info).playMode ?? PlayMode.View;
}

export function setlistPlayModeIcon(
  song: Song | undefined,
  _files: string[] | undefined,
  setlistMode?: SetlistPerformanceMode | string
): { playMode: PlayMode; color: string } {
  const songMode = declaredSongPlayMode(song);
  const mode = parseSetlistPerformanceMode(setlistMode);
  if (mode === SetlistPerformanceMode.FollowSongInfo) {
    return { playMode: songMode, color: SETLIST_MODE_ICON_COLOR.follow };
  }
  if (mode === SetlistPerformanceMode.ClickOnly) {
    return songMode === PlayMode.View
      ? { playMode: songMode, color: SETLIST_MODE_ICON_COLOR.follow }
      : { playMode: PlayMode.ClickOnly, color: SETLIST_MODE_ICON_COLOR.click };
  }
  if (mode === SetlistPerformanceMode.Free) {
    return { playMode: PlayMode.View, color: SETLIST_MODE_ICON_COLOR.free };
  }
  return { playMode: PlayMode.View, color: SETLIST_MODE_ICON_COLOR.continuous };
}
