import { useEffect, useState } from "react";

type FollowOrigin = {
  time: number;
  at: number;
  playing: boolean;
  source?: () => number;
  lastSample?: number;
  /** Web Audio already is the clock. Do not invent time from the wall while iOS holds currentTime. */
  lockSource?: boolean;
};

let origin: FollowOrigin = { time: 0, at: 0, playing: false };

/**
 * One animation frame loop shared by every playhead consumer. Each hook used to run its
 * own, so a stage page with lyrics, transport, position slider and score overlays mounted
 * was waking four or five loops per frame to compute the same number. The loop also parks
 * itself while the clock is stopped and is woken by the setters below.
 */
const listeners = new Set<(time: number) => void>();
let frame = 0;

function tick(): void {
  frame = 0;
  if (!origin.playing) return;
  const next = followClockTime();
  for (const listener of listeners) listener(next);
  if (listeners.size > 0) frame = requestAnimationFrame(tick);
}

function wakeFollowClock(): void {
  if (frame !== 0 || listeners.size === 0 || !origin.playing) return;
  frame = requestAnimationFrame(tick);
}

export function setFollowClock(time: number, playing: boolean, at = performance.now()): void {
  origin = { time, at, playing, source: undefined, lastSample: undefined, lockSource: false };
  wakeFollowClock();
}

/** Pin the playhead to a live audio clock (HTML element or engine position). */
export function setFollowClockSource(
  source: () => number,
  at = performance.now(),
  options?: { lock?: boolean }
): void {
  const lock = options?.lock === true;
  const time = Math.max(0, source());
  if (
    !lock &&
    origin.playing &&
    origin.source &&
    origin.lastSample != null &&
    Math.abs(time - origin.lastSample) < 0.25
  ) {
    origin = { ...origin, source, lockSource: false };
    return;
  }
  origin = { time, at, playing: true, source, lastSample: time, lockSource: lock };
  wakeFollowClock();
}

export function stopFollowClock(time = origin.time, at = performance.now()): void {
  origin = { time, at, playing: false, source: undefined, lastSample: undefined, lockSource: false };
}

export function followClockPlaying(): boolean {
  return origin.playing;
}

export function followClockTime(now = performance.now()): number {
  if (!origin.playing) return origin.time;
  if (origin.source) {
    const sampled = Math.max(0, origin.source());
    if (origin.lockSource) {
      origin = { ...origin, time: sampled, at: now, lastSample: sampled };
      return sampled;
    }
    const last = origin.lastSample;
    if (last == null || Math.abs(sampled - last) > 1e-4) {
      origin = { ...origin, time: sampled, at: now, lastSample: sampled };
      return sampled;
    }
    return Math.max(0, origin.time + (now - origin.at) / 1000);
  }
  return Math.max(0, origin.time + (now - origin.at) / 1000);
}

/** Advance a master packet by its travel time. Ignores clock skew and stale hello replays. */
export function followPacketTime(time: number, sent?: number, now = Date.now()): number {
  if (typeof sent !== "number" || !Number.isFinite(sent)) return time;
  const delay = (now - sent) / 1000;
  if (delay <= 0 || delay > 0.25) return time;
  return time + delay;
}

/**
 * Local playhead only — do not push this through the store or the PDF tree remounts.
 *
 * Pass `active: false` where the interpolated value is not being shown; the component then
 * stops re-rendering every frame instead of animating a number nobody reads.
 */
export function useFollowPlayheadTime(storeTime: number, active = true): number {
  const [time, setTime] = useState(storeTime);
  useEffect(() => {
    if (!followClockPlaying()) setTime(storeTime);
  }, [storeTime]);
  useEffect(() => {
    if (!active) return;
    const listener = (next: number) => {
      setTime((current) => (Math.abs(current - next) < 0.008 ? current : next));
    };
    listeners.add(listener);
    wakeFollowClock();
    return () => {
      listeners.delete(listener);
    };
  }, [active]);
  return active && followClockPlaying() ? time : storeTime;
}
