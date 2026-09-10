import { describe, expect, it } from "vitest";
import type { Song, TempoPoint } from "@dbk/core";
import {
  firstTempoChangeMeasure,
  rallDrumTone,
  rallOverlayBoxes,
  runCoversAbsoluteMeasure,
  runShowsRallBar,
  showsRallAlert
} from "./rall-alert";

const karahisarMap: TempoPoint[] = [
  { time: 0, measure: 1, bpm: 114, numerator: 4, denominator: 4 },
  { time: 181.052632, measure: 87, bpm: 107, numerator: -1, denominator: -1 },
  { time: 183.295622, measure: 88, bpm: 99, numerator: -1, denominator: -1 }
];

function songWith(rects: Parameters<typeof rallOverlayBoxes>[1], time?: number) {
  const song = {
    id: "karahisar_kalesi",
    title: "Karahisar Kalesi",
    duration: 189.76,
    tempoMap: karahisarMap,
    sections: [
      { name: "ARA", start: 2.1, end: 29.47 },
      { name: "NAK", start: 160, end: 188.14 }
    ]
  } as Song;
  return rallOverlayBoxes(song, rects, time);
}

describe("firstTempoChangeMeasure", () => {
  it("uses the first tempo-map BPM change", () => {
    expect(firstTempoChangeMeasure(karahisarMap)).toBe(87);
  });

  it("ignores later rit points and a map with no change", () => {
    expect(
      firstTempoChangeMeasure([
        { time: 0, measure: 1, bpm: 114, numerator: 4, denominator: 4 },
        { time: 10, measure: 6, bpm: 114, numerator: 4, denominator: 4 }
      ])
    ).toBeUndefined();
    expect(firstTempoChangeMeasure(karahisarMap.slice(0, 1))).toBeUndefined();
  });
});

describe("showsRallAlert", () => {
  it("starts on the measure before RALL and stays through the end", () => {
    expect(showsRallAlert(85, 87)).toBe(false);
    expect(showsRallAlert(86, 87)).toBe(true);
    expect(showsRallAlert(89, 87)).toBe(true);
  });
});

describe("rallDrumTone", () => {
  it("stays idle until the parent section is current", () => {
    expect(rallDrumTone(86, 87, false)).toBe("idle");
    expect(rallDrumTone(86, 87, true)).toBe("soon");
    expect(rallDrumTone(87, 87, true)).toBe("now");
    expect(rallDrumTone(89, 87, true)).toBe("now");
    expect(rallDrumTone(80, 87, true)).toBe("idle");
  });
});

describe("runCoversAbsoluteMeasure", () => {
  it("marks the last SLOW run that contains the RALL measure", () => {
    expect(runCoversAbsoluteMeasure(karahisarMap, 176.842105, 188.144107, 87)).toBe(true);
    expect(runCoversAbsoluteMeasure(karahisarMap, 166.315789, 168.421053, 87)).toBe(false);
  });
});

describe("runShowsRallBar", () => {
  const song = {
    tempoMap: karahisarMap,
    sections: [
      { name: "NAK", start: 67.37, end: 94.74 },
      { name: "NAK", start: 160, end: 188.14 }
    ]
  };

  it("uses the last run of a D.S. NAK when RALL is in the later pass", () => {
    const first = { start: 84.21, end: 94.74 };
    const earlier = { start: 67.37, end: 73.68 };
    const row = { section: song.sections[0], runs: [earlier, first] };
    expect(runShowsRallBar(earlier, row, song, false)).toBe(false);
    expect(runShowsRallBar(first, row, song, true)).toBe(true);
  });

  it("uses the run that actually contains RALL when that pass is shown", () => {
    const slow = { start: 176.84, end: 188.14 };
    const fill = { start: 174.74, end: 176.84 };
    const row = { section: song.sections[1], runs: [fill, slow] };
    expect(runShowsRallBar(fill, row, song, false)).toBe(false);
    expect(runShowsRallBar(slow, row, song, true)).toBe(true);
  });
});

describe("rallOverlayBoxes", () => {
  it("follows only the current rect once the next bar is RALL", () => {
    const before = {
      id: "m85",
      name: "NAK",
      measure: 9,
      page: 0,
      x: 0.1,
      y: 0.7,
      w: 0.2,
      h: 0.08,
      sectionIndex: 1
    };
    const warn = {
      id: "m86",
      name: "NAK",
      measure: 10,
      page: 0,
      x: 0.35,
      y: 0.7,
      w: 0.2,
      h: 0.08,
      sectionIndex: 1
    };
    const now = {
      id: "m87",
      name: "NAK",
      measure: 11,
      page: 0,
      x: 0.6,
      y: 0.7,
      w: 0.2,
      h: 0.08,
      sectionIndex: 1
    };
    expect(songWith([before, warn, now]).map((box) => box.id)).toEqual([]);
    expect(songWith([before, warn, now], 178.95).map((box) => box.id)).toEqual(["m86"]);
    expect(songWith([before, warn, now], 181.1).map((box) => box.id)).toEqual(["m87"]);
  });

  it("falls back to the section label when the current measure has no box", () => {
    const label = {
      id: "nak",
      name: "NAK",
      measure: 0,
      kind: "label" as const,
      page: 0,
      x: 0.02,
      y: 0.64,
      w: 0.06,
      h: 0.03
    };
    expect(songWith([label], 0).map((box) => box.id)).toEqual([]);
    expect(songWith([label], 181.1).map((box) => box.id)).toEqual(["nak"]);
  });
});
