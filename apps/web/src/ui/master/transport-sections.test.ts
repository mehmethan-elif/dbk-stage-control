import { describe, expect, it } from "vitest";
import type { Song } from "@dbk/core";
import {
  nearestMeasureIndex,
  sliderTimeFromClientX,
  songTransportEnd,
  songTransportSections
} from "./transport-sections";

function song(sections: { name: string; start: number; end: number }[], duration?: number): Song {
  const last = sections.at(-1)?.end ?? 0;
  return {
    id: "s",
    version: 1,
    title: "T",
    duration: duration ?? last,
    assets: [],
    tempoMap: [{ time: 0, measure: 1, bpm: 132, numerator: 4, denominator: 4 }],
    sections
  };
}

const biz = song(
  [
    { name: "COUNT", start: 0, end: 1.8 },
    { name: "ARA", start: 1.8, end: 16.4 },
    { name: "ARA", start: 16.4, end: 30.9 },
    { name: "SAN 1", start: 30.9, end: 56.4 },
    { name: "CEV", start: 56.4, end: 60 },
    { name: "SAN 2", start: 60, end: 85.5 },
    { name: "CEV+ FINAL", start: 85.5, end: 89.1 },
    { name: "ARA", start: 89.1, end: 103.6 },
    { name: "ARA", start: 103.6, end: 118.2 },
    { name: "SAN 1", start: 118.2, end: 143.6 },
    { name: "CEV", start: 143.6, end: 147.3 },
    { name: "SAN 2", start: 147.3, end: 172.7 },
    { name: "CEV+ FINAL", start: 172.7, end: 176.4 }
  ],
  178
);

describe("songTransportSections", () => {
  it("paints every song.json section, including the second pass", () => {
    expect(songTransportSections(biz).map((section) => section.name)).toEqual([
      "COUNT",
      "ARA",
      "ARA",
      "SAN 1",
      "CEV",
      "SAN 2",
      "CEV+ FINAL",
      "ARA",
      "ARA",
      "SAN 1",
      "CEV",
      "SAN 2",
      "CEV+ FINAL"
    ]);
    expect(songTransportEnd(biz)).toBeCloseTo(176.4);
  });
});

describe("sliderTimeFromClientX", () => {
  it("maps the left edge, middle, and right edge of the bar", () => {
    const rect = { left: 100, width: 200 };
    expect(sliderTimeFromClientX(100, rect, 0, 80)).toBe(0);
    expect(sliderTimeFromClientX(200, rect, 0, 80)).toBe(40);
    expect(sliderTimeFromClientX(300, rect, 0, 80)).toBe(80);
  });

  it("stays inside the song when the finger overshoots", () => {
    expect(sliderTimeFromClientX(0, { left: 100, width: 200 }, 0, 80)).toBe(0);
    expect(sliderTimeFromClientX(400, { left: 100, width: 200 }, 0, 80)).toBe(80);
  });
});

describe("nearestMeasureIndex", () => {
  it("picks the closest barline", () => {
    expect(nearestMeasureIndex([0, 2, 4, 6], 3.1)).toBe(2);
    expect(nearestMeasureIndex([0, 2, 4, 6], 0.4)).toBe(0);
  });
});
