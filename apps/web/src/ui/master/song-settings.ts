import type { MixerBank, SongInfo } from "@dbk/core";
import { readSongJsonFile, writeSongJsonFile } from "../../native/library";

export const SONG_SETTINGS_FILE = "settings.json";

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
    page: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
}

export interface SongSettings {
  view?: SongInfo;
  mixer?: MixerBank;
  notes?: SongPageNotes;
  notaSections?: SongNotaSections;
}

const writeQueues = new Map<string, Promise<void>>();

function settingsObject(raw: unknown): SongSettings {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as SongSettings) : {};
}

export async function readSongSettings(songId: string): Promise<SongSettings> {
  return settingsObject(await readSongJsonFile(songId, SONG_SETTINGS_FILE));
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
      await writeSongJsonFile(songId, SONG_SETTINGS_FILE, update(current));
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
