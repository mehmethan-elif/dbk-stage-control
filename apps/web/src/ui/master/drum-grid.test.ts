import { describe, expect, it } from "vitest";
import { songForm, type PatternEvent, type Song, type TempoPoint } from "@dbk/core";
import { buildHits, drumBarSteps, drumFollowKey } from "./DrumView";

const waltz: TempoPoint[] = [{ time: 0, measure: 1, bpm: 75, numerator: 3, denominator: 4 }];
const common: TempoPoint[] = [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }];

describe("drumBarSteps", () => {
  it("uses 12 steps in 3/4 and 16 in 4/4", () => {
    expect(drumBarSteps(waltz, 0)).toBe(12);
    expect(drumBarSteps(common, 0)).toBe(16);
  });
});

describe("buildHits", () => {
  it("places 3/4 disco hits on beats 1 2 and 3", () => {
    const pattern: PatternEvent = {
      text: "3/4 DISCO",
      time: 26.4,
      end: 28.8,
      length: 2.4,
      measure: 12,
      beat: 1,
      numerator: 3,
      denominator: 4,
      notes: [
        { time: 26.4, pitch: 48, numerator: 3, denominator: 4 },
        { time: 27.2, pitch: 48, numerator: 3, denominator: 4 },
        { time: 28, pitch: 48, numerator: 3, denominator: 4 },
        { time: 28, pitch: 50, numerator: 3, denominator: 4 }
      ]
    };
    const built = buildHits(pattern, waltz);
    expect(built.barSteps).toBe(12);
    expect(built.steps).toBe(12);
    expect([...built.hits.get("C") ?? []].sort((a, b) => a - b)).toEqual([0, 4, 8]);
    expect([...built.hits.get("D") ?? []]).toEqual([8]);
  });

  it("keeps 4/4 patterns on a 16-step bar", () => {
    const pattern: PatternEvent = {
      text: "GROOVE",
      time: 2,
      end: 4,
      length: 2,
      measure: 2,
      beat: 1,
      numerator: 4,
      denominator: 4,
      notes: [
        { time: 2, pitch: 48, numerator: 4, denominator: 4 },
        { time: 3, pitch: 48, numerator: 4, denominator: 4 }
      ]
    };
    const built = buildHits(pattern, common);
    expect(built.barSteps).toBe(16);
    expect([...built.hits.get("C") ?? []].sort((a, b) => a - b)).toEqual([0, 8]);
  });
});

function song(sections: { name: string; start: number; end: number }[]): Song {
  return {
    id: "s",
    version: 1,
    title: "T",
    duration: sections[sections.length - 1]?.end ?? 0,
    assets: [],
    tempoMap: [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }],
    sections
  };
}

describe("drumFollowKey", () => {
  it("stays on the same written block between clock ticks", () => {
    const form = songForm(
      song([
        { name: "ARA", start: 0, end: 8 },
        { name: "SAN", start: 8, end: 16 }
      ]),
      { identity: "drums" }
    );
    const first = drumFollowKey(form, 1);
    expect(first).toBeTruthy();
    expect(drumFollowKey(form, 1.5)).toBe(first);
    expect(drumFollowKey(form, 7.9)).toBe(first);
    expect(drumFollowKey(form, 8.1)).not.toBe(first);
  });
});
