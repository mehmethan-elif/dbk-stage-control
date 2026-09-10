import type { Logger } from "@dbk/logger";
import type {
  AssetRef,
  BusId,
  DeckId,
  HardwareOutput,
  HardwareOutputId,
  LoadedBuffers,
  PlayMode,
  Song
} from "./models.js";
import { PlayMode as PlayModes } from "./models.js";
import { isMasterPracticeAudio } from "./practice-files.js";

export type DeckEvent = "click_eof" | "longest_eof" | "error";

export type DeckEventHandler = (info?: { message?: string }) => void;

export interface AudioDeck {
  readonly id: DeckId;
  load(song: Song, files: LoadedBuffers): Promise<void>;
  updateSong(song: Song): void;
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

export function isClickPlaybackTrack(asset: Pick<AssetRef, "audioRole" | "path">): boolean {
  return asset.audioRole === "click" || isClickFlacPath(asset.path);
}

/** Click-only mode keeps stems loaded and silences everything except the click. */
export function clickOnlyMixSilences(
  asset: Pick<AssetRef, "audioRole" | "path">,
  playMode?: PlayMode
): boolean {
  return playMode === PlayModes.ClickOnly && !isClickPlaybackTrack(asset);
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
  return Boolean(song.assets?.some((asset) => isClickFlacPath(asset.path)));
}

export function backingAssets(song: Song): AssetRef[] {
  return (song.assets ?? []).filter(
    (asset) =>
      asset.kind === "audio" &&
      asset.audioRole !== "click" &&
      !isMasterPracticeAudio(asset.path)
  );
}

const AUDIO_FILE = /\.(wav|flac|mp3|aiff|ogg|m4a)$/i;

export function hasPlaybackAudio(song: Song | undefined, files?: string[]): boolean {
  if (files) {
    return files.some((file) => AUDIO_FILE.test(file) && !isMasterPracticeAudio(file));
  }
  return Boolean(
    song?.assets.some(
      (asset) => asset.kind === "audio" && !isMasterPracticeAudio(asset.path)
    )
  );
}

export function hasBackingAudio(song: Song | undefined, files?: string[]): boolean {
  if (files) {
    return files.some(
      (file) =>
        AUDIO_FILE.test(file) &&
        !isClickFlacPath(file) &&
        !isMasterPracticeAudio(file)
    );
  }
  return Boolean(song && backingAssets(song).length > 0);
}

export function hasOnlyClickAudio(song: Song | undefined, files?: string[]): boolean {
  if (files) {
    const audio = files.filter(
      (file) => AUDIO_FILE.test(file) && !isMasterPracticeAudio(file)
    );
    return audio.length > 0 && audio.every((file) => isClickFlacPath(file));
  }
  const audio =
    song?.assets.filter(
      (asset) => asset.kind === "audio" && !isMasterPracticeAudio(asset.path)
    ) ?? [];
  return (
    audio.length > 0 &&
    audio.every((asset) => asset.audioRole === "click" || isClickFlacPath(asset.path))
  );
}

export function clickOnlySong(song: Song): Song {
  return {
    ...song,
    assets: (song.assets ?? []).filter(
      (asset) =>
        asset.kind !== "audio" ||
        asset.audioRole === "click" ||
        isClickFlacPath(asset.path)
    )
  };
}

export function performanceAudioSong(song: Song): Song {
  return {
    ...song,
    assets: (song.assets ?? []).filter(
      (asset) => asset.kind !== "audio" || !isMasterPracticeAudio(asset.path)
    )
  };
}

export function requireLogger(logger: Logger): Logger {
  return logger;
}
