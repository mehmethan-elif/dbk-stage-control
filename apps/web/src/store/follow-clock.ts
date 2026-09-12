import { useEffect, useState } from "react";

type FollowOrigin = {
  time: number;
  at: number;
  playing: boolean;
  source?: () => number;
};

let origin: FollowOrigin = { time: 0, at: 0, playing: false };

export function setFollowClock(time: number, playing: boolean, at = performance.now()): void {
  origin = { time, at, playing, source: undefined };
}

/** Pin the playhead to a live audio clock (HTML element or engine position). */
export function setFollowClockSource(source: () => number): void {
  origin = { time: Math.max(0, source()), at: performance.now(), playing: true, source };
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
    const time = origin.source();
    origin = { ...origin, time: Math.max(0, time), at: now };
    return origin.time;
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
