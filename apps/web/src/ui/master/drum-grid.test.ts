import { describe, expect, it } from "vitest";
import { formAt, formNextAt, songForm, type PatternEvent, type Song, type TempoPoint } from "@dbk/core";
import { buildHits, drumBarSteps, drumFollowKey, drumFollowTargets, nextDrumPatternRun, visitFillCue, writtenChart } from "./DrumView";

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

describe("writtenChart", () => {
  it("counts the repeated bars of a rallentando as one run", () => {
    // Every bar of a rall sits at its own tempo, so the same bar arrives written out again.
    const rall: TempoPoint[] = [
      { time: 0, measure: 1, bpm: 115, numerator: 4, denominator: 4 },
      { time: 2.086957, measure: 2, bpm: 110, numerator: 4, denominator: 4 },
      { time: 4.268775, measure: 3, bpm: 105, numerator: 4, denominator: 4 }
    ];
    const tus = (start: number, end: number, measure: number, offsets: [number, number][]): PatternEvent => ({
      text: "TUS",
      time: start,
      end,
      length: end - start,
      measure,
      beat: 1,
      numerator: 4,
      denominator: 4,
      notes: offsets.map(([offset, pitch]) => ({
        time: start + offset,
        pitch,
        numerator: 4,
        denominator: 4
      }))
    });
    const full: [number, number][] = [
      [0, 48],
      [0, 53]
    ];
    const target: Song = {
      ...song([{ name: "NAK", start: 0, end: 6.554489 }]),
      tempoMap: rall,
      patterns: [
        tus(0, 2.086957, 1, [...full, [0.782609, 48], [1.043478, 48], [1.043478, 53]]),
        tus(2.086957, 4.268775, 2, [...full, [0.818182, 48], [1.090909, 48], [1.090909, 53]]),
        // The last bar of the rall thins out to the downbeat, so it is not the same bar.
        tus(4.268775, 6.554489, 3, full)
      ]
    };
    const rows = writtenChart(target, songForm(target, { identity: "drums" }));
    expect(rows[0]?.runs.map((run) => [run.name, run.repeats])).toEqual([
      ["TUS", 2],
      ["TUS", 1]
    ]);
  });

  it("puts a mid-section FILL on that bar, not the last bar of the NAK", () => {
    const rock = (start: number, end: number): PatternEvent => ({
      text: "ROCK",
      time: start,
      end,
      length: end - start,
      measure: 1,
      beat: 1,
      numerator: 4,
      denominator: 4,
      notes: [{ time: start, pitch: 48, numerator: 4, denominator: 4 }]
    });
    const fill = (start: number, end: number): PatternEvent => ({
      text: "FILL",
      time: start,
      end,
      length: end - start,
      measure: 1,
      beat: 1,
      numerator: 4,
      denominator: 4,
      notes: []
    });
    const target: Song = {
      ...song([
        { name: "ARA", start: 0, end: 4 },
        { name: "NAK", start: 4, end: 22 },
        { name: "ARA", start: 22, end: 26 },
        { name: "NAK", start: 26, end: 44 }
      ]),
      patterns: [rock(0, 2), fill(2, 4), rock(4, 6), fill(20, 22), rock(22, 24), fill(24, 26), rock(26, 28), fill(36, 38)]
    };
    const form = songForm(target, { identity: "drums" });
    const rows = writtenChart(target, form);
    expect(form.blocks.map((block) => [block.name, block.coda, block.toCoda])).toEqual([
      ["ARA", false, false],
      ["NAK", false, false]
    ]);
    expect(rows.find((row) => row.section.name === "NAK")?.runs.map((run) => [run.name, run.repeats, run.cue?.start])).toEqual([
      ["ROCK", 9, 20]
    ]);
    expect(visitFillCue(target, { start: 26, end: 44 })).toEqual({
      text: "FILL",
      start: 36,
      end: 38
    });
  });

  it("carries HALAY into the next ARA when the export only wrote the SENKOP", () => {
    // Ayrıldım Güler miyim: each ARA is HALAY x5 + SENKOP x1, but the second ARA
    // only has the SENKOP MIDI. The drummer still reads the same two rows.
    const groove = (
      text: string,
      start: number,
      end: number,
      notes: number
    ): PatternEvent => ({
      text,
      time: start,
      end,
      length: end - start,
      measure: 1,
      beat: 1,
      numerator: 4,
      denominator: 4,
      notes: notes
        ? [{ time: start, pitch: 48, numerator: 4, denominator: 4 }]
        : []
    });
    const target: Song = {
      ...song([
        { name: "ARA", start: 0, end: 12 },
        { name: "ARA", start: 12, end: 24 }
      ]),
      patterns: [groove("HALAY", 0, 2, 1), groove("SENKOP", 10, 12, 1), groove("SENKOP", 22, 24, 1)]
    };
    const rows = writtenChart(target, songForm(target, { identity: "drums" }));
    expect(rows.map((row) => row.runs.map((run) => [run.name, run.repeats]))).toEqual([
      [
        ["HALAY", 5],
        ["SENKOP", 1]
      ],
      [
        ["HALAY", 5],
        ["SENKOP", 1]
      ]
    ]);
  });

  it("never draws FILL as a pattern when a section has only text FILL", () => {
    const groove = (text: string, start: number, end: number, notes: number): PatternEvent => ({
      text,
      time: start,
      end,
      length: end - start,
      measure: 1,
      beat: 1,
      numerator: 4,
      denominator: 4,
      notes: notes ? [{ time: start, pitch: 48, numerator: 4, denominator: 4 }] : []
    });
    const target: Song = {
      ...song([
        { name: "SAN A", start: 0, end: 16 },
        { name: "SAN B", start: 16, end: 32 }
      ]),
      patterns: [groove("Pattern C", 0, 2, 1), groove("FILL", 30, 32, 0)]
    };
    const rows = writtenChart(target, songForm(target, { identity: "drums" }));
    expect(rows.find((row) => row.section.name === "SAN B")?.runs.map((run) => [run.name, run.repeats, run.cue?.text])).toEqual([
      ["Pattern C", 8, "FILL"]
    ]);
  });
});

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

describe("nextDrumPatternRun", () => {
  function groove(start: number, end: number, text: string): PatternEvent {
    return {
      text,
      time: start,
      end,
      length: end - start,
      measure: 1,
      beat: 1,
      numerator: 4,
      denominator: 4,
      notes: [{ time: start, pitch: 48, numerator: 4, denominator: 4 }]
    };
  }

  it("takes the first groove of the next section when that pattern starts after the bar line", () => {
    const target: Song = {
      ...song([
        { name: "ARA", start: 0, end: 8 },
        { name: "SAN", start: 8, end: 16 }
      ]),
      patterns: [groove(0, 8, "SLOW"), groove(8.05, 16, "TUS")]
    };
    const form = songForm(target, { identity: "drums" });
    const chart = writtenChart(target, form);
    const pos = formAt(form, 7.5);
    const nextPos = formNextAt(form, 7.5, 8);
    expect(nextDrumPatternRun(chart, pos, nextPos)?.name).toBe("TUS");
  });
});

describe("drumFollowTargets", () => {
  const pack = { id: "pack" };
  const run = { closest: (selector: string) => (selector === ".drum-pack" ? pack : null) };
  const nextPack = { id: "next" };
  const firstPack = { id: "first" };
  const song = { querySelector: () => firstPack };

  it("aims at the played run and the next pack", () => {
    expect(
      drumFollowTargets({
        currentRun: run,
        currentPack: pack,
        nextPack,
        song
      })
    ).toEqual({ current: run, next: nextPack });
  });

  it("falls back to the first pack of the song, not the whole article", () => {
    expect(
      drumFollowTargets({
        currentRun: null,
        currentPack: null,
        nextPack: null,
        song
      })
    ).toEqual({ current: firstPack, next: null });
  });
});
