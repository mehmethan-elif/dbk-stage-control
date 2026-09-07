import type { Logger } from "@dbk/logger";
import type { AudioDeck, AudioEngine, DeckEvent, DeckEventHandler } from "./audio-engine.js";
import { playNextCueSeconds } from "./audio-engine.js";
import type {
  BusId,
  DeckId,
  HardwareOutput,
  HardwareOutputId,
  LoadedBuffers,
  Song
} from "./models.js";
import { DeckId as DeckIds } from "./models.js";

interface FakeDeckState {
  song: Song | null;
  tracks: LoadedBuffers["tracks"];
  clickDuration: number;
  longestDuration: number;
  startedAt: number | null;
  pausedAt: number | null;
  playing: boolean;
  clickFired: boolean;
  longestFired: boolean;
}

function emptyState(): FakeDeckState {
  return {
    song: null,
    tracks: [],
    clickDuration: 0,
    longestDuration: 0,
    startedAt: null,
    pausedAt: null,
    playing: false,
    clickFired: false,
    longestFired: false
  };
}

export class FakeAudioDeck implements AudioDeck {
  readonly id: DeckId;
  private readonly engine: FakeAudioEngine;
  private readonly listeners = {
    click_eof: new Set<DeckEventHandler>(),
    longest_eof: new Set<DeckEventHandler>(),
    error: new Set<DeckEventHandler>()
  };
  state: FakeDeckState = emptyState();

  constructor(id: DeckId, engine: FakeAudioEngine) {
    this.id = id;
    this.engine = engine;
  }

  get loadedSongId(): string | null {
    return this.state.song?.id ?? null;
  }

  get isLoaded(): boolean {
    return this.state.song !== null;
  }

  get isPlaying(): boolean {
    if (!this.state.playing || this.state.startedAt === null) return false;
    return this.engine.getContextTime() >= this.state.startedAt;
  }

  get clickEndsAt(): number | null {
    if (this.state.startedAt === null) return null;
    const cue = playNextCueSeconds(this.state.song, this.state.clickDuration);
    if (cue === null) return null;
    return this.state.startedAt + cue;
  }

  get longestEndsAt(): number | null {
    if (this.state.startedAt === null || this.state.longestDuration <= 0) return null;
    return this.state.startedAt + this.state.longestDuration;
  }

  async load(song: Song, files: LoadedBuffers): Promise<void> {
    const click = files.tracks.find((track) => track.asset.audioRole === "click");
    const longest = files.tracks.reduce((max, track) => Math.max(max, track.duration), 0);
    this.state = {
      song,
      tracks: files.tracks,
      clickDuration: click?.duration ?? song.clickDuration ?? 0,
      longestDuration: longest || song.duration,
      startedAt: null,
      pausedAt: null,
      playing: false,
      clickFired: false,
      longestFired: false
    };
  }

  play(atContextTime?: number): void {
    const when = atContextTime ?? this.engine.getContextTime();
    const offset = this.state.pausedAt ?? 0;
    this.state.startedAt = when - offset;
    this.state.pausedAt = null;
    this.state.playing = true;
    this.state.clickFired = false;
    this.state.longestFired = false;
  }

  pause(): void {
    if (!this.state.playing) return;
    this.state.pausedAt = this.getPosition();
    this.state.playing = false;
  }

  stop(): void {
    this.state.playing = false;
    this.state.startedAt = null;
    this.state.pausedAt = null;
    this.state.clickFired = false;
    this.state.longestFired = false;
  }

  seek(time: number): void {
    const t = Math.max(0, time);
    if (this.state.playing) {
      this.state.startedAt = this.engine.getContextTime() - t;
      this.state.clickFired = false;
      this.state.longestFired = false;
    } else {
      this.state.pausedAt = t;
    }
  }

  setTrackGain(_trackId: string, _gainDb: number): void {}
  setMute(_trackId: string, _mute: boolean): void {}
  setSolo(_trackId: string, _solo: boolean): void {}
  setPan(_trackId: string, _pan: number): void {}

  getPosition(): number {
    if (this.state.pausedAt !== null && !this.state.playing) return this.state.pausedAt;
    if (this.state.startedAt === null) return 0;
    return Math.max(0, this.engine.getContextTime() - this.state.startedAt);
  }

  on(event: DeckEvent, cb: DeckEventHandler): () => void {
    const set = this.listeners[event];
    if (!set) return () => undefined;
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  unload(): void {
    this.state = emptyState();
  }

  poll(now: number): void {
    if (!this.state.playing || this.state.startedAt === null) return;
    if (now < this.state.startedAt) return;

    const clickAt = this.clickEndsAt;
    if (clickAt !== null && !this.state.clickFired && now + 1e-9 >= clickAt) {
      this.state.clickFired = true;
      for (const cb of this.listeners.click_eof) cb();
    }

    const longestAt = this.longestEndsAt;
    if (longestAt !== null && !this.state.longestFired && now + 1e-9 >= longestAt) {
      this.state.longestFired = true;
      this.state.playing = false;
      for (const cb of this.listeners.longest_eof) cb();
    }
  }
}

export class FakeAudioEngine implements AudioEngine {
  private time = 0;
  private readonly decks = new Map<DeckId, FakeAudioDeck>();
  readonly logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  async init(): Promise<void> {}

  async listOutputs(): Promise<HardwareOutput[]> {
    return [{ id: "default", label: "Fake Stereo", channels: 2 }];
  }

  setRouting(_map: Record<BusId, HardwareOutputId[]>): void {}
  setGlobalGain(_bus: BusId, _gainDb: number): void {}
  fadeOut(_durationSeconds: number): void {}
  resetFadeOut(): void {}

  createDeck(id: DeckId): AudioDeck {
    const existing = this.decks.get(id);
    if (existing) return existing;
    const deck = new FakeAudioDeck(id, this);
    this.decks.set(id, deck);
    return deck;
  }

  getDeck(id: DeckId): FakeAudioDeck | undefined {
    return this.decks.get(id);
  }

  getContextTime(): number {
    return this.time;
  }

  poll(): void {
    for (const deck of this.decks.values()) deck.poll(this.time);
  }

  advance(seconds: number): void {
    const step = 0.01;
    const target = this.time + seconds;
    while (this.time + step <= target + 1e-12) {
      this.time += step;
      this.poll();
    }
    if (this.time < target) {
      this.time = target;
      this.poll();
    }
  }

  setTime(time: number): void {
    this.time = time;
    this.poll();
  }
}

export const PRIMARY_DECK: DeckId = DeckIds.A;
export const SECONDARY_DECK: DeckId = DeckIds.B;
