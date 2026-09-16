import { describe, expect, it } from "vitest";
import { type Song } from "@dbk/core";
import { stagePageMetaParts } from "./stage-title-meta";

const song = {
  id: "kendim",
  version: 1,
  title: "Kendim Ettim Kendim Buldum",
  duration: 204,
  key: "B",
  scale: "KURDI",
  style: "SLOW",
  kita: 2,
  assets: [],
  tempoMap: [
    { time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 },
    // The song ends on a rall, so the map walks the tempo down bar by bar.
    { time: 198, measure: 100, bpm: 115, numerator: 4, denominator: 4 },
    { time: 202, measure: 102, bpm: 105, numerator: 4, denominator: 4 }
  ],
  sections: []
} as Song;

describe("stagePageMetaParts", () => {
  it("gives the singer the key on its own", () => {
    expect(stagePageMetaParts(song, "lyrics")).toEqual(["B KURDI"]);
  });

  it("adds the verse and the meter on the score and chord pages", () => {
    expect(stagePageMetaParts(song, "score")).toEqual(["B KURDI", "KITA 2", "4/4"]);
    expect(stagePageMetaParts(song, "chord")).toEqual(["B KURDI", "KITA 2", "4/4"]);
  });

  it("counts the drummer in on the tempo the song starts at", () => {
    expect(stagePageMetaParts(song, "drums")).toEqual(["KITA 2", "4/4", "120 BPM"]);
  });
});
