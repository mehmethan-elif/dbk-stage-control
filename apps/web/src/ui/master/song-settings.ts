import {
  fileNameOf,
  hasBackingAudio,
  parseSongInfo,
  type MixerBank,
  type Song,
  type SongInfo
} from "@dbk/core";
import { libraryApi } from "../../library/api";

export const SONG_SETTINGS_FILE = "settings.json";
export const SONG_FILE = "song.json";

export function hasSongFile(files?: string[]): boolean {
  return Boolean(files?.some((file) => fileNameOf(file).toLowerCase() === SONG_FILE));
}

export function hasPackedSong(
  song?: Pick<Song, "assets" | "sections" | "tags">,
  files?: string[]
): boolean {
  if (!song || !hasSongFile(files)) return false;
  if ((song.sections?.length ?? 0) > 0 || (song.assets?.length ?? 0) > 0) return true;
  if ((song.tags ?? []).includes("reaper-export")) return true;
  return hasBackingAudio(song as Song, files);
}

export interface SongPageNotes {
  lyrics?: string;
  score?: string;
  chord?: string;
  drums?: string;
}

export interface SongNotaSections {
  version: number;
  rects: Array<{
    id: string;
    name: string;
    measure?: number;
    kind?: "label";
    label?: string;
    page: number;
    x: number;
    y: number;
    w: number;
    h: number;
    sectionIndex?: number;
  }>;
  brokenChains?: Array<{ name: string; measure: number }>;
}

export interface SongSettings {
  view?: SongInfo;
  mixer?: MixerBank;
  notes?: SongPageNotes;
  metroNotes?: { lyrics?: string; drums?: string };
  notaSections?: SongNotaSections;
}

export async function readSongInfo(songId: string): Promise<SongInfo> {
  const raw = await libraryApi.readJson(songId, SONG_FILE);
  const song = settingsObject(raw);
  return parseSongInfo(song.info);
}

export function songFileWithInfo(
  song: Record<string, unknown>,
  info: SongInfo
): Record<string, unknown> {
  const existing = parseSongInfo({
    ...(song.info && typeof song.info === "object" ? song.info : {}),
    kita: song.kita
  });
  const parsed = parseSongInfo({ ...existing, ...info, kita: info.kita ?? existing.kita });
  return {
    ...song,
    ...(parsed.kita != null ? { kita: parsed.kita } : {}),
    info: parsed
  };
}

export function writeSongInfo(songId: string, info: SongInfo): Promise<void> {
  const key = `${songId}:${SONG_FILE}`;
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const raw = await libraryApi.readJson(songId, SONG_FILE);
      const song = settingsObject(raw) as Record<string, unknown>;
      await libraryApi.writeJson(songId, SONG_FILE, songFileWithInfo(song, info));
    });
  writeQueues.set(key, next);
  void next.then(
    () => {
      if (writeQueues.get(key) === next) writeQueues.delete(key);
    },
    () => {
      if (writeQueues.get(key) === next) writeQueues.delete(key);
    }
  );
  return next;
}

const writeQueues = new Map<string, Promise<void>>();

function settingsObject(raw: unknown): SongSettings {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as SongSettings) : {};
}

export async function readSongSettings(songId: string): Promise<SongSettings> {
  return settingsObject(await libraryApi.readJson(songId, SONG_SETTINGS_FILE));
}

export function updateSongSettings(
  songId: string,
  update: (current: SongSettings) => SongSettings
): Promise<void> {
  const previous = writeQueues.get(songId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await readSongSettings(songId);
      await libraryApi.writeJson(songId, SONG_SETTINGS_FILE, update(current));
    });
  writeQueues.set(songId, next);
  void next.then(
    () => {
      if (writeQueues.get(songId) === next) writeQueues.delete(songId);
    },
    () => {
      if (writeQueues.get(songId) === next) writeQueues.delete(songId);
    }
  );
  return next;
}
