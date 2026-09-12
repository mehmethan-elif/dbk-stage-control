import { describe, expect, it } from "vitest";
import { METRO_INTRO_URLS, metroIntroClickIndex, metronomeAudibleTime } from "./metronome.js";

describe("metroIntroClickIndex", () => {
  it("plays 1.flac then 2.flac on the first two clicks only", () => {
    expect(METRO_INTRO_URLS).toEqual(["/library/1.flac", "/library/2.flac"]);
    expect(metroIntroClickIndex(0, 2)).toBe(0);
    expect(metroIntroClickIndex(1, 2)).toBe(1);
    expect(metroIntroClickIndex(2, 2)).toBeUndefined();
    expect(metroIntroClickIndex(3, 2)).toBeUndefined();
  });
});

describe("metronomeAudibleTime", () => {
  it("rewinds the scheduled beat to the current audio context time", () => {
    expect(metronomeAudibleTime(2, 5.12, 5)).toBeCloseTo(1.88, 5);
  });

  it("does not run ahead of the next scheduled beat", () => {
    expect(metronomeAudibleTime(2, 5, 5.2)).toBe(2);
  });
});
