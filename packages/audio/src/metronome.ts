import { secondsPerBeat, tempoAt, type TempoPoint } from "@dbk/core";

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const ACCENT_HZ = 880;
const BEAT_HZ = 1320;

export class Metronome {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private output: AudioNode | null = null;
  private timer = 0;
  private nextTime = 0;
  private songTime = 0;
  private beatsInBar = 0;
  private map: TempoPoint[] = [];
  private beats: boolean[] = [];
  private running = false;
  private volume = 0.7;

  constructor(private readonly onRunningChange?: (running: boolean) => void) {}

  get isPlaying(): boolean {
    return this.running;
  }

  get gain(): number {
    return this.volume;
  }

  attach(ctx: AudioContext, output: AudioNode = ctx.destination): void {
    if (this.ctx === ctx && this.master && this.output === output) return;
    this.stop();
    this.master?.disconnect();
    this.ctx = ctx;
    this.output = output;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(output);
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

  start(map: TempoPoint[], beats?: boolean[]): void {
    if (!this.ctx || !this.master) return;
    this.stop();
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    this.map = map;
    this.beats = beats?.length ? beats : [];
    this.running = true;
    this.onRunningChange?.(true);
    this.songTime = 0;
    this.beatsInBar = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.tick();
  }

  stop(): void {
    const wasRunning = this.running;
    this.running = false;
    if (wasRunning) this.onRunningChange?.(false);
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = 0;
    }
  }

  private tick = (): void => {
    if (!this.running || !this.ctx || !this.master) return;
    const horizon = this.ctx.currentTime + SCHEDULE_AHEAD;
    while (this.nextTime < horizon) {
      const point = tempoAt(this.map, this.songTime);
      const beats = Math.max(1, point.numerator || 4);
      const low = this.beats.length > 0 ? this.beats[this.beatsInBar] === true : this.beatsInBar === 0;
      this.click(this.nextTime, low);
      const interval = Math.max(0.05, secondsPerBeat(point));
      this.nextTime += interval;
      this.songTime += interval;
      this.beatsInBar += 1;
      if (this.beatsInBar >= beats) this.beatsInBar = 0;
    }
    this.timer = window.setTimeout(this.tick, LOOKAHEAD_MS);
  };

  private click(time: number, accent: boolean): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? ACCENT_HZ : BEAT_HZ;
    const peak = accent ? 1 : 0.55;
    env.gain.setValueAtTime(peak, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + (accent ? 0.045 : 0.03));
    osc.connect(env);
    env.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.06);
  }
}
