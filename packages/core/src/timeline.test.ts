import { describe, expect, it } from "vitest";
import {
  firstSectionNamed,
  measureStartTimes,
  sectionAfter,
  sectionAt,
  sectionIndexAt,
  sectionNamed,
  timeToMusical
} from "./timeline.js";
import type { TempoPoint } from "./models.js";

const map: TempoPoint[] = [
  { time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 },
  { time: 8, measure: 5, bpm: 60, numerator: 3, denominator: 4 }
];

describe("timeToMusical", () => {
  it("starts at measure 1 beat 1", () => {
    expect(timeToMusical(map, 0)).toEqual({ measure: 1, beat: 1 });
  });

  it("advances one measure every 2 seconds at 120 BPM 4/4", () => {
    const pos = timeToMusical(map, 2);
    expect(pos.measure).toBe(2);
    expect(pos.beat).toBeCloseTo(1, 5);
  });

  it("reports beat 3 at 1 second of 120 BPM 4/4", () => {
    const pos = timeToMusical(map, 1);
    expect(pos.measure).toBe(1);
    expect(pos.beat).toBeCloseTo(3, 5);
  });

  it("follows a tempo and meter change", () => {
    const pos = timeToMusical(map, 8);
    expect(pos.measure).toBe(5);
    expect(pos.beat).toBeCloseTo(1, 5);
  });
});

describe("section helpers", () => {
  const sections = [
    { name: "Serbest", start: 0, end: 2 },
    { name: "COUNT", start: 2, end: 4 },
    { name: "SAN", start: 4, end: 8 }
  ];

  it("matches section names without case and finds the following section", () => {
    expect(firstSectionNamed(sections, "SERBEST")).toBe(true);
    expect(sectionNamed(sections[1], "count")).toBe(true);
    expect(sectionAfter(sections, sections[0])).toBe(sections[1]);
  });
});

describe("measureStartTimes", () => {
  it("creates one seek position per measure across tempo changes", () => {
    expect(measureStartTimes(map, 14)).toEqual([0, 2, 4, 6, 8, 11]);
  });
});

describe("sectionAt", () => {
  const sections = [
    { name: "INTRO", start: 0, end: 4 },
    { name: "VERSE 1", start: 4, end: 12 }
  ];

  it("returns the active section", () => {
    expect(sectionAt(sections, 0)?.name).toBe("INTRO");
    expect(sectionAt(sections, 4)?.name).toBe("VERSE 1");
    expect(sectionAt(sections, 12)).toBeUndefined();
  });

  it("sectionIndexAt stays on the last section at EOF", () => {
    expect(sectionIndexAt(sections, 0)).toBe(0);
    expect(sectionIndexAt(sections, 4)).toBe(1);
    expect(sectionIndexAt(sections, 12)).toBe(1);
  });
});
