import { describe, expect, it } from "vitest";
import type { Song, TempoPoint } from "@dbk/core";
import {
  beatIndexForStep,
  displayChordText,
  scoreChordText,
  transposeChordText,
  chordMarksForMeasure,
  chordNamesForBox,
  measureSpan,
  rectChordLane,
  stepsForMeasure,
  notesForBox,
  notesForCurrentMeasure,
  notesForMeasure,
  notesForNextMeasure,
  notesInMeasure,
  firstDistinctMeasureNoteGrids,
  firstDistinctMeasureNoteStacks,
  nextNoteGridIfDifferent,
  occurrenceNoteGridsForBox,
  sectionNoteGridCount,
  uniqueSectionNoteGrids,
  uniqueChordLabelBoxes,
  songHasChordNotes
} from "./chord-notes";

const tempoMap: TempoPoint[] = [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }];

function song(): Song {
  return {
    id: "demo",
    version: 1,
    title: "Demo",
    duration: 8,
    assets: [],
    tempoMap,
    sections: [
      { name: "COUNT", start: 0, end: 2 },
      { name: "ARA", start: 2, end: 6 }
    ],
    chords: [
      {
        time: 2,
        text: "Dm",
        notes: [
          { time: 2, pitch: 62 },
          { time: 2.25, pitch: 65 }
        ]
      }
    ]
  };
}

describe("notesInMeasure", () => {
  it("reads notes that start in a measure", () => {
    const demo = song();
    const span = measureSpan(demo.tempoMap, 2);
    const notes = notesInMeasure(
      demo.chords ?? [],
      2,
      span.start,
      span.end,
      demo.duration,
      demo.tempoMap
    );
    expect(notes.map((note) => note.lane)).toEqual(["D", "F"]);
    expect(notes[0]?.step).toBe(0);
  });

  it("reads the next measure from the playhead", () => {
    expect(notesForNextMeasure(song(), 0).map((note) => note.lane)).toEqual(["D", "F"]);
    expect(notesForNextMeasure(song(), 2.1).map((note) => note.lane)).toEqual([]);
  });

  it("reads the current measure from the playhead", () => {
    expect(notesForCurrentMeasure(song(), 0).map((note) => note.lane)).toEqual([]);
    expect(notesForCurrentMeasure(song(), 2.1).map((note) => note.lane)).toEqual(["D", "F"]);
  });

  it("lists every chord for a measure rect", () => {
    const split = song();
    split.chords = [
      { time: 2, text: "Dm" },
      { time: 3, text: "G" }
    ];
    expect(chordNamesForBox(split, { name: "ARA", measure: 1 })).toBe("Dm G");
    expect(chordNamesForBox(split, { name: "ARA", measure: 2 })).toBe("G");
  });

  it("keeps one chord label box when later repeats share a volta", () => {
    const first = {
      id: "a",
      name: "SAN A",
      measure: 4,
      page: 0,
      x: 0.5,
      y: 0.3,
      w: 0.2,
      h: 0.08,
      sectionIndex: 3
    };
    const later = { ...first, id: "b", sectionIndex: 14 };
    const secondEnding = { ...first, id: "c", x: 0.73, sectionIndex: 4 };
    const kept = uniqueChordLabelBoxes([later, first, secondEnding]);
    expect(kept.map((box) => box.sectionIndex).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([3, 4]);
  });

  it("places later chords on the beat they start", () => {
    const split = song();
    split.chords = [
      { time: 2, text: "Dm" },
      { time: 3, text: "G" }
    ];
    expect(chordMarksForMeasure(split, 2)).toEqual([
      { text: "Dm", step: 0, beat: 0 },
      { text: "G", step: 8, beat: 2 }
    ]);
    expect(beatIndexForStep(8, 4)).toBe(2);
    expect(rectChordLane(split, { name: "ARA", measure: 1 })).toEqual({
      beats: 4,
      marks: [
        { text: "Dm", beat: 0 },
        { text: "G", beat: 2 }
      ]
    });
  });

  it("places a chord on every beat in 3/4", () => {
    const waltz: Song = {
      id: "tuna",
      version: 1,
      title: "Tuna",
      duration: 36,
      assets: [],
      tempoMap: [{ time: 0, measure: 1, bpm: 75, numerator: 3, denominator: 4 }],
      sections: [
        { name: "COUNT", start: 0, end: 2.4 },
        { name: "SAN 1", start: 26.4, end: 38.4 }
      ],
      chords: [
        { time: 28.8, end: 29.6, measure: 13, beat: 1, text: "Am" },
        { time: 29.6, end: 30.4, measure: 13, beat: 2, text: "C" },
        { time: 30.4, end: 31.2, measure: 13, beat: 3, text: "Bm" }
      ]
    };
    expect(rectChordLane(waltz, { name: "SAN 1", measure: 2 })).toEqual({
      beats: 3,
      marks: [
        { text: "Am", beat: 0 },
        { text: "C", beat: 1 },
        { text: "Bm", beat: 2 }
      ]
    });
    const unmarked = {
      ...waltz,
      chords: waltz.chords?.map(({ beat: _beat, ...chord }) => chord)
    };
    expect(rectChordLane(unmarked, { name: "SAN 1", measure: 2 })?.marks.map((mark) => mark.beat)).toEqual(
      [0, 1, 2]
    );
  });

  it("places the rall Am/Bm on beats 1 and 2", () => {
    const rall: Song = {
      id: "tuna",
      version: 1,
      title: "Tuna",
      duration: 177.540659,
      assets: [],
      tempoMap: [
        { time: 0, measure: 1, bpm: 75, numerator: 3, denominator: 4 },
        { time: 163.2, measure: 69, bpm: 70, numerator: 3, denominator: 4 },
        { time: 165.771429, measure: 70, bpm: 65, numerator: 3, denominator: 4 },
        { time: 168.540659, measure: 71, bpm: 60, numerator: 3, denominator: 4 }
      ],
      sections: [
        { name: "COUNT", start: 0, end: 2.4 },
        { name: "RALL", start: 163.2, end: 171.540659 }
      ],
      chords: [
        { time: 165.771429, end: 166.694505, measure: 70, beat: 1, text: "Am" },
        { time: 166.694505, end: 168.540659, measure: 70, beat: 1, text: "Bm" },
        { time: 168.540659, end: 169.540659, measure: 71, beat: 1, text: "Am" },
        { time: 169.540659, end: 171.540659, measure: 71, beat: 1, text: "Bm" }
      ]
    };
    expect(rectChordLane(rall, { name: "RALL", measure: 2 })).toEqual({
      beats: 3,
      marks: [
        { text: "Am", beat: 0 },
        { text: "Bm", beat: 1 }
      ]
    });
    expect(rectChordLane(rall, { name: "RALL", measure: 3 })).toEqual({
      beats: 3,
      marks: [
        { text: "Am", beat: 0 },
        { text: "Bm", beat: 1 }
      ]
    });
    expect(stepsForMeasure(rall, 70)).toBe(12);
    expect(stepsForMeasure(rall, 71)).toBe(12);
  });

  it("uses a 12-step note grid in 3/4", () => {
    const waltz: Song = {
      id: "tuna",
      version: 1,
      title: "Tuna",
      duration: 20,
      assets: [],
      tempoMap: [{ time: 0, measure: 1, bpm: 75, numerator: 3, denominator: 4 }],
      sections: [
        { name: "COUNT", start: 0, end: 2.4 },
        { name: "ARA 2", start: 14.4, end: 26.4 }
      ],
      chords: [
        {
          time: 14.4,
          text: "Em",
          notes: [
            { time: 14.4, pitch: 48 },
            { time: 15.2, pitch: 48 }
          ]
        }
      ]
    };
    expect(stepsForMeasure(waltz, 7)).toBe(12);
    expect(notesForMeasure(waltz, 7).map((note) => note.step)).toEqual([0, 4]);
  });

  it("replaces maj7 with a triangle", () => {
    expect(displayChordText("Gmaj7")).toBe("GΔ");
    expect(displayChordText("Cmaj7/E")).toBe("CΔ/E");
    expect(displayChordText("Maj7")).toBe("Δ");
    expect(displayChordText("Dm")).toBe("Dm");
  });

  it("transposes chord names up a fifth for SCORE", () => {
    expect(transposeChordText("D", 7)).toBe("A");
    expect(transposeChordText("Dm", 7)).toBe("Am");
    expect(transposeChordText("Bb", 7)).toBe("F");
    expect(transposeChordText("Dm/A", 7)).toBe("Am/E");
    expect(transposeChordText("C#m", 7)).toBe("G#m");
    expect(transposeChordText("E♭", 7)).toBe("B♭");
    expect(transposeChordText("N.C.", 7)).toBe("N.C.");
    expect(scoreChordText("Gmaj7")).toBe("DΔ");
    expect(scoreChordText("Cmaj7/E")).toBe("GΔ/B");
  });

  it("is empty when there are no chord notes", () => {
    const empty = song();
    empty.chords = [{ time: 2, text: "Dm" }];
    expect(songHasChordNotes(empty)).toBe(false);
    const span = measureSpan(empty.tempoMap, 2);
    expect(
      notesInMeasure(empty.chords ?? [], 2, span.start, span.end, empty.duration, empty.tempoMap)
    ).toEqual([]);
  });
});

describe("same-named grooves stay grouped by visit", () => {
  it("keeps same-named grooves grouped and tagged by visit", () => {
    const song: Song = {
      id: "demo",
      version: 1,
      title: "Demo",
      duration: 18,
      assets: [],
      tempoMap,
      sections: [
        { name: "COUNT", start: 0, end: 2 },
        { name: "ARA", start: 2, end: 6 },
        { name: "SAN", start: 6, end: 10 },
        { name: "ARA", start: 10, end: 14 },
        { name: "ARA", start: 14, end: 18 }
      ],
      chords: [
        {
          time: 2,
          text: "Dm",
          notes: [
            { time: 2, pitch: 50 },
            { time: 2.5, pitch: 53 }
          ]
        },
        { time: 4, text: "Dm", notes: [{ time: 4.25, pitch: 48 }] },
        { time: 10, text: "Dm", notes: [{ time: 11, pitch: 55 }] },
        {
          time: 14,
          text: "Dm",
          notes: [
            { time: 14, pitch: 50 },
            { time: 14.5, pitch: 53 }
          ]
        },
        { time: 16, text: "Dm", notes: [{ time: 16.25, pitch: 48 }] }
      ]
    };
    const [ara] = uniqueSectionNoteGrids(song);
    expect(ara?.name).toBe("ARA");
    expect(sectionNoteGridCount(ara!)).toBe(3);
    expect(ara?.groups.map((group) => ({ label: group.label, count: group.grids.length }))).toEqual([
      { label: "ARA(1)", count: 2 },
      { label: "ARA(2)", count: 1 }
    ]);
  });
});

describe("firstDistinctMeasureNoteGrids", () => {
  const box = (id: string) =>
    ({ id, name: "ARA", measure: 1, page: 0, x: 0, y: 0, w: 0.1, h: 0.08 }) as const;
  const a = [{ step: 0, lane: "C" }];
  const b = [{ step: 4, lane: "G" }];

  it("keeps the first grid in a run and hides repeats", () => {
    expect(
      firstDistinctMeasureNoteGrids([
        { box: box("1"), notes: a },
        { box: box("2"), notes: a },
        { box: box("3"), notes: b },
        { box: box("4"), notes: b },
        { box: box("5"), notes: a }
      ]).map((item) => item.box.id)
    ).toEqual(["1", "3", "5"]);
  });

  it("shows the grid again after an empty measure", () => {
    expect(
      firstDistinctMeasureNoteGrids([
        { box: box("1"), notes: a },
        { box: box("2"), notes: [] },
        { box: box("3"), notes: a }
      ]).map((item) => item.box.id)
    ).toEqual(["1", "3"]);
  });

  it("stacks a second occurrence when its grid differs", () => {
    const stacked = firstDistinctMeasureNoteStacks([
      { box: box("1"), layers: [a, b] },
      { box: box("2"), layers: [a, b] },
      { box: box("3"), layers: [a] }
    ]);
    expect(stacked.map((item) => ({ id: item.box.id, n: item.layers.length }))).toEqual([
      { id: "1", n: 2 },
      { id: "3", n: 1 }
    ]);
  });
});

describe("nextNoteGridIfDifferent", () => {
  const now = [{ step: 0, lane: "D" }, { step: 4, lane: "F" }];
  const later = [{ step: 8, lane: "G" }];

  it("returns the next grid only when it differs", () => {
    expect(nextNoteGridIfDifferent(now, later)?.map((note) => `${note.step}:${note.lane}`)).toEqual([
      "8:G"
    ]);
    expect(nextNoteGridIfDifferent(now, now)).toBeUndefined();
    expect(nextNoteGridIfDifferent(now, [])).toBeUndefined();
  });
});

describe("occurrenceNoteGridsForBox", () => {
  it("returns one layer per distinct visit of the same section", () => {
    const demo = {
      id: "demo",
      version: 1,
      title: "Demo",
      duration: 10,
      assets: [],
      tempoMap,
      sections: [
        { name: "COUNT", start: 0, end: 2 },
        { name: "ARA", start: 2, end: 4 },
        { name: "ARA", start: 4, end: 6 }
      ],
      chords: [
        { time: 2, text: "Dm", notes: [{ time: 2, pitch: 50 }] },
        { time: 4, text: "Dm", notes: [{ time: 5, pitch: 55 }] }
      ]
    };
    const layers = occurrenceNoteGridsForBox(demo, { name: "ARA", measure: 1 });
    expect(layers.map((layer) => layer.map((note) => note.lane))).toEqual([["D"], ["G"]]);
  });
});
