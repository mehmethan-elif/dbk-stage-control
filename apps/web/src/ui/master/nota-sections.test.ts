import { describe, expect, it } from "vitest";
import { measureStartTimes, normalizeSong, type Section, type Song, type TempoPoint } from "@dbk/core";
import {
  clearNotaLayoutMemory,
  loadNotaLayout,
  losesMeasureLayout,
  peekNotaLayout,
  preferNotaLayout,
  rememberNotaLayout,
  addNotaBox,
  FIRST_NOTA_RECT_HEIGHT_PX,
  FIRST_NOTA_RECT_WIDTH_PX,
  applyChainedRectGeometry,
  ensureSectionLabels,
  shouldPersistNotaLayout,
  hasSectionLabel,
  isSectionLabel,
  sectionLabelText,
  boxAbsoluteMeasure,
  boxBesidePrevious,
  boxForOccurrence,
  breakMeasureChain,
  canChainMeasure,
  correspondingMeasures,
  effectiveBrokenChains,
  editableNotaSectionNames,
  editableNotaSections,
  isFirstNamedSection,
  isMeasureChained,
  linkMeasureChain,
  mergeNotaRects,
  nextEmptySectionMeasure,
  measureRectsForSection,
  nextNotaHit,
  nextNotaSectionHit,
  notaHitAt,
  notaSectionHitAt,
  notaSectionScrollTargets,
  nowLooksAheadHit,
  parseBrokenChains,
  parseNotaSections,
  rectsForHit,
  rectsForLiveSections,
  rectsForSectionOccurrence,
  sameSectionName,
  sectionEditLabel,
  sectionMeasureNumbers,
  touchedNotaNames,
  uniqueSectionNames
} from "./nota-sections";

const tempoMap: TempoPoint[] = [
  { time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }
];

const sections: Section[] = [
  { name: "COUNT", start: 0, end: 2 },
  { name: "ARA", start: 2, end: 6 },
  { name: "SAN", start: 6, end: 10 },
  { name: "ARA", start: 10, end: 14 }
];

function song(): Song {
  return {
    id: "demo",
    version: 1,
    title: "Demo",
    duration: 14,
    assets: [],
    tempoMap,
    sections
  };
}

describe("editableNotaSections", () => {
  it("lists every section except COUNT, including repeats", () => {
    expect(uniqueSectionNames(sections)).toEqual(["COUNT", "ARA", "SAN"]);
    expect(editableNotaSectionNames(sections)).toEqual(["ARA", "SAN"]);
    expect(editableNotaSections(sections)).toEqual([
      { index: 1, name: "ARA", label: "ARA(1)" },
      { index: 2, name: "SAN", label: "SAN" },
      { index: 3, name: "ARA", label: "ARA(2)" }
    ]);
    expect(isFirstNamedSection(sections, 1)).toBe(true);
    expect(isFirstNamedSection(sections, 3)).toBe(false);
  });

  it("treats SAN, SAN A, SAN B, SAN 1, and SAN 2 as different section names", () => {
    const named: Section[] = [
      { name: "SAN A", start: 0, end: 4 },
      { name: "SAN B", start: 4, end: 8 },
      { name: "SAN", start: 8, end: 12 },
      { name: "SAN 1", start: 12, end: 16 },
      { name: "SAN 2", start: 16, end: 20 },
      { name: "ARA 1", start: 20, end: 24 },
      { name: "ARA 2", start: 24, end: 28 },
      { name: "SAN A", start: 28, end: 32 }
    ];
    expect(named.map((_, index) => sectionEditLabel(named, index))).toEqual([
      "SAN A(1)",
      "SAN B",
      "SAN",
      "SAN 1",
      "SAN 2",
      "ARA 1",
      "ARA 2",
      "SAN A(2)"
    ]);
    expect(sameSectionName("SAN", "SAN A")).toBe(false);
    expect(sameSectionName("SAN A", "SAN B")).toBe(false);
    expect(sameSectionName("SAN 1", "SAN 2")).toBe(false);
    expect(sameSectionName("ARA 1", "ARA 2")).toBe(false);
    expect(sameSectionName("SAN A", "SAN A")).toBe(true);
    expect(editableNotaSectionNames(named)).toEqual([
      "SAN A",
      "SAN B",
      "SAN",
      "SAN 1",
      "SAN 2",
      "ARA 1",
      "ARA 2"
    ]);
  });

  it("reuses chained SAN A rects for a later SAN A, not SAN B", () => {
    const form: Section[] = [
      { name: "SAN A", start: 0, end: 4 },
      { name: "SAN B", start: 4, end: 8 },
      { name: "SAN A", start: 8, end: 12 }
    ];
    const rects = [
      { id: "a1", name: "SAN A", measure: 1, page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
      { id: "b1", name: "SAN B", measure: 1, page: 0, x: 0.1, y: 0.4, w: 0.2, h: 0.1 }
    ];
    expect(rectsForHit(rects, { name: "SAN A", measure: 1, sectionIndex: 0 }).map((box) => box.id)).toEqual([
      "a1"
    ]);
    expect(rectsForHit(rects, { name: "SAN A", measure: 1, sectionIndex: 2 }).map((box) => box.id)).toEqual([
      "a1"
    ]);
    expect(rectsForHit(rects, { name: "SAN B", measure: 1, sectionIndex: 1 }).map((box) => box.id)).toEqual([
      "b1"
    ]);
    expect(canChainMeasure(form, "SAN A")).toBe(true);
    expect(canChainMeasure(form, "SAN B")).toBe(false);
    expect(ensureSectionLabels(rects, form, 0)?.filter(isSectionLabel).map((box) => box.name)).toEqual([
      "SAN A",
      "SAN B"
    ]);
  });
});

describe("sectionMeasureNumbers", () => {
  it("numbers each section from 1 through its own length", () => {
    expect(sectionMeasureNumbers(sections, tempoMap, "ARA")).toEqual([1, 2]);
    expect(sectionMeasureNumbers(sections, tempoMap, "SAN")).toEqual([1, 2]);
    expect(sectionMeasureNumbers(sections, tempoMap, "COUNT")).toEqual([1]);
  });

  it("does not pick up a neighbor bar when section times sit on 132 BPM boundaries", () => {
    const bizMap: TempoPoint[] = [
      { time: 0, measure: 1, bpm: 132, numerator: 4, denominator: 4 }
    ];
    const bizSections: Section[] = [
      { name: "COUNT", start: 0, end: 1.818182 },
      { name: "ARA", start: 1.818182, end: 16.363636 },
      { name: "ARA", start: 16.363636, end: 30.909091 },
      { name: "SAN", start: 30.909091, end: 56.363636 }
    ];
    expect(sectionMeasureNumbers(bizSections, bizMap, "ARA")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sectionMeasureNumbers(bizSections, bizMap, "SAN")).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
    ]);
  });
});

describe("boxAbsoluteMeasure", () => {
  it("maps a section-local box to the first occurrence's tempo-map measure", () => {
    expect(boxAbsoluteMeasure(song(), { name: "ARA", measure: 1 })).toBe(2);
    expect(boxAbsoluteMeasure(song(), { name: "ARA", measure: 2 })).toBe(3);
    expect(boxAbsoluteMeasure(song(), { name: "SAN", measure: 1 })).toBe(4);
    expect(boxAbsoluteMeasure(song(), { name: "MISSING", measure: 1 })).toBeUndefined();
  });

  it("maps an unchained box to that occurrence", () => {
    expect(boxAbsoluteMeasure(song(), { name: "ARA", measure: 1, sectionIndex: 3 })).toBe(6);
  });
});

describe("measure chain", () => {
  it("lists corresponding absolute measures for the same-named section", () => {
    expect(correspondingMeasures(song(), "ARA", 1)).toEqual([2, 6]);
    expect(correspondingMeasures(song(), "ARA", 2)).toEqual([3, 7]);
    expect(canChainMeasure(sections, "ARA")).toBe(true);
    expect(canChainMeasure(sections, "SAN")).toBe(false);
  });

  it("defaults to chained and records broken name-measure pairs", () => {
    expect(isMeasureChained([], "ARA", 1)).toBe(true);
    expect(isMeasureChained([{ name: "ARA", measure: 1 }], "ARA", 1)).toBe(false);
    expect(isMeasureChained([{ name: "ARA", measure: 1 }], "ARA", 2)).toBe(true);
    expect(
      effectiveBrokenChains([], [{ name: "ARA", measure: 1 }, { name: "ARA", measure: 2 }])
    ).toEqual([]);
    expect(
      effectiveBrokenChains(
        [{ id: "a", name: "ARA", measure: 2, page: 0, x: 0, y: 0, w: 0.2, h: 0.1 }],
        [{ name: "ARA", measure: 1 }, { name: "ARA", measure: 2 }]
      )
    ).toEqual([{ name: "ARA", measure: 2 }]);
    expect(parseBrokenChains({ brokenChains: [{ name: "ARA", measure: 1 }, { name: "ARA" }] })).toEqual([
      { name: "ARA", measure: 1 }
    ]);
  });

  it("clones a shared rect onto each occurrence when the chain breaks", () => {
    const shared = {
      id: "a",
      name: "ARA",
      measure: 1,
      page: 0,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.1
    };
    const broken = breakMeasureChain([shared], sections, "ARA", 1);
    expect(broken).toHaveLength(2);
    expect(broken.map((box) => box.sectionIndex)).toEqual([1, 3]);
    expect(broken[0]?.id).toBe("a");
    expect(broken[1]?.id).not.toBe("a");
    expect(broken[0]).toMatchObject({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
    expect(broken[1]).toMatchObject({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
  });

  it("moves every same-measure rect together while chained", () => {
    const first = {
      id: "a",
      name: "ARA",
      measure: 1,
      page: 0,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.1,
      sectionIndex: 1
    };
    const second = { ...first, id: "b", x: 0.4, sectionIndex: 3 };
    const moved = applyChainedRectGeometry([first, second], { ...first, x: 0.25, w: 0.18 });
    expect(moved).toEqual([
      { ...first, x: 0.25, w: 0.18 },
      { ...second, x: 0.25, w: 0.18 }
    ]);
  });

  it("keeps the current occurrence rect when the chain is restored", () => {
    const first = {
      id: "a",
      name: "ARA",
      measure: 1,
      page: 0,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.1,
      sectionIndex: 1
    };
    const second = {
      ...first,
      id: "b",
      x: 0.4,
      sectionIndex: 3
    };
    const linked = linkMeasureChain([first, second], sections, "ARA", 1, 3);
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ id: "b", x: 0.4 });
    expect(linked[0]?.sectionIndex).toBeUndefined();
  });

  it("finds the shared or occurrence box for the selected section", () => {
    const shared = {
      id: "a",
      name: "ARA",
      measure: 1,
      page: 0,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.1
    };
    expect(boxForOccurrence([shared], "ARA", 1, 3, true)?.id).toBe("a");
    expect(
      boxForOccurrence([{ ...shared, sectionIndex: 3 }], "ARA", 1, 3, false)?.sectionIndex
    ).toBe(3);
  });

  it("keeps only the selected section occurrence's rects", () => {
    const first = {
      id: "a1",
      name: "ARA",
      measure: 1,
      page: 0,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.1
    };
    const firstTwo = { ...first, id: "a2", measure: 2, x: 0.4 };
    const san = { ...first, id: "s1", name: "SAN", x: 0.1, y: 0.4 };
    const laterUnchained = { ...first, id: "a3", sectionIndex: 3, y: 0.7 };
    const rects = [first, firstTwo, san, laterUnchained];

    expect(rectsForSectionOccurrence(rects, "ARA", 1).map((box) => box.id)).toEqual([
      "a1",
      "a2"
    ]);
    expect(rectsForSectionOccurrence(rects, "SAN", 2).map((box) => box.id)).toEqual(["s1"]);
    expect(
      rectsForSectionOccurrence(rects, "ARA", 3, [{ name: "ARA", measure: 1 }]).map(
        (box) => box.id
      )
    ).toEqual(["a2", "a3"]);
  });
});

describe("nota play hits", () => {
  it("skips COUNT and reports the measure inside the current section", () => {
    expect(notaHitAt(song(), 0.5)).toBeUndefined();
    expect(notaHitAt(song(), 2.1)).toEqual({ name: "ARA", measure: 1, sectionIndex: 1 });
    expect(notaHitAt(song(), 4.1)).toEqual({ name: "ARA", measure: 2, sectionIndex: 1 });
    expect(notaHitAt(song(), 11)).toEqual({ name: "ARA", measure: 1, sectionIndex: 3 });
  });

  it("points next at the following measure inside that section", () => {
    expect(nextNotaHit(song(), 0.5)).toEqual({ name: "ARA", measure: 1, sectionIndex: 1 });
    expect(nextNotaHit(song(), 2.1)).toEqual({ name: "ARA", measure: 2, sectionIndex: 1 });
    expect(nextNotaHit(song(), 5.1)).toEqual({ name: "SAN", measure: 1, sectionIndex: 2 });
    expect(nextNotaHit(song(), 13.5)).toBeUndefined();
  });

  it("keeps COUNT look-ahead on the first ARA measure until COUNT ends", () => {
    expect(nextNotaHit(song(), 1.99)).toEqual({ name: "ARA", measure: 1, sectionIndex: 1 });
    expect(nowLooksAheadHit(song(), 1.99)).toEqual({ name: "ARA", measure: 1, sectionIndex: 1 });
    expect(notaHitAt(song(), 1.99)).toBeUndefined();
  });

  it("treats COUNT as any number of measures and still looks ahead to ARA", () => {
    const twoBars: Song = {
      ...song(),
      duration: 16,
      sections: [
        { name: "COUNT", start: 0, end: 4 },
        { name: "ARA", start: 4, end: 8 },
        { name: "SAN", start: 8, end: 12 },
        { name: "ARA", start: 12, end: 16 }
      ]
    };
    expect(sectionMeasureNumbers(twoBars.sections, twoBars.tempoMap, "COUNT")).toEqual([1, 2]);
    expect(notaHitAt(twoBars, 0.5)).toBeUndefined();
    expect(notaHitAt(twoBars, 2.5)).toBeUndefined();
    expect(notaSectionHitAt(twoBars, 2.5)).toEqual({ name: "COUNT", measure: 2, sectionIndex: 0 });
    expect(nextNotaHit(twoBars, 0.5)).toEqual({ name: "ARA", measure: 1, sectionIndex: 1 });
    expect(nextNotaHit(twoBars, 2.5)).toEqual({ name: "ARA", measure: 1, sectionIndex: 1 });
    expect(nowLooksAheadHit(twoBars, 0.5)).toEqual({ name: "ARA", measure: 1, sectionIndex: 1 });

    const threeBars: Song = {
      ...twoBars,
      duration: 18,
      sections: [
        { name: "COUNT", start: 0, end: 6 },
        { name: "ARA", start: 6, end: 10 },
        { name: "SAN", start: 10, end: 14 },
        { name: "ARA", start: 14, end: 18 }
      ]
    };
    expect(sectionMeasureNumbers(threeBars.sections, threeBars.tempoMap, "COUNT")).toEqual([1, 2, 3]);
    expect(nextNotaHit(threeBars, 3.5)).toEqual({ name: "ARA", measure: 1, sectionIndex: 1 });
  });

  it("shows the next Now rect only when it is the first measure of a section", () => {
    expect(nowLooksAheadHit(song(), 0.5)).toEqual({ name: "ARA", measure: 1, sectionIndex: 1 });
    expect(nowLooksAheadHit(song(), 2.1)).toBeUndefined();
    expect(nowLooksAheadHit(song(), 4.1)).toEqual({ name: "SAN", measure: 1, sectionIndex: 2 });
    expect(nowLooksAheadHit(song(), 6.1)).toBeUndefined();
    expect(nowLooksAheadHit(song(), 8.1)).toEqual({ name: "ARA", measure: 1, sectionIndex: 3 });
  });

  it("shows the next rect when that next measure is unchained", () => {
    const broken = [{ name: "ARA", measure: 2 }];
    expect(nowLooksAheadHit(song(), 2.1, broken)).toEqual({
      name: "ARA",
      measure: 2,
      sectionIndex: 1
    });
    expect(nowLooksAheadHit(song(), 2.1)).toBeUndefined();
    expect(nowLooksAheadHit(song(), 6.1, [{ name: "SAN", measure: 2 }])).toEqual({
      name: "SAN",
      measure: 2,
      sectionIndex: 2
    });
  });

  it("names the current section and the following section for auto-scroll", () => {
    expect(notaSectionHitAt(song(), 0.5)).toEqual({ name: "COUNT", measure: 1, sectionIndex: 0 });
    expect(nextNotaSectionHit(song(), 0.5)).toEqual({ name: "ARA", measure: 1, sectionIndex: 1 });
    expect(nextNotaSectionHit(song(), 2.1)).toEqual({ name: "SAN", measure: 1, sectionIndex: 2 });
    expect(nextNotaSectionHit(song(), 11)).toBeUndefined();
  });

  it("keeps Karahisar late-section first bars on measure 1", () => {
    const kara: Song = {
      ...song(),
      duration: 188,
      tempoMap: [{ time: 0, measure: 1, bpm: 114, numerator: 4, denominator: 4 }],
      sections: [
        { name: "COUNT", start: 0, end: 2.105092 },
        { name: "ARA", start: 94.736842, end: 122.105434 },
        { name: "SAN A", start: 122.105434, end: 138.94754 },
        { name: "SAN B", start: 138.94754, end: 160.000171 },
        { name: "NAK", start: 160.000171, end: 188.144107 }
      ]
    };
    const starts = measureStartTimes(kara.tempoMap, 188);
    const near = (time: number) =>
      starts.reduce((best, start) =>
        Math.abs(start - time) < Math.abs(best - time) ? start : best
      );
    expect(notaHitAt(kara, near(122.105434))).toMatchObject({ name: "SAN A", measure: 1 });
    expect(notaHitAt(kara, near(138.94754))).toMatchObject({ name: "SAN B", measure: 1 });
    expect(notaHitAt(kara, near(160.000171))).toMatchObject({ name: "NAK", measure: 1 });
  });

  it("keeps those first bars on measure 1 after load-time barline snap", () => {
    const kara = normalizeSong({
      ...song(),
      duration: 188,
      tempoMap: [{ time: 0, measure: 1, bpm: 114, numerator: 4, denominator: 4 }],
      sections: [
        { name: "COUNT", start: 0, end: 2.105092 },
        { name: "ARA", start: 94.736842, end: 122.105434 },
        { name: "SAN A", start: 122.105434, end: 138.94754 },
        { name: "SAN B", start: 138.94754, end: 160.000171 },
        { name: "NAK", start: 160.000171, end: 188.144107 }
      ]
    });
    const starts = measureStartTimes(kara.tempoMap, 188);
    const near = (time: number) =>
      starts.reduce((best, start) =>
        Math.abs(start - time) < Math.abs(best - time) ? start : best
      );
    expect(notaHitAt(kara, near(122.105434))).toMatchObject({ name: "SAN A", measure: 1 });
    expect(notaHitAt(kara, near(138.94754))).toMatchObject({ name: "SAN B", measure: 1 });
    expect(notaHitAt(kara, near(160.000171))).toMatchObject({ name: "NAK", measure: 1 });
  });
});

describe("notaSectionScrollTargets", () => {
  const tunaMap: TempoPoint[] = [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }];
  const tuna: Song = {
    id: "tuna",
    version: 1,
    title: "Tuna",
    duration: 24,
    assets: [],
    tempoMap: tunaMap,
    sections: [
      { name: "COUNT", start: 0, end: 2 },
      { name: "NAK 2", start: 2, end: 12 },
      { name: "ARA 1", start: 12, end: 22 }
    ]
  };
  const rects = [
    { id: "n4", name: "NAK 2", measure: 4, page: 0, x: 0.56, y: 0.62, w: 0.15, h: 0.08 },
    { id: "n5", name: "NAK 2", measure: 5, page: 0, x: 0.71, y: 0.62, w: 0.22, h: 0.08 },
    { id: "a1", name: "ARA 1", measure: 1, page: 0, x: 0.09, y: 0.07, w: 0.18, h: 0.08 },
    { id: "a2", name: "ARA 1", measure: 2, page: 0, x: 0.28, y: 0.07, w: 0.15, h: 0.08 }
  ];

  it("keeps the next target on the same line before the last NAK 2 measure", () => {
    const targets = notaSectionScrollTargets(tuna, 8.1, rects);
    expect(targets.current.map((box) => box.id)).toEqual(["n4"]);
    expect(targets.next.map((box) => box.id)).toEqual(["n5"]);
  });

  it("points at ARA 1 on the last NAK 2 measure so auto-scroll can wrap to the top", () => {
    const targets = notaSectionScrollTargets(tuna, 10.1, rects);
    expect(targets.current.map((box) => box.id)).toEqual(["n5"]);
    expect(targets.next.map((box) => box.id)).toEqual(["a1"]);
  });

  it("keeps an unchained next measure on that rect instead of the next section", () => {
    const targets = notaSectionScrollTargets(tuna, 8.1, rects, [{ name: "NAK 2", measure: 5 }]);
    expect(targets.current.map((box) => box.id)).toEqual(["n4"]);
    expect(targets.next.map((box) => box.id)).toEqual(["n5"]);
  });
});

describe("measureRectsForSection", () => {
  const rects = [
    { id: "lab", name: "ARA", measure: 0, kind: "label" as const, page: 0, x: 0, y: 0, w: 0.1, h: 0.02 },
    { id: "a1", name: "ARA", measure: 1, page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1, sectionIndex: 1 },
    { id: "a2", name: "ARA", measure: 2, page: 0, x: 0.4, y: 0.1, w: 0.2, h: 0.1, sectionIndex: 1 },
    { id: "a3", name: "ARA", measure: 1, page: 0, x: 0.1, y: 0.5, w: 0.2, h: 0.1, sectionIndex: 3 }
  ];

  it("returns every measure box for that section occurrence, not labels", () => {
    expect(
      measureRectsForSection(rects, { name: "ARA", measure: 1, sectionIndex: 1 }).map((box) => box.id)
    ).toEqual(["a1", "a2"]);
  });
});

describe("rectsForHit", () => {
  const rects = [
    { id: "a", name: "ARA", measure: 1, page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
    { id: "b", name: "ARA", measure: 2, page: 0, x: 0.4, y: 0.1, w: 0.2, h: 0.1 },
    { id: "legacy", name: "SAN", measure: 0, page: 0, x: 0.1, y: 0.4, w: 0.2, h: 0.1 }
  ];

  it("prefers the exact section and measure", () => {
    expect(
      rectsForHit(rects, { name: "ARA", measure: 1, sectionIndex: 1 }).map((box) => box.id)
    ).toEqual(["a"]);
  });

  it("uses the occurrence box when that measure is unchained", () => {
    const unchained = [
      { ...rects[0], id: "first", sectionIndex: 1 },
      { ...rects[0], id: "second", x: 0.5, sectionIndex: 3 }
    ];
    expect(
      rectsForHit(unchained, { name: "ARA", measure: 1, sectionIndex: 3 }, [
        { name: "ARA", measure: 1 }
      ]).map((box) => box.id)
    ).toEqual(["second"]);
  });

  it("falls back to name-only legacy boxes", () => {
    expect(
      rectsForHit(rects, { name: "SAN", measure: 4, sectionIndex: 2 }).map((box) => box.id)
    ).toEqual(["legacy"]);
  });
});

describe("one rect per measure", () => {
  const previous = {
    id: "a",
    name: "ARA",
    measure: 1,
    page: 0,
    x: 0.1,
    y: 0.2,
    w: 0.25,
    h: 0.12
  };

  it("fills the selected empty measure, then the next empty one", () => {
    expect(nextEmptySectionMeasure([1, 2, 3], [], "ARA", 1)).toBe(1);
    expect(nextEmptySectionMeasure([1, 2, 3], [previous], "ARA", 1)).toBe(2);
    expect(nextEmptySectionMeasure([1, 2, 3], [previous], "ARA", 2)).toBe(2);
  });

  it("places the next rect at the same size immediately to the right", () => {
    expect(boxBesidePrevious(previous)).toEqual({
      page: 0,
      x: 0.35,
      y: 0.2,
      w: 0.25,
      h: 0.12
    });
  });

  it("wraps to the next row when the page edge is reached", () => {
    expect(boxBesidePrevious({ ...previous, x: 0.8, w: 0.25 }, [previous])).toEqual({
      page: 0,
      x: 0.1,
      y: 0.32,
      w: 0.25,
      h: 0.12
    });
  });

  it("refuses a second rect for the same section measure", () => {
    const added = addNotaBox([previous], "ARA", 1, 0);
    expect(added).toBeUndefined();
    const next = addNotaBox([previous], "ARA", 2, 0);
    expect(next?.box).toMatchObject({
      name: "ARA",
      measure: 2,
      page: 0,
      x: 0.35,
      y: 0.2,
      w: 0.25,
      h: 0.12
    });
  });

  it("places the next rect beside an unchained previous measure", () => {
    const first = {
      id: "a1",
      name: "ARA",
      measure: 1,
      page: 0,
      x: 0.13,
      y: 0.05,
      w: 0.2,
      h: 0.14,
      sectionIndex: 1
    };
    const second = {
      ...first,
      id: "a2",
      measure: 2,
      x: 0.33
    };
    const broken = [
      { name: "ARA", measure: 1 },
      { name: "ARA", measure: 2 }
    ];
    const added = addNotaBox([first, second], "ARA", 3, 0, 0, 1, broken);
    expect(added?.box).toMatchObject({
      name: "ARA",
      measure: 3,
      page: 0,
      x: 0.53,
      y: 0.05,
      w: 0.2,
      h: 0.14
    });
    expect(added?.box.sectionIndex).toBeUndefined();
  });

  it("starts a new section on the visible page instead of beside another section", () => {
    const added = addNotaBox([previous], "FINAL", 1, 0);
    expect(added?.box).toMatchObject({
      name: "FINAL",
      measure: 1,
      page: 0,
      x: 0.06,
      y: 0.08
    });
  });

  it("uses a 180 by 70 pixel default the first time a section gets a rect", () => {
    const page = { width: 900, height: 1000 };
    const added = addNotaBox([], "SAN 1", 1, 0, 0, 3, [], page);
    expect(added?.box).toMatchObject({
      name: "SAN 1",
      measure: 1,
      x: 0.06,
      y: 0.08,
      w: FIRST_NOTA_RECT_WIDTH_PX / page.width,
      h: FIRST_NOTA_RECT_HEIGHT_PX / page.height
    });
  });

  it("places the first section rect beside that section's label", () => {
    const page = { width: 900, height: 1000 };
    const label = {
      id: "label-ara",
      name: "ARA",
      measure: 0,
      kind: "label" as const,
      label: "ARA",
      page: 0,
      x: 0.04,
      y: 0.11,
      w: 0.05,
      h: 0.032
    };
    const added = addNotaBox([label], "ARA", 1, 0, 0, 1, [], page);
    expect(added?.box).toMatchObject({
      name: "ARA",
      measure: 1,
      page: 0,
      x: label.x + label.w + 8 / page.width,
      y: label.y,
      w: FIRST_NOTA_RECT_WIDTH_PX / page.width,
      h: FIRST_NOTA_RECT_HEIGHT_PX / page.height
    });
  });

  it("does not add a section-name label when adding a measure", () => {
    const added = addNotaBox([], "ARA", 1, 0);
    expect(added?.rects.filter(isSectionLabel)).toEqual([]);
  });

  it("adds missing section-name labels once when edit starts", () => {
    const first = ensureSectionLabels([], sections, 0);
    expect(first?.filter(isSectionLabel).map((box) => box.label)).toEqual(["ARA", "SAN"]);
    expect(ensureSectionLabels(first ?? [], sections, 0)).toBeUndefined();
    expect(hasSectionLabel(first ?? [], "ARA")).toBe(true);
  });

  it("places first-time labels to the left of each section's first measure", () => {
    const ara = {
      id: "a1",
      name: "ARA",
      measure: 1,
      page: 0,
      x: 0.2,
      y: 0.12,
      w: 0.2,
      h: 0.14
    };
    const san = {
      id: "s1",
      name: "SAN",
      measure: 1,
      page: 1,
      x: 0.36,
      y: 0.4,
      w: 0.2,
      h: 0.14
    };
    const next = ensureSectionLabels([ara, san], sections, 0);
    const labels = next?.filter(isSectionLabel) ?? [];
    const araLabel = labels.find((box) => box.name === "ARA");
    const sanLabel = labels.find((box) => box.name === "SAN");
    expect(araLabel).toMatchObject({ page: 0, y: 0.12 });
    expect(sanLabel).toMatchObject({ page: 1, y: 0.4 });
    expect(araLabel?.x ?? 1).toBeLessThan(ara.x);
    expect((araLabel?.x ?? 0) + (araLabel?.w ?? 0)).toBeLessThanOrEqual(ara.x);
    expect(sanLabel?.x ?? 1).toBeLessThan(san.x);
  });

  it("skips section names that already have a label", () => {
    const existing = [
      {
        id: "lab",
        name: "SAN",
        kind: "label" as const,
        label: "ŞAN",
        measure: 0,
        page: 0,
        x: 0.2,
        y: 0.3,
        w: 0.06,
        h: 0.03
      }
    ];
    const next = ensureSectionLabels(existing, sections, 0);
    expect(next?.filter(isSectionLabel).map((box) => box.name)).toEqual(["SAN", "ARA"]);
    expect(next?.find((box) => box.id === "lab")?.label).toBe("ŞAN");
  });

  it("drops labels for section names that are no longer in the song", () => {
    const leftover = {
      id: "old",
      name: "FINAL",
      kind: "label" as const,
      label: "FINAL",
      measure: 0,
      page: 0,
      x: 0.5,
      y: 0.7,
      w: 0.06,
      h: 0.03
    };
    const next = ensureSectionLabels([leftover], sections, 0);
    expect(next?.some((box) => box.name === "FINAL")).toBe(false);
    expect(next?.filter(isSectionLabel).map((box) => box.name)).toEqual(["ARA", "SAN"]);
    expect(shouldPersistNotaLayout(next ?? [], next ?? [])).toBe(false);
    expect(shouldPersistNotaLayout([leftover], next ?? [])).toBe(false);
  });

  it("keeps edited label text", () => {
    expect(sectionLabelText({ name: "ARA", label: "Ara 1" })).toBe("Ara 1");
    const parsed = parseNotaSections({
      rects: [
        {
          id: "lab",
          name: "SAN",
          kind: "label",
          label: "ŞAN",
          measure: 0,
          page: 0,
          x: 0.04,
          y: 0.4,
          w: 0.06,
          h: 0.03
        }
      ]
    });
    expect(parsed[0]).toMatchObject({ kind: "label", label: "ŞAN", name: "SAN" });
  });
});

describe("nota layout memory", () => {
  it("returns the last committed layout instead of rereading disk", async () => {
    clearNotaLayoutMemory();
    const rect = {
      id: "edit-1",
      name: "ARA",
      measure: 3,
      page: 0,
      x: 0.33,
      y: 0.2,
      w: 0.2,
      h: 0.1
    };
    rememberNotaLayout("song-mem", [rect], []);
    expect(peekNotaLayout("song-mem")?.rects).toEqual([rect]);
    await expect(loadNotaLayout("song-mem", [])).resolves.toEqual({
      rects: [rect],
      brokenChains: []
    });
    clearNotaLayoutMemory();
  });
});

describe("mergeNotaRects", () => {
  const ara = {
    id: "a",
    name: "ARA",
    measure: 1,
    page: 0,
    x: 0.1,
    y: 0.1,
    w: 0.2,
    h: 0.1
  };
  const san = {
    id: "s",
    name: "SAN",
    measure: 1,
    page: 0,
    x: 0.4,
    y: 0.1,
    w: 0.2,
    h: 0.1
  };

  it("keeps untouched sections when a later save is incomplete", () => {
    const merged = mergeNotaRects([ara, san], [{ ...ara, x: 0.2 }], new Set(["ARA"]));
    expect(merged.map((box) => box.name)).toEqual(["ARA", "SAN"]);
    expect(merged[0]?.x).toBe(0.2);
  });

  it("drops a section when the last rect of that name is removed", () => {
    expect(touchedNotaNames([ara, san], [ara])).toEqual(new Set(["ARA", "SAN"]));
    expect(mergeNotaRects([ara, san], [ara], new Set(["ARA", "SAN"])).map((box) => box.name)).toEqual([
      "ARA"
    ]);
  });

  it("does not let a label-only save wipe measure rects", () => {
    const label = {
      id: "lab",
      name: "ARA",
      measure: 0,
      kind: "label" as const,
      label: "ARA",
      page: 0,
      x: 0.04,
      y: 0.06,
      w: 0.04,
      h: 0.03
    };
    const merged = mergeNotaRects([ara, san], [label], new Set(["ARA", "SAN"]));
    expect(merged.some((box) => box.id === "a")).toBe(true);
    expect(merged.some((box) => box.id === "s")).toBe(true);
    expect(merged.some((box) => box.id === "lab")).toBe(true);
  });

  it("rescues other sections when one leftover measure remains", () => {
    const leftover = { ...ara, id: "crumb" };
    const labels = [
      {
        id: "lab-a",
        name: "ARA",
        measure: 0,
        kind: "label" as const,
        label: "ARA",
        page: 0,
        x: 0.04,
        y: 0.06,
        w: 0.04,
        h: 0.03
      },
      {
        id: "lab-s",
        name: "SAN",
        measure: 0,
        kind: "label" as const,
        label: "SAN",
        page: 0,
        x: 0.04,
        y: 0.12,
        w: 0.04,
        h: 0.03
      }
    ];
    const merged = mergeNotaRects([ara, san], [leftover, ...labels], new Set(["ARA", "SAN"]));
    expect(merged.some((box) => box.id === "s")).toBe(true);
    expect(merged.some((box) => box.name === "ARA" && !("kind" in box && box.kind === "label"))).toBe(
      true
    );
  });
});

describe("preferNotaLayout", () => {
  const measure = {
    id: "m",
    name: "ARA",
    measure: 1,
    page: 0,
    x: 0.1,
    y: 0.1,
    w: 0.2,
    h: 0.1
  };
  const label = {
    id: "lab",
    name: "ARA",
    kind: "label" as const,
    label: "ARA",
    measure: 0,
    page: 0,
    x: 0.04,
    y: 0.06,
    w: 0.04,
    h: 0.03
  };

  it("keeps in-memory edits when they have at least as many measures as disk", () => {
    const cached = { rects: [{ ...measure, x: 0.4 }], brokenChains: [] };
    expect(preferNotaLayout(cached, { rects: [measure], brokenChains: [] })).toBe(cached);
  });

  it("uses disk when the session cache is leftover crumbs", () => {
    const disk = {
      rects: [measure, { ...measure, id: "m2", measure: 2 }, { ...measure, id: "m3", measure: 3 }],
      brokenChains: []
    };
    const cached = { rects: [label, measure], brokenChains: [] };
    expect(preferNotaLayout(cached, disk)).toBe(disk);
  });
});

describe("losesMeasureLayout", () => {
  const measures = [1, 2, 3, 4].map((measure) => ({
    id: `m${measure}`,
    name: "ARA",
    measure,
    page: 0,
    x: 0.1,
    y: 0.1,
    w: 0.2,
    h: 0.1
  }));
  const label = {
    id: "lab",
    name: "ARA",
    kind: "label" as const,
    label: "ARA",
    measure: 0,
    page: 0,
    x: 0.04,
    y: 0.06,
    w: 0.04,
    h: 0.03
  };

  it("blocks label-only and leftover-crumb overwrites", () => {
    expect(losesMeasureLayout(measures, [label])).toBe(true);
    expect(losesMeasureLayout(measures, [label, measures[0]!])).toBe(true);
  });

  it("allows adding a label or deleting one measure", () => {
    expect(losesMeasureLayout(measures, [...measures, label])).toBe(false);
    expect(losesMeasureLayout(measures, measures.slice(1))).toBe(false);
  });
});

describe("rectsForLiveSections", () => {
  it("hides leftover boxes after a section is renamed away", () => {
    const leftover = {
      id: "old",
      name: "FINAL",
      kind: "label" as const,
      measure: 0,
      page: 0,
      x: 0.5,
      y: 0.7,
      w: 0.06,
      h: 0.03
    };
    const live = {
      id: "now",
      name: "CEV+ FINAL",
      kind: "label" as const,
      measure: 0,
      page: 0,
      x: 0.04,
      y: 0.2,
      w: 0.12,
      h: 0.03
    };
    expect(
      rectsForLiveSections(
        [leftover, live],
        [
          { name: "SAN", start: 0, end: 4 },
          { name: "CEV+ FINAL", start: 4, end: 8 }
        ]
      ).map((box) => box.name)
    ).toEqual(["CEV+ FINAL"]);
  });
});

describe("parseNotaSections", () => {
  it("keeps measure numbers and defaults missing ones to 0", () => {
    const parsed = parseNotaSections({
      rects: [
        { id: "m", name: "ARA", measure: 6, page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
        { id: "old", name: "SAN", page: 0, x: 0.3, y: 0.3, w: 0.2, h: 0.1 }
      ]
    });
    expect(parsed.map((box) => ({ id: box.id, measure: box.measure }))).toEqual([
      { id: "m", measure: 6 },
      { id: "old", measure: 0 }
    ]);
  });

  it("keeps unchained occurrence indexes when the name is already present", () => {
    const parsed = parseNotaSections({
      rects: [
        { id: "a", name: "ARA", measure: 1, page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1, sectionIndex: 1 },
        { id: "b", name: "ARA", measure: 1, page: 0, x: 0.4, y: 0.1, w: 0.2, h: 0.1, sectionIndex: 3 }
      ]
    });
    expect(parsed.map((box) => ({ id: box.id, sectionIndex: box.sectionIndex }))).toEqual([
      { id: "a", sectionIndex: 1 },
      { id: "b", sectionIndex: 3 }
    ]);
  });
});
