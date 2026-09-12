import { useEffect, useState } from "react";

type FollowOrigin = {
  time: number;
  at: number;
  playing: boolean;
  source?: () => number;
  lastSample?: number;
};

let origin: FollowOrigin = { time: 0, at: 0, playing: false };

export function setFollowClock(time: number, playing: boolean, at = performance.now()): void {
  origin = { time, at, playing, source: undefined, lastSample: undefined };
}

/** Pin the playhead to a live audio clock (HTML element or engine position). */
export function setFollowClockSource(source: () => number, at = performance.now()): void {
  const time = Math.max(0, source());
  if (
    origin.playing &&
    origin.source &&
    origin.lastSample != null &&
    Math.abs(time - origin.lastSample) < 0.25
  ) {
    origin = { ...origin, source };
    return;
  }
  origin = { time, at, playing: true, source, lastSample: time };
}

export function stopFollowClock(time = origin.time, at = performance.now()): void {
  origin = { time, at, playing: false };
}

export function followClockPlaying(): boolean {
  return origin.playing;
}

export function followClockTime(now = performance.now()): number {
  if (!origin.playing) return origin.time;
  if (origin.source) {
    const sampled = Math.max(0, origin.source());
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

/** Local playhead only — do not push this through the store or the PDF tree remounts. */
export function useFollowPlayheadTime(storeTime: number): number {
  const [time, setTime] = useState(storeTime);
  useEffect(() => {
    if (!followClockPlaying()) setTime(storeTime);
  }, [storeTime]);
  useEffect(() => {
    let frame = 0;
    const loop = () => {
      if (followClockPlaying()) {
        const next = followClockTime();
        setTime((current) => (Math.abs(current - next) < 0.008 ? current : next));
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);
  return followClockPlaying() ? time : storeTime;
}
