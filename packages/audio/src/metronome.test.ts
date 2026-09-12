import { describe, expect, it } from "vitest";
import { METRO_INTRO_URLS, metroIntroClickIndex } from "./metronome.js";

describe("metroIntroClickIndex", () => {
  it("plays 1.flac then 2.flac on the first two clicks only", () => {
    expect(METRO_INTRO_URLS).toEqual(["/library/1.flac", "/library/2.flac"]);
    expect(metroIntroClickIndex(0, 2)).toBe(0);
    expect(metroIntroClickIndex(1, 2)).toBe(1);
    expect(metroIntroClickIndex(2, 2)).toBeUndefined();
    expect(metroIntroClickIndex(3, 2)).toBeUndefined();
  });
});
