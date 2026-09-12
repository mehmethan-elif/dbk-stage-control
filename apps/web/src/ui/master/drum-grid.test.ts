import { describe, expect, it } from "vitest";
import type { PatternEvent, TempoPoint } from "@dbk/core";
import { buildHits, drumBarSteps, drumPlayheadBeat, drumPlayheadStep } from "./DrumView";

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

describe("drumPlayheadBeat", () => {
  const run = { start: 0, end: 8, steps: 16, barSteps: 16 };

  it("steps with the musical beat, not the bar line", () => {
    expect(drumPlayheadStep(run, 0, common)).toBe(0);
    expect(drumPlayheadStep(run, 0.5, common)).toBe(4);
    expect(drumPlayheadBeat(run, 0.4, common)).toBe(0);
    expect(drumPlayheadBeat(run, 0.5, common)).toBe(4);
    expect(drumPlayheadBeat(run, 1.5, common)).toBe(12);
  });

  it("wraps a repeating one-bar pattern", () => {
    expect(drumPlayheadBeat(run, 2, common)).toBe(0);
    expect(drumPlayheadBeat(run, 2.5, common)).toBe(4);
  });
});
