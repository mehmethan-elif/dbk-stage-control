import { useEffect, useState } from "react";

type FollowOrigin = {
  time: number;
  at: number;
  playing: boolean;
};

let origin: FollowOrigin = { time: 0, at: 0, playing: false };

export function setFollowClock(time: number, playing: boolean, at = performance.now()): void {
  origin = { time, at, playing };
}

export function stopFollowClock(time = origin.time, at = performance.now()): void {
  origin = { time, at, playing: false };
}

export function followClockPlaying(): boolean {
  return origin.playing;
}

export function followClockTime(now = performance.now()): number {
  if (!origin.playing) return origin.time;
  return Math.max(0, origin.time + (now - origin.at) / 1000);
}

/** Local playhead only — do not push this through the store or the PDF tree remounts. */
export function useFollowPlayheadTime(storeTime: number): number {
  const [time, setTime] = useState(storeTime);
  useEffect(() => {
    setTime(storeTime);
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
