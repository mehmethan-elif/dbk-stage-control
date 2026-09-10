import { describe, expect, it } from "vitest";
import {
  firstSectionNamed,
  measureRangeFill,
  measureStartTimes,
  nextMeasureStart,
  nextSectionStart,
  panicDefaultTarget,
  resolveTempoMeters,
  sectionAfter,
  sectionAt,
  sectionBoundaryTimes,
  sectionForBoundary,
  sectionIndexAt,
  sectionNamed,
  snapSongToMeasureGrid,
  snapToMeasureStart,
  snapToSectionBoundary,
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

  it("keeps the previous meter on a rall tempo point with unset time signature", () => {
    const rall: TempoPoint[] = [
      { time: 0, measure: 1, bpm: 114, numerator: 4, denominator: 4 },
      { time: 10, measure: 6, bpm: 99, numerator: -1, denominator: -1 }
    ];
    const bar = (60 / 99) * 4;
    expect(timeToMusical(rall, 10).measure).toBe(6);
    expect(timeToMusical(rall, 10 + bar).measure).toBe(7);
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

describe("132 BPM barlines", () => {
  const bizMap: TempoPoint[] = [{ time: 0, measure: 1, bpm: 132, numerator: 4, denominator: 4 }];
  const san1 = [
    { name: "ARA", start: 16.363636, end: 30.909091 },
    { name: "SAN 1", start: 30.909091, end: 56.363636 }
  ];

  it("keeps the slider measure and the score measure on the same bar", () => {
    const starts = measureStartTimes(bizMap, 40);
    expect(timeToMusical(bizMap, starts[17]!).measure).toBe(18);
    expect(timeToMusical(bizMap, starts[18]!).measure).toBe(19);
    expect(sectionAt(san1, starts[17]!)?.name).toBe("SAN 1");
  });
});

describe("114 BPM rounded section starts", () => {
  const map: TempoPoint[] = [{ time: 0, measure: 1, bpm: 114, numerator: 4, denominator: 4 }];
  const sections = [
    { name: "ARA", start: 94.736842, end: 122.105434 },
    { name: "SAN A", start: 122.105434, end: 138.94754 },
    { name: "SAN B", start: 138.94754, end: 160.000171 },
    { name: "NAK", start: 160.000171, end: 188.144107 }
  ];

  it("puts the slider barline in the section even when JSON start is 0.17ms late", () => {
    const starts = measureStartTimes(map, 188);
    const near = (time: number) =>
      starts.reduce((best, start) =>
        Math.abs(start - time) < Math.abs(best - time) ? start : best
      );
    expect(sectionAt(sections, near(122.105434))?.name).toBe("SAN A");
    expect(sectionAt(sections, near(138.94754))?.name).toBe("SAN B");
    expect(sectionAt(sections, near(160.000171))?.name).toBe("NAK");
  });
});

describe("snapSongToMeasureGrid", () => {
  const bar = 240 / 114;
  const raw = {
    duration: 188,
    tempoMap: [
      { time: 0, measure: 1, bpm: 114, numerator: 4, denominator: 4 },
      { time: 181.052632, measure: 87, bpm: 107, numerator: -1, denominator: -1 }
    ],
    sections: [
      { name: "ARA", start: 94.736842, end: 122.105434 },
      { name: "SAN A", start: 122.105434, end: 138.94754 },
      { name: "SAN B", start: 138.94754, end: 160.000171 },
      { name: "NAK", start: 160.000171, end: 188.144107 }
    ],
    lyrics: [
      { time: 122.105434, end: 124.210697, text: "near" },
      { time: 122.905434, end: 124.210697, text: "pickup" }
    ]
  };

  it("writes inherited meters over -1/-1 rall points", () => {
    expect(resolveTempoMeters(raw.tempoMap)[1]).toMatchObject({
      numerator: 4,
      denominator: 4,
      bpm: 107
    });
  });

  it("snaps late section starts onto the barline and stitches adjacent ends", () => {
    const snapped = snapSongToMeasureGrid(raw);
    expect(snapped.sections[1]?.start).toBeCloseTo(58 * bar, 9);
    expect(snapped.sections[2]?.start).toBeCloseTo(66 * bar, 9);
    expect(snapped.sections[3]?.start).toBeCloseTo(76 * bar, 9);
    expect(snapped.sections[0]?.end).toBe(snapped.sections[1]?.start);
    expect(sectionAt(snapped.sections, 58 * bar)?.name).toBe("SAN A");
    expect(timeToMusical(snapped.tempoMap, 58 * bar).measure).toBe(59);
  });

  it("snaps lyrics that sit on a barline and leaves mid-measure pickups", () => {
    const snapped = snapSongToMeasureGrid(raw);
    expect(snapped.lyrics?.[0]?.time).toBeCloseTo(58 * bar, 9);
    expect(snapped.lyrics?.[1]?.time).toBeCloseTo(122.905434, 6);
  });
});

describe("measureRangeFill", () => {
  it("fills a four-measure span one measure at a time", () => {
    expect(measureRangeFill(map, 0, 8, -0.1)).toBe(0);
    expect(measureRangeFill(map, 0, 8, 0)).toBe(0.25);
    expect(measureRangeFill(map, 0, 8, 2)).toBe(0.5);
    expect(measureRangeFill(map, 0, 8, 6)).toBe(1);
    expect(measureRangeFill(map, 0, 8, 8)).toBe(1);
  });
});

describe("panic targets", () => {
  const sections = [
    { name: "INTRO", start: 0, end: 4 },
    { name: "VERSE", start: 4, end: 8 },
    { name: "OUTRO", start: 8, end: 12 }
  ];
  const starts = [0, 2, 4, 6, 8, 10];

  it("jumps the panic slider to the next section start", () => {
    expect(nextSectionStart(sections, 1)).toBe(4);
    expect(nextSectionStart(sections, 4)).toBe(8);
    expect(nextSectionStart(sections, 9)).toBeUndefined();
  });

  it("snaps and finds the following measure", () => {
    expect(snapToMeasureStart(starts, 3.4)).toBe(4);
    expect(nextMeasureStart(starts, 4.1)).toBe(6);
    expect(panicDefaultTarget(sections, starts, 1)).toBe(4);
    expect(panicDefaultTarget(sections, starts, 9)).toBe(10);
  });

  it("snaps the panic slider to a section start or end", () => {
    expect(sectionBoundaryTimes(sections)).toEqual([0, 4, 8, 12]);
    expect(snapToSectionBoundary(sections, 1.2)).toBe(0);
    expect(snapToSectionBoundary(sections, 2.8)).toBe(4);
    expect(snapToSectionBoundary(sections, 11.2)).toBe(12);
    expect(sectionForBoundary(sections, 4)?.name).toBe("VERSE");
    expect(sectionForBoundary(sections, 12)?.name).toBe("OUTRO");
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
