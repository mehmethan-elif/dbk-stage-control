import { describe, expect, it } from "vitest";
import type { Song } from "@dbk/core";
import { songTitleMetaParts } from "../stage-title-meta";
import { exportPdfFileName, isExportPdfName } from "./pdf-names";
import {
  exportCreditLine,
  fittedPageHeight,
  formatExportDate,
  pageNoteFor,
  PDF_BRAND,
  PDF_BRAND_NAME,
  PDF_BRAND_STAGE,
  SCORE_CHORD_CSS,
  SCORE_LABEL_CSS,
  scoreLabelScale
} from "./pdf-layout";

describe("exportPdfFileName", () => {
  it("uses the song title and target label", () => {
    expect(exportPdfFileName("Karahisar Kalesi", "lyrics")).toBe("Karahisar Kalesi - Lyrics.pdf");
    expect(exportPdfFileName("Biz", "chords")).toBe("Biz - Chords.pdf");
  });

  it("strips path characters from the title", () => {
    expect(exportPdfFileName("A/B:C", "drums")).toBe("A B C - Drums.pdf");
  });
});

describe("isExportPdfName", () => {
  it("accepts the export names", () => {
    expect(isExportPdfName("Biz - Lyrics.pdf")).toBe(true);
    expect(isExportPdfName("Biz - Chords.pdf")).toBe(true);
    expect(isExportPdfName("Nota.pdf")).toBe(false);
    expect(isExportPdfName("settings.json")).toBe(false);
  });
});

describe("pdf header infos", () => {
  it("includes kita before time signature, same as page titles", () => {
    const song = {
      id: "biz",
      version: 1,
      title: "Biz",
      duration: 180,
      key: "D",
      scale: "MINOR",
      style: "BESTE",
      kita: 2,
      assets: [],
      tempoMap: [{ time: 0, measure: 1, bpm: 132, numerator: 4, denominator: 4 }],
      sections: []
    } as Song;
    expect(songTitleMetaParts(song)).toEqual(["D MINOR", "BESTE", "KITA 2", "4/4", "132 BPM"]);
  });

  it("reads kita from song.info when the root field is missing", () => {
    const song = {
      id: "biz",
      version: 1,
      title: "Biz",
      duration: 180,
      assets: [],
      tempoMap: [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }],
      sections: [],
      info: { bpm: 120, numerator: 4, denominator: 4, kita: 7 }
    } as Song;
    expect(songTitleMetaParts(song)).toContain("KITA 7");
  });
});

describe("page notes and credit", () => {
  it("maps chords to the chord page note", () => {
    expect(pageNoteFor({ lyrics: "sing", chord: "capo 2" }, "chords")).toBe("capo 2");
    expect(pageNoteFor({ score: "ds al coda" }, "score")).toBe("ds al coda");
    expect(pageNoteFor({}, "drums")).toBe("");
  });

  it("formats the creator line", () => {
    expect(formatExportDate(new Date(2026, 8, 11))).toBe("11.09.2026");
    expect(exportCreditLine(new Date(2026, 8, 11))).toBe("created by Mehmethan Dişbudak, 11.09.2026");
  });

  it("keeps brand parts for the one-row footer", () => {
    expect(PDF_BRAND_STAGE).toBe("DBK STAGE");
    expect(PDF_BRAND_NAME).toBe("ELİF AVCI");
    expect(PDF_BRAND).toBe("DBK STAGE - ELİF AVCI");
  });

  it("sizes a page to the footer under the content", () => {
    expect(fittedPageHeight(100)).toBe(32 + 10 + 100 + 28);
  });

  it("scales chord names from the on-screen 16px size", () => {
    expect(SCORE_CHORD_CSS.font * scoreLabelScale(612, SCORE_LABEL_CSS.refWidth)).toBeCloseTo(10.62, 1);
  });

  it("scales section labels from the on-screen 13px chips", () => {
    const px = scoreLabelScale(612, SCORE_LABEL_CSS.refWidth);
    expect(SCORE_LABEL_CSS.font * px).toBeCloseTo(8.63, 1);
    expect((SCORE_LABEL_CSS.font * SCORE_LABEL_CSS.line + SCORE_LABEL_CSS.padY * 2) * px).toBeCloseTo(
      12.6,
      1
    );
  });
});
