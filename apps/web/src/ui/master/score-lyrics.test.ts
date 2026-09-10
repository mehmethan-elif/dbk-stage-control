import { describe, expect, it } from "vitest";
import type { Section, Song, TempoPoint } from "@dbk/core";
import {
  activeScoreLyric,
  lyricCoveredHits,
  lyricDisplayLine,
  lyricTimeSpan,
  lyricVerseLines,
  scoreLyricPlacements,
  splitEvenly
} from "./score-lyrics";

const tempoMap: TempoPoint[] = [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }];

const sections: Section[] = [
  { name: "COUNT", start: 0, end: 2 },
  { name: "SAN 1", start: 2, end: 10 }
];

function song(): Song {
  return {
    id: "demo",
    version: 1,
    title: "Demo",
    duration: 10,
    assets: [],
    tempoMap,
    sections,
    lyrics: [
      {
        time: 2,
        end: 6,
        measure: 2,
        text: "TARİHTE BELLİDİR NESLİMİN YAŞI\r\nOL NEBİ YOLUNDA NURLUDUR BAŞI"
      },
      {
        time: 6,
        end: 10,
        measure: 4,
        text: "ATEŞ YAĞDI TOPRAĞINA SERİLDİK\r\nYILMADIK CEPHEDE KANLA DERİLDİK\r\nŞEHADET SIRRINA ERENLERİZ BİZ"
      }
    ]
  };
}

describe("lyricVerseLines", () => {
  it("keeps each verse line separate", () => {
    expect(lyricVerseLines("A\r\nB\nC")).toEqual(["A", "B", "C"]);
    expect(lyricVerseLines("  only  ")).toEqual(["only"]);
  });
});

describe("lyricDisplayLine", () => {
  it("joins verse lines when a single string is needed", () => {
    expect(lyricDisplayLine("A\r\nB\nC")).toBe("A B C");
  });
});

describe("lyricTimeSpan", () => {
  it("uses the lyric end when it is present", () => {
    const demo = song();
    expect(lyricTimeSpan(demo, demo.lyrics![0]!, 0)).toEqual({ start: 2, end: 6 });
  });
});

describe("lyricCoveredHits", () => {
  it("covers the two SAN 1 measures a lyric spans", () => {
    expect(lyricCoveredHits(song(), 2, 6)).toEqual([
      { name: "SAN 1", measure: 1, sectionIndex: 1 },
      { name: "SAN 1", measure: 2, sectionIndex: 1 }
    ]);
  });

  it("covers both rall measures of a single lyric line", () => {
    const rall: Song = {
      ...song(),
      duration: 16,
      tempoMap: [
        { time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 },
        { time: 8, measure: 5, bpm: 60, numerator: -1, denominator: -1 }
      ],
      sections: [
        { name: "COUNT", start: 0, end: 2 },
        { name: "NAK", start: 2, end: 16 }
      ]
    };
    expect(lyricCoveredHits(rall, 8, 16)).toEqual([
      { name: "NAK", measure: 4, sectionIndex: 1 },
      { name: "NAK", measure: 5, sectionIndex: 1 }
    ]);
  });
});

describe("splitEvenly", () => {
  it("gives two measures to each of two verse lines", () => {
    expect(splitEvenly([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4]
    ]);
  });

  it("puts the extra bar on the last line", () => {
    expect(splitEvenly([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2],
      [3, 4, 5]
    ]);
  });
});

describe("scoreLyricPlacements", () => {
  const rects = [
    { id: "a", name: "SAN 1", measure: 1, page: 0, x: 0.1, y: 0.2, w: 0.18, h: 0.06 },
    { id: "b", name: "SAN 1", measure: 2, page: 0, x: 0.3, y: 0.2, w: 0.2, h: 0.06 },
    { id: "c", name: "SAN 1", measure: 3, page: 0, x: 0.12, y: 0.4, w: 0.16, h: 0.06 },
    { id: "d", name: "SAN 1", measure: 4, page: 0, x: 0.3, y: 0.4, w: 0.19, h: 0.06 }
  ];

  it("places each verse line under its own measures with those widths", () => {
    const fourBar: Song = {
      ...song(),
      duration: 10,
      sections: [
        { name: "COUNT", start: 0, end: 2 },
        { name: "SAN 1", start: 2, end: 10 }
      ],
      lyrics: [
        {
          time: 2,
          end: 10,
          measure: 2,
          text: "TARİHTE BELLİDİR NESLİMİN YAŞI\r\nOL NEBİ YOLUNDA NURLUDUR BAŞI"
        }
      ]
    };
    expect(scoreLyricPlacements(fourBar, rects)).toEqual([
      expect.objectContaining({
        text: "TARİHTE BELLİDİR NESLİMİN YAŞI",
        page: 0,
        x: 0.1,
        y: 0.26,
        w: 0.38
      }),
      expect.objectContaining({
        text: "OL NEBİ YOLUNDA NURLUDUR BAŞI",
        page: 0,
        x: 0.12,
        y: 0.46,
        w: 0.35
      })
    ]);
  });

  it("keeps a wrapping verse line on the staff of its own measures", () => {
    const wrapping: Song = {
      ...song(),
      lyrics: [
        {
          time: 4,
          end: 8,
          measure: 3,
          text: "LINE ONE\r\nLINE TWO"
        }
      ]
    };
    expect(scoreLyricPlacements(wrapping, rects)).toEqual([
      expect.objectContaining({
        text: "LINE ONE",
        x: 0.3,
        y: 0.26,
        w: 0.2
      }),
      expect.objectContaining({
        text: "LINE TWO",
        x: 0.12,
        y: 0.46,
        w: 0.16
      })
    ]);
  });

  it("keeps a later pass so the current measure can show that line", () => {
    const repeated: Song = {
      ...song(),
      sections: [...sections, { name: "SAN 1", start: 10, end: 18 }],
      duration: 18,
      lyrics: [
        {
          time: 2,
          end: 10,
          measure: 2,
          text: "FIRST\r\nSECOND"
        },
        {
          time: 10,
          end: 18,
          measure: 6,
          text: "SECOND PASS\r\nOTHER WORDS"
        }
      ]
    };
    const lines = scoreLyricPlacements(repeated, rects);
    expect(activeScoreLyric(lines, 1)).toBeUndefined();
    expect(activeScoreLyric(lines, 3)?.text).toBe("FIRST");
    expect(activeScoreLyric(lines, 8)?.text).toBe("SECOND");
    expect(activeScoreLyric(lines, 12)?.text).toBe("SECOND PASS");
  });
});
