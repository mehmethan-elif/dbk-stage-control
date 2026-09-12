import { secondsPerBeat, tempoAt, type TempoPoint } from "@dbk/core";

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const BEAT_HZ = 1320;

export const METRO_INTRO_URLS = ["/library/1.flac", "/library/2.flac"] as const;

export type MetronomeBeat = {
  at: number;
};

export type MetronomeStartOpts = {
  silent?: boolean;
  intro?: boolean;
};

export function metroIntroClickIndex(clickIndex: number, introCount: number): number | undefined {
  if (clickIndex < 0 || clickIndex >= introCount) return undefined;
  return clickIndex;
}

/** Song time at the speaker — `nextSongTime` is the next scheduled beat, not the audible one. */
export function metronomeAudibleTime(
  nextSongTime: number,
  nextContextTime: number,
  contextTime: number
): number {
  return Math.max(0, nextSongTime - Math.max(0, nextContextTime - contextTime));
}

export class Metronome {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private output: AudioNode | null = null;
  private timer = 0;
  private nextTime = 0;
  private songTime = 0;
  private map: TempoPoint[] = [];
  private running = false;
  private volume = 0.7;
  private silent = false;
  private intro: Array<AudioBuffer | undefined> = [];
  private introArmed = false;
  private introClick = 0;
  private introLoad: Promise<void> | null = null;
  private introGen = 0;
  private introReady = false;

  constructor(
    private readonly onRunningChange?: (running: boolean) => void,
    private readonly onBeat?: (beat: MetronomeBeat) => void
  ) {}

  get isPlaying(): boolean {
    return this.running;
  }

  get isSilent(): boolean {
    return this.silent;
  }

  get time(): number {
    if (!this.running || !this.ctx) return this.songTime;
    return metronomeAudibleTime(this.songTime, this.nextTime, this.ctx.currentTime);
  }

  get gain(): number {
    return this.volume;
  }

  attach(ctx: AudioContext, output: AudioNode = ctx.destination): void {
    if (this.ctx === ctx && this.master && this.output === output) return;
    this.stop();
    this.master?.disconnect();
    if (this.ctx !== ctx) {
      this.introGen += 1;
      this.intro = [];
      this.introLoad = null;
      this.introReady = false;
    }
    this.ctx = ctx;
    this.output = output;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(output);
  }

  async ensureIntro(ctx: AudioContext): Promise<void> {
    if (this.introLoad) return this.introLoad;
    const gen = this.introGen;
    this.introLoad = this.fetchIntro(ctx, gen).catch((error) => {
      if (gen === this.introGen) this.introLoad = null;
      throw error;
    });
    return this.introLoad;
  }

  introPrepared(ctx: AudioContext): boolean {
    return this.ctx === ctx && this.introReady;
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.value = this.volume;
  }

  fadeOut(durationSeconds: number): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const gain = this.master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + Math.max(0, durationSeconds));
  }

  resetFadeOut(): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(this.volume, this.ctx.currentTime);
  }

  start(map: TempoPoint[], fromTime = 0, opts?: MetronomeStartOpts): void {
    if (!this.ctx || !this.master) return;
    this.stop();
    this.silent = opts?.silent === true;
    this.introArmed = opts?.intro === true && !this.silent;
    this.introClick = 0;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    this.map = map;
    this.running = true;
    this.onRunningChange?.(true);
    this.songTime = Math.max(0, fromTime);
    this.nextTime = this.ctx.currentTime + 0.05;
    this.tick();
  }

  stop(): void {
    const wasRunning = this.running;
    if (wasRunning && this.ctx) {
      this.songTime = metronomeAudibleTime(this.songTime, this.nextTime, this.ctx.currentTime);
    }
    this.running = false;
    if (wasRunning) this.onRunningChange?.(false);
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = 0;
    }
  }

  private async fetchIntro(ctx: AudioContext, gen: number): Promise<void> {
    const loaded = await Promise.all(
      METRO_INTRO_URLS.map(async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return undefined;
          const raw = await res.arrayBuffer();
          return await ctx.decodeAudioData(raw.slice(0));
        } catch {
          return undefined;
        }
      })
    );
    if (gen !== this.introGen || this.ctx !== ctx) return;
    this.intro = loaded;
    this.introReady = true;
  }

  private tick = (): void => {
    if (!this.running || !this.ctx || !this.master) return;
    const horizon = this.ctx.currentTime + SCHEDULE_AHEAD;
    while (this.nextTime < horizon) {
      const point = tempoAt(this.map, this.songTime);
      this.onBeat?.({ at: this.nextTime });
      this.click(this.nextTime);
      const interval = Math.max(0.05, secondsPerBeat(point));
      this.nextTime += interval;
      this.songTime += interval;
    }
    this.timer = window.setTimeout(this.tick, LOOKAHEAD_MS);
  };

  private click(time: number): void {
    if (this.silent || !this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = BEAT_HZ;
    env.gain.setValueAtTime(1, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    osc.connect(env);
    env.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.06);
    if (!this.introArmed) return;
    const index = metroIntroClickIndex(this.introClick, METRO_INTRO_URLS.length);
    this.introClick += 1;
    if (index == null) return;
    const buffer = this.intro[index];
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.master);
    src.start(time);
  }
}
