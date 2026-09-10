import { describe, expect, it } from "vitest";
import { followClockPlaying, followClockTime, setFollowClock, stopFollowClock } from "./follow-clock";

describe("followClockTime", () => {
  it("holds still while not playing", () => {
    setFollowClock(4, false, 1_000);
    expect(followClockPlaying()).toBe(false);
    expect(followClockTime(1_250)).toBe(4);
  });

  it("advances from the last master packet by wall time", () => {
    setFollowClock(7.2, true, 2_000);
    expect(followClockPlaying()).toBe(true);
    expect(followClockTime(2_400)).toBeCloseTo(7.6, 5);
  });

  it("stops advancing after stop", () => {
    setFollowClock(3, true, 5_000);
    stopFollowClock(3.5, 5_500);
    expect(followClockTime(6_000)).toBe(3.5);
  });
});
