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

interface WebTrack {
  id: string;
  asset: LoadedTrack["asset"];
  buffer: AudioBuffer;
  gain: GainNode;
  panner: StereoPannerNode;
  muted: boolean;
  solo: boolean;
  gainDb: number;
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
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

  applyMixer(): void {
    this.applyMix();
  }

  constructor(id: DeckId, engine: WebAudioEngine) {
    this.id = id;
    this.engine = engine;
  }

  hasLiveSources(): boolean {
    return this.sources.length > 0;
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
    this.song = song;
    const ctx = this.engine.context;
    this.tracks = files.tracks.map((track) => {
      const buffer = track.payload as AudioBuffer | undefined;
      if (!buffer) {
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
        buffer,
        gain,
        panner,
        muted: false,
        solo: false,
        gainDb: 0
      };
    });
    this.applyMix();
    const click = this.tracks.find((track) => track.asset.audioRole === "click");
    this.clickDuration = click?.buffer.duration ?? song.clickDuration ?? 0;
    this.longestDuration = this.tracks.reduce((max, track) => Math.max(max, track.buffer.duration), 0);
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
    for (const track of this.tracks) {
      const source = ctx.createBufferSource();
      source.buffer = track.buffer;
      source.connect(track.gain);
      source.start(when, offset);
      this.sources.push(source);
    }
    this.engine.syncTransportGate();
  }

  pause(): void {
    if (this.playing) this.pausedAt = this.getPosition();
    this.playing = false;
    this.stopSources();
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
    for (const track of this.tracks) {
      track.gain.disconnect();
      track.panner.disconnect();
    }
    this.tracks = [];
    this.song = null;
  }

  poll(now: number): void {
    if (!this.playing || this.startedAt === null) return;
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
    for (const source of this.sources) {
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
      this.ctx = new AudioContext();
      this.unlockNow(this.ctx);
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

  private async resumeContext(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "running") return;
    try {
      await ctx.resume();
    } catch (error) {
      this.logger?.audio("engine_resume_failed", { error: String(error), state: ctx.state });
      return;
    }
    if (ctx.state === "running") {
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
    this.ctx = new AudioContext(options);
    this.unlockNow(this.ctx);
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

  /** Seconds from graph time to the speaker. Zero when the context is not running. */
  getOutputLatency(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const output = "outputLatency" in ctx ? Number(ctx.outputLatency) : 0;
    const base = "baseLatency" in ctx ? Number(ctx.baseLatency) : 0;
    const value = output > 0 ? output : base;
    if (!Number.isFinite(value) || value <= 0 || value > 0.25) return 0;
    return value;
  }

  poll(): void {
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
