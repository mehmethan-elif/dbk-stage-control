import type { Logger } from "@dbk/logger";
import type {
  AssetRef,
  BusId,
  DeckId,
  HardwareOutput,
  HardwareOutputId,
  LoadedBuffers,
  Song
} from "./models.js";

export type DeckEvent = "click_eof" | "longest_eof" | "error";

export type DeckEventHandler = (info?: { message?: string }) => void;

export interface AudioDeck {
  readonly id: DeckId;
  load(song: Song, files: LoadedBuffers): Promise<void>;
  play(atContextTime?: number): void;
  pause(): void;
  stop(): void;
  seek(time: number): void;
  setTrackGain(trackId: string, gainDb: number): void;
  setMute(trackId: string, mute: boolean): void;
  setSolo(trackId: string, solo: boolean): void;
  setPan(trackId: string, pan: number): void;
  getPosition(): number;
  readonly clickEndsAt: number | null;
  readonly longestEndsAt: number | null;
  readonly loadedSongId: string | null;
  readonly isLoaded: boolean;
  readonly isPlaying: boolean;
  on(event: DeckEvent, cb: DeckEventHandler): () => void;
  unload(): void;
}

export interface AudioEngine {
  init(): Promise<void>;
  listOutputs(): Promise<HardwareOutput[]>;
  setRouting(map: Record<BusId, HardwareOutputId[]>): void;
  setGlobalGain(bus: BusId, gainDb: number): void;
  fadeOut(durationSeconds: number): void;
  resetFadeOut(): void;
  createDeck(id: DeckId): AudioDeck;
  getContextTime(): number;
  poll(): void;
}

export const CLICK_FLAC = "Click.flac";

export function isClickFlacPath(path: string): boolean {
  const name = path.replace(/\\/g, "/").split("/").pop();
  return name === CLICK_FLAC;
}

/** Seconds into the current song when PLAY_NEXT should start the following song. */
export function playNextCueSeconds(
  song: Pick<Song, "nextSongAt"> | null | undefined,
  clickDuration: number
): number | null {
  const marker = song?.nextSongAt;
  if (typeof marker === "number" && Number.isFinite(marker) && marker >= 0) {
    return marker;
  }
  if (clickDuration > 0) return clickDuration;
  return null;
}

export function clickAsset(song: Song): AssetRef | undefined {
  return song.assets.find((asset) => asset.kind === "audio" && asset.audioRole === "click");
}

export function hasClickFlac(song: Song, files?: string[]): boolean {
  if (files) return files.some((file) => isClickFlacPath(file));
  return song.assets.some((asset) => isClickFlacPath(asset.path));
}

export function backingAssets(song: Song): AssetRef[] {
  return song.assets.filter(
    (asset) => asset.kind === "audio" && asset.audioRole !== "click"
  );
}

const AUDIO_FILE = /\.(wav|flac|mp3|aiff|ogg|m4a)$/i;

export function hasPlaybackAudio(song: Song | undefined, files?: string[]): boolean {
  if (files) return files.some((file) => AUDIO_FILE.test(file));
  return Boolean(song?.assets.some((asset) => asset.kind === "audio"));
}

export function hasBackingAudio(song: Song | undefined, files?: string[]): boolean {
  return hasPlaybackAudio(song, files);
}

export function hasOnlyClickAudio(song: Song | undefined, files?: string[]): boolean {
  if (files) {
    const audio = files.filter((file) => AUDIO_FILE.test(file));
    return audio.length > 0 && audio.every((file) => isClickFlacPath(file));
  }
  const audio = song?.assets.filter((asset) => asset.kind === "audio") ?? [];
  return (
    audio.length > 0 &&
    audio.every((asset) => asset.audioRole === "click" || isClickFlacPath(asset.path))
  );
}

export function requireLogger(logger: Logger): Logger {
  return logger;
}
