import { describe, expect, it } from "vitest";
import {
  followClockPlaying,
  followClockTime,
  followPacketTime,
  setFollowClock,
  setFollowClockSource,
  stopFollowClock
} from "./follow-clock";

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

  it("reads a live audio source when the sample advances", () => {
    let audioTime = 12.4;
    stopFollowClock(0, 0);
    setFollowClockSource(() => audioTime, 8_000);
    expect(followClockTime(8_000)).toBeCloseTo(12.4, 5);
    audioTime = 12.55;
    expect(followClockTime(8_200)).toBeCloseTo(12.55, 5);
  });

  it("interpolates while an HTML audio sample stays stuck", () => {
    let audioTime = 4;
    stopFollowClock(0, 0);
    setFollowClockSource(() => audioTime, 1_000);
    expect(followClockTime(1_000)).toBeCloseTo(4, 5);
    expect(followClockTime(1_250)).toBeCloseTo(4.25, 5);
    audioTime = 4.2;
    expect(followClockTime(1_400)).toBeCloseTo(4.2, 5);
  });
});

describe("followPacketTime", () => {
  it("adds the packet travel time", () => {
    expect(followPacketTime(10, 1_000, 1_180)).toBeCloseTo(10.18, 5);
  });

  it("keeps the packet time when sent is missing or skewed", () => {
    expect(followPacketTime(10)).toBe(10);
    expect(followPacketTime(10, 1_200, 1_000)).toBe(10);
    expect(followPacketTime(10, 1_000, 4_000)).toBe(10);
    expect(followPacketTime(10, 1_000, 1_400)).toBe(10);
  });
});
