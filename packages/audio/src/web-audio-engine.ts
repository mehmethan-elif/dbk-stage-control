import type { Logger } from "@dbk/logger";
import type {
  AudioDeck,
  AudioEngine,
  BusId,
  DeckEvent,
  DeckEventHandler,
  DeckId,
  HardwareOutput,
  HardwareOutputId,
  LoadedBuffers,
  LoadedTrack,
  Song
} from "@dbk/core";
import {
  MIXER_CHANNELS,
  MIXER_STEMS,
  clickOnlyMixSilences,
  emptyMixerBank,
  emptyMixerLevels,
  emptyStrip,
  isMasterPracticeAudio,
  mixerStemFromPath,
  parseSongInfo,
  playNextCueSeconds,
  type MixerBank,
  type MixerChannel,
  type MixerLevels,
  type MixerStem
} from "@dbk/core";
import { PEAK_METER_PROCESSOR, PEAK_METER_PROCESSOR_NAME } from "./peak-meter-worklet.js";
import { frameAtTime, frameStartTime, parseFlac, sliceFlac, type FlacFile } from "./flac-slice.js";

/**
 * Song seconds decoded at a time. Decoded audio costs sampleRate * channels * 4 bytes a
 * second, so a whole eleven stem song is hundreds of megabytes; a window of it is tens.
 */
const WINDOW_SECONDS = 15;
/** How far ahead of the playhead the next window is decoded and scheduled. */
const WINDOW_LEAD_SECONDS = 7;

interface WebTrack {
  id: string;
  asset: LoadedTrack["asset"];
  duration: number;
  /** Audio decoded in one piece. Null when the track plays a window at a time. */
  buffer: AudioBuffer | null;
  /** Compressed source for windowed playback, indexed so any window can be cut out. */
  flac: FlacFile | null;
  /** Decoded windows waiting to be scheduled, by window index. */
  ready: Map<number, AudioBuffer>;
  gain: GainNode;
  panner: StereoPannerNode;
  muted: boolean;
  solo: boolean;
  gainDb: number;
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

function isFlacFile(value: unknown): value is FlacFile {
  return typeof value === "object" && value !== null && "frameOffsets" in value;
}

/** Sample rate of the library's stems. */
const LIBRARY_SAMPLE_RATE = 44100;

/**
 * The ceiling on how far the visuals may be pulled back from the audio clock. Wide enough
 * for a Bluetooth route, narrow enough that a nonsense reading cannot park the playhead in
 * the middle of last bar.
 */
const MAX_OUTPUT_LATENCY = 0.5;

/**
 * The stems are 44.1 kHz. The context stays there too, so each window is copied through
 * and the joins stay clean. The sound card keeps whatever rate it opened at.
 */
function createContext(options: AudioContextOptions = {}): AudioContext {
  try {
    return new AudioContext({ ...options, sampleRate: LIBRARY_SAMPLE_RATE });
  } catch {
    return new AudioContext(options);
  }
}

export type AudioRoutingMode = 1 | 2 | 3;

export interface OutputRoutingPlan {
  channels: 2 | 3;
  mainChannels: number[];
  cueChannels: number[];
  mainMono: boolean;
}

export function destinationChannelCount(dest: {
  maxChannelCount: number;
  channelCount: number;
  channelCountMode?: string;
  channelInterpretation?: string;
}): number {
  const max = Math.max(1, dest.maxChannelCount || dest.channelCount || 2);
  try {
    dest.channelCountMode = "explicit";
    dest.channelInterpretation = "discrete";
    if (dest.channelCount !== max) dest.channelCount = max;
  } catch {
    // Chromium keeps stereo if macOS has not exposed a multi-channel layout.
  }
  return Math.max(1, dest.channelCount || 2);
}

export function looksLikeMultiOutInterface(label: string): boolean {
  const name = label.trim();
  return (
    /^m4$/i.test(name) ||
    /\b(m\s*4|motu|scarlett|clarett|babyface|fireface|quad-capture|4i4|6i6|18i8|2i4)\b/i.test(name)
  );
}

export function outputRoutingPlan(
  mode: AudioRoutingMode,
  maxChannelCount: number
): OutputRoutingPlan | null {
  if (mode === 2) {
    return maxChannelCount >= 3
      ? { channels: 3, mainChannels: [0, 1], cueChannels: [2], mainMono: false }
      : null;
  }
  if (maxChannelCount < 2) return null;
  if (mode === 3) {
    return { channels: 2, mainChannels: [0], cueChannels: [1], mainMono: true };
  }
  return { channels: 2, mainChannels: [0, 1], cueChannels: [0, 1], mainMono: false };
}

export class WebAudioDeck implements AudioDeck {
  readonly id: DeckId;
  private readonly engine: WebAudioEngine;
  private readonly listeners = {
    click_eof: new Set<DeckEventHandler>(),
    longest_eof: new Set<DeckEventHandler>(),
    error: new Set<DeckEventHandler>()
  };
  private song: Song | null = null;
  private tracks: WebTrack[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private startedAt: number | null = null;
  private pausedAt: number | null = null;
  private playing = false;
  private clickDuration = 0;
  private longestDuration = 0;
  private clickFired = false;
  private longestFired = false;
  /** Song time this run started from, so a mid-window start keeps its offset. */
  private playFrom = 0;
  private nextWindow = 0;
  /** Bumped whenever playback is torn down, to drop decodes that are no longer wanted. */
  private epoch = 0;
  /** While the app is in the background, queue the rest of the song. Timers stop there. */
  private throughEnd = false;
  private readonly pending = new Map<number, Promise<void>>();

  applyMixer(): void {
    this.applyMix();
  }

  constructor(id: DeckId, engine: WebAudioEngine) {
    this.id = id;
    this.engine = engine;
  }

  hasLiveSources(): boolean {
    // A deck that is playing but still decoding the window it needs is live too. Seeking
    // lands here, and without this the output gate closes for the rest of the song.
    return this.sources.length > 0 || (this.playing && this.pending.size > 0);
  }

  get loadedSongId(): string | null {
    return this.song?.id ?? null;
  }

  get isLoaded(): boolean {
    return this.song !== null;
  }

  get isPlaying(): boolean {
    if (!this.playing || this.startedAt === null) return false;
    return this.engine.getContextTime() >= this.startedAt;
  }

  get isArmed(): boolean {
    return this.playing && this.startedAt !== null;
  }

  get clickEndsAt(): number | null {
    if (this.startedAt === null) return null;
    const cue = playNextCueSeconds(this.song, this.clickDuration);
    if (cue === null) return null;
    return this.startedAt + cue;
  }

  get longestEndsAt(): number | null {
    if (this.startedAt === null || this.longestDuration <= 0) return null;
    return this.startedAt + this.longestDuration;
  }

  async load(song: Song, files: LoadedBuffers): Promise<void> {
    this.stopSources();
    this.releaseTracks();
    this.song = song;
    const ctx = this.engine.context;
    this.tracks = files.tracks.map((track) => {
      const payload = track.payload;
      const flac = isFlacFile(payload) ? payload : null;
      const buffer = flac ? null : (payload as AudioBuffer | undefined) ?? null;
      if (!flac && !buffer) {
        throw new Error("Song cannot play: Audio is not decoded.");
      }
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner();
      gain.connect(panner);
      panner.connect(
        this.engine.mixerInput(track.asset.bus ?? "MAIN", mixerStemFromPath(track.asset.path))
      );
      return {
        id: track.id,
        asset: track.asset,
        duration: flac ? flac.info.duration : (buffer?.duration ?? 0),
        buffer,
        flac,
        ready: new Map<number, AudioBuffer>(),
        gain,
        panner,
        muted: false,
        solo: false,
        gainDb: 0
      };
    });
    this.applyMix();
    const click = this.tracks.find((track) => track.asset.audioRole === "click");
    this.clickDuration = click?.duration ?? song.clickDuration ?? 0;
    this.longestDuration = this.tracks.reduce((max, track) => Math.max(max, track.duration), 0);
    // `play` cannot wait for a decode, so the opening window is decoded here. That is what
    // makes both the play button and a gapless hand-off start on the sample they ask for.
    await this.decodeWindow(0);
    this.startedAt = null;
    this.pausedAt = null;
    this.playing = false;
    this.clickFired = false;
    this.longestFired = false;
    this.engine.logger?.audio("deck_loaded", {
      deck: this.id,
      songId: song.id,
      clickDuration: this.clickDuration,
      longestDuration: this.longestDuration
    });
  }

  updateSong(song: Song): void {
    if (!this.song || this.song.id !== song.id) return;
    this.song = song;
    this.applyMix();
  }

  play(atContextTime?: number): void {
    const ctx = this.engine.context;
    const when = atContextTime ?? ctx.currentTime;
    const offset = this.pausedAt ?? 0;
    this.stopSources();
    this.startedAt = when - offset;
    this.pausedAt = null;
    this.playing = true;
    this.clickFired = false;
    this.longestFired = false;
    this.playFrom = offset;
    this.nextWindow = Math.floor(offset / WINDOW_SECONDS);
    this.throughEnd = typeof document !== "undefined" && document.visibilityState === "hidden";
    for (const track of this.tracks) {
      if (!track.buffer) continue;
      const source = ctx.createBufferSource();
      source.buffer = track.buffer;
      source.connect(track.gain);
      source.start(when, offset);
      this.sources.push(source);
    }
    this.ensureWindows();
    this.engine.syncTransportGate();
  }

  pause(): void {
    if (this.playing) this.pausedAt = this.getPosition();
    this.playing = false;
    this.stopSources();
    this.prefetchAt(this.pausedAt ?? 0);
    this.engine.syncTransportGate();
  }

  stop(): void {
    this.playing = false;
    this.startedAt = null;
    this.pausedAt = null;
    this.clickFired = false;
    this.longestFired = false;
    this.stopSources();
    this.engine.syncTransportGate();
  }

  seek(time: number): void {
    const t = Math.max(0, time);
    if (this.playing) {
      this.pausedAt = t;
      this.play();
    } else {
      this.pausedAt = t;
      this.prefetchAt(t);
    }
  }

  setTrackGain(trackId: string, gainDb: number): void {
    const track = this.tracks.find((item) => item.id === trackId);
    if (!track) return;
    track.gainDb = gainDb;
    this.applyMix();
  }

  setMute(trackId: string, mute: boolean): void {
    const track = this.tracks.find((item) => item.id === trackId);
    if (!track) return;
    track.muted = mute;
    this.applyMix();
  }

  setSolo(trackId: string, solo: boolean): void {
    const track = this.tracks.find((item) => item.id === trackId);
    if (!track) return;
    track.solo = solo;
    this.applyMix();
  }

  setPan(trackId: string, pan: number): void {
    const track = this.tracks.find((item) => item.id === trackId);
    if (!track) return;
    track.panner.pan.value = Math.max(-1, Math.min(1, pan));
  }

  getPosition(): number {
    if (this.pausedAt !== null && !this.playing) return this.pausedAt;
    if (this.startedAt === null) return 0;
    return Math.max(0, this.engine.getContextTime() - this.startedAt);
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
    this.stop();
    this.releaseTracks();
    this.song = null;
  }

  /**
   * Loading a song replaces the track list, so the previous gain/panner pairs have to be
   * disconnected here. Left attached they stay wired into the mixer graph for the rest of
   * the show — two orphan nodes per stem, every song change.
   */
  private releaseTracks(): void {
    for (const track of this.tracks) {
      track.gain.disconnect();
      track.panner.disconnect();
      track.ready.clear();
    }
    this.pending.clear();
    this.tracks = [];
  }

  /** Longest windowed track, in windows. */
  private windowCount(): number {
    let longest = 0;
    for (const track of this.tracks) {
      if (track.flac) longest = Math.max(longest, track.duration);
    }
    return Math.ceil(longest / WINDOW_SECONDS);
  }

  /** Queue every remaining window. The background has no timers to keep doing this. */
  armThroughEnd(): void {
    this.throughEnd = true;
    this.ensureWindows();
  }

  /**
   * Arms windows so the next one is always scheduled before the playhead reaches it.
   * Driven from `poll`, which the engine calls while the transport runs.
   */
  private ensureWindows(): void {
    if (!this.playing || this.startedAt === null) return;
    const windows = this.windowCount();
    const position = this.getPosition();
    const lead = this.throughEnd ? Number.POSITIVE_INFINITY : WINDOW_LEAD_SECONDS;
    while (
      this.nextWindow < windows &&
      this.nextWindow * WINDOW_SECONDS - position <= lead
    ) {
      const index = this.nextWindow;
      this.nextWindow += 1;
      this.scheduleWindow(index);
    }
  }

  private scheduleWindow(index: number): void {
    const songStart = Math.max(index * WINDOW_SECONDS, this.playFrom);
    const tracks = this.tracks.filter((track) => track.flac && track.duration > songStart);
    if (tracks.length === 0) return;
    if (tracks.every((track) => track.ready.has(index))) {
      for (const track of tracks) this.startWindow(track, index, songStart);
      return;
    }
    const epoch = this.epoch;
    void this.decodeWindow(index)
      .then(() => {
        if (epoch !== this.epoch || !this.playing) return;
        for (const track of tracks) this.startWindow(track, index, songStart);
      })
      .catch(() => {
        for (const cb of this.listeners.error) cb({ message: "Song cannot play: Audio failed." });
      });
  }

  /**
   * Decodes window `index` for every track that plays in it. Windows are cut on frame
   * boundaries, so a decoded window starts at or just before the song time it covers.
   */
  private decodeWindow(index: number): Promise<void> {
    const running = this.pending.get(index);
    if (running) return running;
    const ctx = this.engine.context;
    const from = index * WINDOW_SECONDS;
    const run = Promise.all(
      this.tracks.map(async (track) => {
        const file = track.flac;
        if (!file || track.ready.has(index) || track.duration <= from) return;
        const to = Math.min(from + WINDOW_SECONDS, track.duration);
        const slice = sliceFlac(
          file,
          frameAtTime(file, from),
          Math.min(frameAtTime(file, to) + 1, file.frameCount)
        );
        const decoded = await ctx.decodeAudioData(slice.buffer as ArrayBuffer);
        track.ready.set(index, decoded);
      })
    )
      .then(() => undefined)
      .finally(() => {
        this.pending.delete(index);
      });
    this.pending.set(index, run);
    return run;
  }

  /** Decodes the window holding `time`, so playing from there does not have to wait. */
  private prefetchAt(time: number): void {
    const index = Math.floor(Math.max(0, time) / WINDOW_SECONDS);
    if (!this.tracks.some((track) => track.flac)) return;
    void this.decodeWindow(index).catch(() => undefined);
  }

  /**
   * Starts one window at the context time its song position maps to. Every window and
   * every stem is placed against `startedAt` rather than against the window before it, so
   * they stay locked to the same clock however long a decode took.
   */
  private startWindow(track: WebTrack, index: number, songStart: number): void {
    const file = track.flac;
    const buffer = track.ready.get(index);
    if (!file || !buffer || this.startedAt === null) return;
    // The opening window is kept so replaying or handing over to this deck is instant.
    if (index !== 0) track.ready.delete(index);

    const ctx = this.engine.context;
    const at = this.startedAt + songStart;
    const end = Math.min((index + 1) * WINDOW_SECONDS, track.duration);
    // A window that had to be decoded first can arrive after its slot. Skip the part that
    // is already late rather than playing it behind everything else.
    const late = Math.max(0, ctx.currentTime - at);
    const start = songStart + late;
    if (start >= end) return;

    const bufferStart = frameStartTime(file, frameAtTime(file, index * WINDOW_SECONDS));
    const when = Math.max(ctx.currentTime, at);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(track.gain);
    source.start(when, start - bufferStart, end - start);
    source.onended = () => {
      source.disconnect();
      const found = this.sources.indexOf(source);
      if (found >= 0) this.sources.splice(found, 1);
    };
    this.sources.push(source);
    // Windows that had to be decoded start after the transport was last checked, so the
    // gate has to be told about them or they play into a closed output.
    this.engine.syncTransportGate();
  }

  poll(now: number): void {
    if (!this.playing || this.startedAt === null) return;
    this.ensureWindows();
    if (now < this.startedAt) return;

    const clickAt = this.clickEndsAt;
    if (clickAt !== null && !this.clickFired && now + 1e-9 >= clickAt) {
      this.clickFired = true;
      for (const cb of this.listeners.click_eof) cb();
    }

    const longestAt = this.longestEndsAt;
    if (longestAt !== null && !this.longestFired && now + 1e-9 >= longestAt) {
      this.longestFired = true;
      this.playing = false;
      this.stopSources();
      this.engine.syncTransportGate();
      for (const cb of this.listeners.longest_eof) cb();
    }
    this.recoverIfSilent(now);
  }

  /**
   * A route change or an alert can end the scheduled buffers while the deck still says
   * it is playing. After a short silence, start the song again from the position the
   * clock already has, so the show does not stay mute.
   */
  private silentSince: number | null = null;

  private recoverIfSilent(now: number): void {
    if (!this.playing || this.startedAt === null || now < this.startedAt) {
      this.silentSince = null;
      return;
    }
    if (this.engine.context.state !== "running") return;
    if (this.sources.length > 0 || this.pending.size > 0 || this.tracks.length === 0) {
      this.silentSince = null;
      return;
    }
    const position = this.getPosition();
    if (this.longestDuration > 0 && position >= this.longestDuration - 0.05) {
      this.silentSince = null;
      return;
    }
    if (this.silentSince === null) {
      this.silentSince = now;
      return;
    }
    if (now - this.silentSince < 0.3) return;
    this.silentSince = null;
    this.engine.logger?.audio("deck_restarted", {
      deck: this.id,
      songId: this.song?.id,
      position
    });
    this.pausedAt = position;
    this.play();
  }

  private applyMix(): void {
    const songId = this.song?.id;
    const songBank = songId ? this.engine.songMix(songId) : emptyMixerBank();
    const playMode = parseSongInfo(this.song?.info).playMode;
    for (const track of this.tracks) {
      const stem = mixerStemFromPath(track.asset.path);
      const songStem = stem ? songBank[stem] : emptyStrip();
      const silenced =
        songBank.Main.muted ||
        (stem ? songStem.muted : false) ||
        clickOnlyMixSilences(track.asset, playMode);
      const db = songBank.Main.gainDb + (stem ? songStem.gainDb : 0);
      track.gain.gain.value = silenced ? 0 : dbToGain(db);
    }
  }

  private stopSources(): void {
    // Any window still decoding belongs to the run being torn down here.
    this.epoch += 1;
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped
      }
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.sources = [];
  }
}

export class WebAudioEngine implements AudioEngine {
  readonly logger?: Logger;
  private ctx: AudioContext | null = null;
  private mainGain: GainNode | null = null;
  private cueGain: GainNode | null = null;
  private mixerMainGain: GainNode | null = null;
  private outputGate: GainNode | null = null;
  private readonly stemGains = new Map<MixerStem, GainNode>();
  private meterPeaks: MixerLevels = emptyMixerLevels();
  private readonly decks = new Map<DeckId, WebAudioDeck>();
  private readonly songBanks = new Map<string, MixerBank>();
  private busBank: MixerBank = emptyMixerBank();
  private outputChannels = 2;
  private outputDeviceId = "default";
  private routingMode: AudioRoutingMode = 1;
  private outputMerger: ChannelMergerNode | null = null;
  private mainSplitter: ChannelSplitterNode | null = null;
  private mainMono: GainNode | null = null;
  private cueMono: GainNode | null = null;
  private externalCueActive = false;
  private routing: Record<BusId, HardwareOutputId[]> = {
    MAIN: ["default"],
    CUE: ["default"]
  };

  constructor(logger?: Logger) {
    this.logger = logger;
    if (typeof document === "undefined") return;
    const arm = () => {
      for (const deck of this.decks.values()) deck.armThroughEnd();
    };
    (globalThis as { __dbkContinueAudio?: () => void }).__dbkContinueAudio = arm;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") arm();
    });
    document.addEventListener("pagehide", arm);
  }

  get context(): AudioContext {
    if (!this.ctx) {
      throw new Error("Audio engine is not initialized.");
    }
    return this.ctx;
  }

  busNode(bus: BusId): GainNode {
    const node = bus === "CUE" ? this.cueGain : this.mainGain;
    if (!node) throw new Error("Audio engine is not initialized.");
    return node;
  }

  mixerInput(_bus: BusId, stem?: MixerStem): AudioNode {
    if (!this.mixerMainGain) throw new Error("Audio engine is not initialized.");
    if (stem) {
      const node = this.stemGains.get(stem);
      if (node) return node;
    }
    return this.mixerMainGain;
  }

  getBusLevels(): MixerLevels {
    return { ...this.meterPeaks };
  }

  songMix(songId: string): MixerBank {
    return this.songBanks.get(songId) ?? emptyMixerBank();
  }

  busMix(): MixerBank {
    return this.busBank;
  }

  setSongStrip(songId: string, channel: MixerChannel, patch: Partial<MixerBank[MixerChannel]>): MixerBank {
    const current = this.songMix(songId);
    const next: MixerBank = { ...current, [channel]: { ...current[channel], ...patch } };
    this.songBanks.set(songId, next);
    this.refreshMix();
    return next;
  }

  setBusStrip(channel: MixerChannel, patch: Partial<MixerBank[MixerChannel]>): MixerBank {
    this.busBank = { ...this.busBank, [channel]: { ...this.busBank[channel], ...patch } };
    this.refreshMix();
    return this.busBank;
  }

  replaceSongMix(songId: string, bank: MixerBank): void {
    this.songBanks.set(songId, bank);
    this.refreshMix();
  }

  replaceBusMix(bank: MixerBank): void {
    this.busBank = bank;
    this.refreshMix();
  }

  private refreshMix(): void {
    this.applyBusGains();
    for (const deck of this.decks.values()) deck.applyMixer();
  }

  private applyBusGains(): void {
    if (!this.mixerMainGain) return;
    const anyBusSolo = MIXER_STEMS.some((channel) => this.busBank[channel].solo);
    const main = this.busBank.Main;
    for (const stem of MIXER_STEMS) {
      const node = this.stemGains.get(stem);
      if (!node) continue;
      const strip = this.busBank[stem];
      const silenced = strip.muted || main.muted || (anyBusSolo && !strip.solo);
      node.gain.value = silenced ? 0 : dbToGain(strip.gainDb + main.gainDb);
    }
    this.mixerMainGain.gain.value = main.muted || anyBusSolo ? 0 : dbToGain(main.gainDb);
  }

  private async attachPeakMeter(ctx: AudioContext, merger: ChannelMergerNode): Promise<void> {
    const blob = new Blob([PEAK_METER_PROCESSOR], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const node = new AudioWorkletNode(ctx, PEAK_METER_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: MIXER_CHANNELS.length,
      channelCountMode: "explicit",
      channelInterpretation: "discrete"
    });
    node.port.onmessage = (event: MessageEvent<number[] | Float32Array>) => {
      const peaks = event.data;
      MIXER_CHANNELS.forEach((channel, index) => {
        this.meterPeaks[channel] = peaks[index] ?? 0;
      });
    };
    const silent = ctx.createGain();
    silent.gain.value = 0;
    merger.connect(node);
    node.connect(silent);
    silent.connect(this.outputGate ?? ctx.destination);
  }

  syncTransportGate(): void {
    if (!this.outputGate) return;
    const live = [...this.decks.values()].some((deck) => deck.hasLiveSources());
    this.outputGate.gain.value = live || this.externalCueActive ? 1 : 0;
  }

  prime(): AudioContext {
    if (!this.ctx) {
      this.ctx = createContext();
      this.unlockNow(this.ctx);
      this.watchContextState(this.ctx);
      this.buildGraph(this.ctx);
      this.logger?.audio("engine_created", { sampleRate: this.ctx.sampleRate, state: this.ctx.state });
    } else {
      this.unlockNow(this.ctx);
    }
    return this.ctx;
  }

  async init(): Promise<void> {
    this.prime();
    await this.resumeContext();
  }

  private buildGraph(ctx: AudioContext): void {
    this.mainGain = ctx.createGain();
    this.cueGain = ctx.createGain();
    this.outputGate = ctx.createGain();
    this.outputGate.gain.value = 0;
    this.mixerMainGain = ctx.createGain();
    const meterSum = ctx.createGain();
    const merger = ctx.createChannelMerger(MIXER_CHANNELS.length);
    this.mixerMainGain.connect(this.mainGain);
    this.mixerMainGain.connect(meterSum);
    MIXER_STEMS.forEach((stem, index) => {
      const gain = ctx.createGain();
      gain.connect(meterSum);
      gain.connect(stem === "Click" ? this.cueGain! : this.mainGain!);
      gain.connect(merger, 0, index);
      this.stemGains.set(stem, gain);
    });
    meterSum.connect(merger, 0, MIXER_STEMS.length);
    this.applyBusGains();
    this.outputGate.connect(ctx.destination);
    this.applyRoutingGraph(this.routingMode);
    this.syncTransportGate();
    void this.attachPeakMeter(ctx, merger).catch((error) => {
      this.logger?.audio("meter_worklet_failed", { error: String(error) });
    });
  }

  private availableOutputChannels(): number {
    if (!this.ctx) return 2;
    return destinationChannelCount(this.ctx.destination);
  }

  private applyRoutingGraph(mode: AudioRoutingMode): void {
    if (!this.ctx || !this.mainGain || !this.cueGain || !this.outputGate) return;
    const plan = outputRoutingPlan(mode, this.availableOutputChannels());
    if (!plan) {
      throw new Error(`Routing mode ${mode} is not supported by this soundcard.`);
    }

    this.mainGain.disconnect();
    this.cueGain.disconnect();
    this.outputMerger?.disconnect();
    this.mainSplitter?.disconnect();
    this.mainMono?.disconnect();
    this.cueMono?.disconnect();

    this.outputMerger = this.ctx.createChannelMerger(plan.channels);
    this.mainSplitter = this.ctx.createChannelSplitter(2);
    this.mainMono = this.ctx.createGain();
    this.mainMono.channelCount = 1;
    this.mainMono.channelCountMode = "explicit";
    this.mainMono.channelInterpretation = "speakers";
    this.cueMono = this.ctx.createGain();
    this.cueMono.channelCount = 1;
    this.cueMono.channelCountMode = "explicit";
    this.cueMono.channelInterpretation = "speakers";

    if (plan.mainMono) {
      this.mainGain.connect(this.mainMono);
      this.mainMono.connect(this.outputMerger, 0, plan.mainChannels[0]);
    } else {
      this.mainGain.connect(this.mainSplitter);
      plan.mainChannels.forEach((channel, sourceChannel) => {
        this.mainSplitter?.connect(this.outputMerger!, sourceChannel, channel);
      });
    }
    this.cueGain.connect(this.cueMono);
    for (const channel of plan.cueChannels) this.cueMono.connect(this.outputMerger, 0, channel);

    this.outputGate.channelCount = plan.channels;
    this.outputGate.channelCountMode = "explicit";
    this.outputGate.channelInterpretation = "discrete";
    this.outputMerger.connect(this.outputGate);
    try {
      this.ctx.destination.channelCount = plan.channels;
      this.ctx.destination.channelCountMode = "explicit";
      this.ctx.destination.channelInterpretation = "discrete";
    } catch (error) {
      this.logger?.audio("output_channel_config_failed", { error: String(error) });
    }
    this.routingMode = mode;
    this.outputChannels = this.availableOutputChannels();
    this.logger?.audio("output_routing_changed", {
      deviceId: this.outputDeviceId,
      mode,
      availableChannels: this.outputChannels,
      mainOutputs: plan.mainChannels.map((channel) => channel + 1),
      cueOutputs: plan.cueChannels.map((channel) => channel + 1)
    });
  }

  private unlockNow(ctx: AudioContext): void {
    if (ctx.state !== "running") {
      void ctx.resume();
    }
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch (error) {
      this.logger?.audio("engine_unlock_failed", { error: String(error), state: ctx.state });
    }
  }

  /**
   * iOS parks the context as "interrupted" for an alert or a route change.
   * Nothing else notices: the transport keeps reporting Playing while currentTime stops
   * advancing. Nothing in this app suspends the context deliberately, so any non-running
   * state here is a fault to recover from. `poll` keeps trying, because one `resume()`
   * can be refused while the session is still down.
   */
  private resumeInFlight = false;

  private watchContextState(ctx: AudioContext): void {
    ctx.addEventListener("statechange", () => {
      this.logger?.audio("engine_state_changed", { state: ctx.state });
      if (ctx !== this.ctx || ctx.state === "running" || ctx.state === "closed") return;
      void this.resumeContext();
    });
  }

  private async resumeContext(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "running" || ctx.state === "closed" || this.resumeInFlight) return;
    this.resumeInFlight = true;
    try {
      await ctx.resume();
    } catch (error) {
      this.logger?.audio("engine_resume_failed", { error: String(error), state: ctx.state });
      return;
    } finally {
      this.resumeInFlight = false;
    }
    if ((ctx.state as AudioContextState) === "running") {
      this.logger?.audio("engine_resumed", {});
    }
  }

  async listOutputs(): Promise<HardwareOutput[]> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return [{ id: "default", label: "System Default", channels: this.outputChannels }];
    }
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audiooutput"
    );
    if (devices.length === 0) {
      return [{ id: "default", label: "System Default", channels: this.outputChannels }];
    }
    return devices.map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Soundcard ${index + 1}`,
      channels: device.deviceId === this.outputDeviceId ? this.outputChannels : 0
    }));
  }

  async selectOutput(
    deviceId: string,
    opts?: { recreateIfStereo?: boolean }
  ): Promise<{
    channels: number;
    routingMode: AudioRoutingMode;
  }> {
    await this.init();
    await this.bindOutputDevice(deviceId, opts?.recreateIfStereo);
    if (!outputRoutingPlan(this.routingMode, this.outputChannels)) this.routingMode = 1;
    this.applyRoutingGraph(this.routingMode);
    return { channels: this.outputChannels, routingMode: this.routingMode };
  }

  refreshOutputChannels(): number {
    this.outputChannels = this.availableOutputChannels();
    return this.outputChannels;
  }

  private async bindOutputDevice(deviceId: string, recreateIfStereo?: boolean): Promise<void> {
    const sinkId = deviceId === "default" ? "" : deviceId;
    const context = this.ctx as
      | (AudioContext & { setSinkId?: (sinkId: string) => Promise<void>; sinkId?: string })
      | null;
    if (!context?.setSinkId && sinkId) {
      throw new Error("This browser cannot select a different soundcard.");
    }
    if (context?.setSinkId) {
      const alreadyOnSink = (context.sinkId ?? "") === sinkId;
      await context.setSinkId(sinkId);
      this.outputDeviceId = deviceId;
      this.outputChannels = this.availableOutputChannels();
      if (this.outputChannels >= 3) return;
      if (alreadyOnSink && recreateIfStereo !== true) return;
    } else {
      this.outputDeviceId = deviceId;
      this.outputChannels = this.availableOutputChannels();
      return;
    }
    await this.recreateContext(sinkId);
    this.outputDeviceId = deviceId;
    this.outputChannels = this.availableOutputChannels();
  }

  private async recreateContext(sinkId: string): Promise<void> {
    for (const deck of this.decks.values()) deck.unload();
    const previous = this.ctx;
    this.ctx = null;
    this.mainGain = null;
    this.cueGain = null;
    this.mixerMainGain = null;
    this.outputGate = null;
    this.stemGains.clear();
    this.outputMerger = null;
    this.mainSplitter = null;
    this.mainMono = null;
    this.cueMono = null;
    if (previous) {
      try {
        await previous.close();
      } catch {
        // old context may already be closed
      }
    }
    const options: AudioContextOptions & { sinkId?: string } = {};
    if (sinkId) options.sinkId = sinkId;
    this.ctx = createContext(options);
    this.unlockNow(this.ctx);
    this.watchContextState(this.ctx);
    this.buildGraph(this.ctx);
    await this.resumeContext();
  }

  setRoutingMode(mode: AudioRoutingMode): void {
    if (!this.ctx) {
      this.routingMode = mode;
      return;
    }
    this.applyRoutingGraph(mode);
  }

  getRoutingState(): {
    deviceId: string;
    channels: number;
    routingMode: AudioRoutingMode;
  } {
    return {
      deviceId: this.outputDeviceId,
      channels: this.outputChannels,
      routingMode: this.routingMode
    };
  }

  setRouting(map: Record<BusId, HardwareOutputId[]>): void {
    this.routing = map;
  }

  setGlobalGain(bus: BusId, gainDb: number): void {
    const node = bus === "CUE" ? this.cueGain : this.mainGain;
    if (node) node.gain.value = dbToGain(gainDb);
  }

  setExternalCueActive(active: boolean): void {
    this.externalCueActive = active;
    this.syncTransportGate();
  }

  fadeOut(durationSeconds: number): void {
    if (!this.outputGate || !this.ctx) return;
    const now = this.ctx.currentTime;
    const duration = Math.max(0, durationSeconds);
    const gain = this.outputGate.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + duration);
  }

  resetFadeOut(): void {
    if (!this.outputGate || !this.ctx) return;
    this.outputGate.gain.cancelScheduledValues(this.ctx.currentTime);
    this.syncTransportGate();
  }

  createDeck(id: DeckId): AudioDeck {
    const existing = this.decks.get(id);
    if (existing) return existing;
    const deck = new WebAudioDeck(id, this);
    this.decks.set(id, deck);
    return deck;
  }

  getContextTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private outputLatencyHint = 0;

  /**
   * What the platform measured for the whole path to the speaker. On iOS this comes from
   * AVAudioSession, which is the only thing that knows the real figure.
   *
   * A route past the ceiling is clamped, never dropped: a Bluetooth speaker sits at a few
   * hundred milliseconds, and answering "no delay at all" for it is the largest error
   * available rather than the safest one.
   */
  setOutputLatencyHint(seconds: number): void {
    this.outputLatencyHint =
      Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_OUTPUT_LATENCY) : 0;
  }

  /** Seconds from graph time to the speaker. Zero when the context is not running. */
  getOutputLatency(): number {
    const ctx = this.ctx;
    const output = ctx && "outputLatency" in ctx ? Number(ctx.outputLatency) : 0;
    const base = ctx && "baseLatency" in ctx ? Number(ctx.baseLatency) : 0;
    const reported = Math.max(
      Number.isFinite(output) ? output : 0,
      Number.isFinite(base) ? base : 0
    );
    // The hint describes the whole path to the speaker; the context only ever describes its
    // own graph buffer. Preferring the context meant the few milliseconds of the buffer
    // stood in for the tens the speaker actually costs, and the playhead ran ahead of the
    // music by the difference. The larger of the two is the one that can be true.
    const value = Math.max(this.outputLatencyHint, reported);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(value, MAX_OUTPUT_LATENCY);
  }

  poll(): void {
    const ctx = this.ctx;
    if (ctx && ctx.state !== "running" && ctx.state !== "closed") {
      void this.resumeContext();
    }
    const now = this.getContextTime();
    for (const deck of this.decks.values()) deck.poll(now);
  }
}

export async function decodeSongBuffers(
  ctx: AudioContext,
  song: Song,
  fetchBuffer: (path: string) => Promise<ArrayBuffer>
): Promise<LoadedBuffers> {
  const audioAssets = song.assets.filter(
    (asset) => asset.kind === "audio" && !isMasterPracticeAudio(asset.path)
  );
  const decoded = await Promise.all(
    audioAssets.map(async (asset) => {
      try {
        const raw = await fetchBuffer(asset.path);
        // FLAC is indexed and played a window at a time, which keeps a song at tens of
        // megabytes instead of hundreds and means nothing has to be decoded to load it.
        // Anything else, and any FLAC this cannot index, is decoded whole as before.
        const flac = parseFlac(raw);
        // Windows are decoded one at a time, so a rate that needs resampling would have
        // its joins tapered by the resampler. Decode that whole instead.
        if (flac && flac.info.sampleRate === ctx.sampleRate) {
          return { id: asset.id, asset, duration: flac.info.duration, payload: flac };
        }
        const buffer = await ctx.decodeAudioData(raw);
        return {
          id: asset.id,
          asset,
          duration: buffer.duration,
          payload: buffer
        };
      } catch (error) {
        if (asset.id.startsWith("mix_") && asset.audioRole !== "click") return null;
        throw error;
      }
    })
  );
  return { tracks: decoded.filter((track) => track !== null) };
}
