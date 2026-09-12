import { describe, expect, it } from "vitest";
import { freePageMetroTone, previewPulseBeatIndex, songPlayheadBeatIndex } from "./song-metro-beats";

describe("freePageMetroTone", () => {
  it("marks the selected song current and the following song next", () => {
    expect(freePageMetroTone("e1", "e1", "e2")).toBe("current");
    expect(freePageMetroTone("e2", "e1", "e2")).toBe("next");
    expect(freePageMetroTone("e3", "e1", "e2")).toBeUndefined();
  });

  it("ignores missing ids", () => {
    expect(freePageMetroTone(undefined, "e1", "e2")).toBeUndefined();
    expect(freePageMetroTone("e2", "e1", null)).toBeUndefined();
  });
});

describe("previewPulseBeatIndex", () => {
  it("keeps two watches on the same beat", () => {
    expect(previewPulseBeatIndex(1.001, 0.5)).toBe(previewPulseBeatIndex(1.2, 0.5));
    expect(previewPulseBeatIndex(1.5, 0.5)).not.toBe(previewPulseBeatIndex(1.2, 0.5));
  });
});

describe("songPlayheadBeatIndex", () => {
  const map = [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }];

  it("advances on each beat of the song clock", () => {
    expect(songPlayheadBeatIndex(map, 0)).toBe(songPlayheadBeatIndex(map, 0.4));
    expect(songPlayheadBeatIndex(map, 0.5)).not.toBe(songPlayheadBeatIndex(map, 0.4));
    expect(songPlayheadBeatIndex(map, 2)).not.toBe(songPlayheadBeatIndex(map, 0));
  });
});
