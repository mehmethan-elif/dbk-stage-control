import fontkitImport from "@pdf-lib/fontkit";
import { parseSongInfo, songDisplayName, type Song } from "@dbk/core";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { displayChordText, rectChordLane, uniqueChordLabelBoxes } from "../chord-notes";
import { lyricBlocks, stageRows } from "../lyric-rows";
import { isSectionLabel, sectionLabelText, type NotaSectionBox } from "../nota-sections";
import { songTitleMetaParts } from "../stage-title-meta";
import { captureDrumChartPng } from "./capture-drum";
import {
  chromeHeights,
  exportCreditLine,
  fittedPageHeight,
  pageNoteFor,
  PDF_BLUE,
  PDF_BRAND,
  PDF_BRAND_NAME,
  PDF_BRAND_STAGE,
  PDF_FOOTER_H,
  PDF_GAP,
  PDF_HEADER_H,
  PDF_NOTE_H,
  PDF_INK,
  PDF_ORANGE,
  PDF_PAGE_BG,
  PDF_TEXT,
  SCORE_CHORD_CSS,
  SCORE_LABEL_CSS,
  liveScoreCssWidth,
  scoreLabelScale,
  sectionTone
} from "./pdf-layout";
import { type PdfExportTarget } from "./pdf-names";
import regularUrl from "./fonts/NotoSans-Regular.ttf?url";
import boldUrl from "./fonts/NotoSans-Bold.ttf?url";

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 28;

type Color = { r: number; g: number; b: number };

function toRgb(color: Color): RGB {
  return rgb(color.r, color.g, color.b);
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0] ?? "";
  for (const word of words.slice(1)) {
    const next = `${current} ${word}`;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

let fontBytes: { regular: ArrayBuffer; bold: ArrayBuffer } | undefined;

async function loadFontBytes(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  if (fontBytes) return fontBytes;
  const [regular, bold] = await Promise.all([
    fetch(regularUrl).then((response) => response.arrayBuffer()),
    fetch(boldUrl).then((response) => response.arrayBuffer())
  ]);
  fontBytes = { regular, bold };
  return fontBytes;
}

async function embedFonts(pdf: PDFDocument): Promise<{ regular: PDFFont; bold: PDFFont }> {
  const fontkit =
    typeof (fontkitImport as { create?: unknown }).create === "function"
      ? fontkitImport
      : (fontkitImport as { default: typeof fontkitImport }).default;
  pdf.registerFontkit(fontkit);
  const bytes = await loadFontBytes();
  return {
    regular: await pdf.embedFont(bytes.regular, { subset: true }),
    bold: await pdf.embedFont(bytes.bold, { subset: true })
  };
}

function drawChrome(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  title: string,
  infos: string[],
  note: string,
  date: Date
): void {
  const { width, height } = page.getSize();
  const headerY = height - PDF_HEADER_H;
  page.drawRectangle({
    x: 0,
    y: headerY,
    width,
    height: PDF_HEADER_H,
    color: toRgb(PDF_ORANGE)
  });
  const titleSize = 13;
  const pad = 12;
  page.drawText(title, {
    x: pad,
    y: headerY + (PDF_HEADER_H - titleSize) / 2 + 1,
    size: titleSize,
    font: fonts.bold,
    color: toRgb(PDF_INK)
  });
  if (infos.length > 0) {
    const info = infos.join("  ·  ");
    const titleW = fonts.bold.widthOfTextAtSize(title, titleSize);
    const infoMax = Math.max(80, width - pad * 2 - titleW - 16);
    let infoSize = 8;
    while (infoSize > 6 && fonts.regular.widthOfTextAtSize(info, infoSize) > infoMax) {
      infoSize -= 0.4;
    }
    const infoWidth = Math.min(infoMax, fonts.regular.widthOfTextAtSize(info, infoSize));
    page.drawText(info, {
      x: width - pad - infoWidth,
      y: headerY + (PDF_HEADER_H - infoSize) / 2 + 1,
      size: infoSize,
      font: fonts.regular,
      color: toRgb(PDF_INK),
      maxWidth: infoMax
    });
  }
  if (note) {
    const noteY = height - PDF_HEADER_H - PDF_NOTE_H;
    page.drawRectangle({
      x: 0,
      y: noteY,
      width,
      height: PDF_NOTE_H,
      color: toRgb(PDF_ORANGE)
    });
    const noteSize = 9;
    page.drawText(note, {
      x: pad,
      y: noteY + (PDF_NOTE_H - noteSize) / 2 + 1,
      size: noteSize,
      font: fonts.bold,
      color: toRgb(PDF_INK),
      maxWidth: width - pad * 2
    });
  }
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height: PDF_FOOTER_H,
    color: rgb(0, 0, 0)
  });
  const brandSize = 9;
  const creditSize = 8;
  const footerY = (PDF_FOOTER_H - brandSize) / 2 + 1;
  const stageW = fonts.bold.widthOfTextAtSize(PDF_BRAND_STAGE, brandSize);
  const sep = " - ";
  const sepW = fonts.bold.widthOfTextAtSize(sep, brandSize);
  page.drawText(PDF_BRAND_STAGE, {
    x: pad,
    y: footerY,
    size: brandSize,
    font: fonts.bold,
    color: toRgb(PDF_ORANGE)
  });
  page.drawText(sep, {
    x: pad + stageW,
    y: footerY,
    size: brandSize,
    font: fonts.bold,
    color: rgb(1, 1, 1)
  });
  page.drawText(PDF_BRAND_NAME, {
    x: pad + stageW + sepW,
    y: footerY,
    size: brandSize,
    font: fonts.bold,
    color: toRgb(PDF_BLUE)
  });
  const credit = exportCreditLine(date);
  const creditW = fonts.regular.widthOfTextAtSize(credit, creditSize);
  page.drawText(credit, {
    x: width - pad - creditW,
    y: (PDF_FOOTER_H - creditSize) / 2 + 1,
    size: creditSize,
    font: fonts.regular,
    color: rgb(1, 1, 1)
  });
}

function drawSpacedText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color: RGB,
  track: number
): void {
  let cursor = x;
  for (const ch of text) {
    page.drawText(ch, { x: cursor, y, size, font, color });
    cursor += font.widthOfTextAtSize(ch, size) * (1 + track);
  }
}

function spacedTextWidth(font: PDFFont, text: string, size: number, track: number): number {
  let width = 0;
  for (const ch of text) width += font.widthOfTextAtSize(ch, size) * (1 + track);
  return width;
}

function drawScoreOverlays(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  boxes: readonly NotaSectionBox[],
  pageIndex: number,
  lastPage: number,
  score: { x: number; y: number; width: number; height: number },
  song: Song | undefined
): void {
  const onPage = boxes.filter((box) => {
    const pageNo = Math.max(0, Math.min(lastPage, box.page));
    return pageNo === pageIndex;
  });
  const px = scoreLabelScale(score.width, liveScoreCssWidth() ?? SCORE_LABEL_CSS.refWidth);
  const size = SCORE_LABEL_CSS.font * px;
  const padX = SCORE_LABEL_CSS.padX * px;
  const padY = SCORE_LABEL_CSS.padY * px;
  const track = SCORE_LABEL_CSS.track;
  for (const box of onPage.filter(isSectionLabel)) {
    const tone = sectionTone(box.name);
    const label = sectionLabelText(box);
    const textW = spacedTextWidth(fonts.bold, label, size, track);
    const w = textW + padX * 2;
    const h = size * SCORE_LABEL_CSS.line + padY * 2;
    const x = score.x + box.x * score.width;
    const y = score.y + (1 - box.y) * score.height - h;
    page.drawRectangle({ x, y, width: w, height: h, color: toRgb(tone) });
    drawSpacedText(page, label, x + padX, y + (h - size) / 2, size, fonts.bold, rgb(1, 1, 1), track);
  }
  if (!song) return;
  const measures = uniqueChordLabelBoxes(onPage);
  for (const box of measures) {
    const lane = rectChordLane(song, box);
    if (!lane) continue;
    for (const mark of lane.marks) {
      const text = displayChordText(mark.text).replace(/\s+/g, " ").trim();
      if (!text || text === "-") continue;
      const size = SCORE_CHORD_CSS.font * px;
      const x = score.x + (box.x + (box.w * mark.beat) / lane.beats) * score.width + 1.5;
      const y = score.y + (1 - box.y) * score.height - size * 0.95;
      page.drawText(text, {
        x: x + 0.4,
        y: y - 0.4,
        size,
        font: fonts.bold,
        color: rgb(1, 1, 1)
      });
      page.drawText(text, { x, y, size, font: fonts.bold, color: toRgb(PDF_INK) });
    }
  }
}

async function addScorePages(
  pdf: PDFDocument,
  fonts: { regular: PDFFont; bold: PDFFont },
  song: Song,
  notaBytes: ArrayBuffer,
  rects: NotaSectionBox[],
  note: string,
  date: Date
): Promise<void> {
  const source = await PDFDocument.load(notaBytes);
  const srcPages = source.getPages();
  if (srcPages.length === 0) throw new Error("Score PDF has no pages.");
  const embedded = await pdf.embedPages(srcPages);
  const chrome = chromeHeights(note);
  const title = songDisplayName(song);
  const infos = songTitleMetaParts(song);
  const lastPage = embedded.length - 1;
  for (const [index, score] of embedded.entries()) {
    const height = fittedPageHeight(score.height, note);
    const page = pdf.addPage([score.width, height]);
    const { width } = page.getSize();
    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
    const scoreY = chrome.footer;
    page.drawPage(score, { x: 0, y: scoreY, width: score.width, height: score.height });
    drawScoreOverlays(
      page,
      fonts,
      rects,
      index,
      lastPage,
      { x: 0, y: scoreY, width: score.width, height: score.height },
      song
    );
    drawChrome(page, fonts, title, infos, note, date);
  }
}

const LYRIC_LINE = 16;
const LYRIC_GAP = 8;

function lyricBlockHeight(lines: string[]): number {
  return Math.max(LYRIC_LINE, lines.length * LYRIC_LINE) + LYRIC_GAP;
}

async function addLyricPages(
  pdf: PDFDocument,
  fonts: { regular: PDFFont; bold: PDFFont },
  song: Song,
  note: string,
  date: Date
): Promise<void> {
  const title = songDisplayName(song);
  const infos = songTitleMetaParts(song);
  const chrome = chromeHeights(note);
  const inner = A4.width - MARGIN * 2;
  const blocks = stageRows(song, false)
    .filter((row) => row.kind === "lyric")
    .map((row) => {
      if (row.kind !== "lyric") return [];
      return lyricBlocks(row.line).flatMap((block) => wrapText(fonts.regular, block, 12, inner));
    })
    .filter((lines) => lines.length > 0);
  const maxContent = A4.height - chrome.top - chrome.footer;
  const pages: string[][][] = [[]];
  let used = 0;
  const pushPage = () => {
    pages.push([]);
    used = 0;
  };
  if (blocks.length === 0) {
    pages[0]?.push(["No lyrics"]);
  } else {
    for (const lines of blocks) {
      const height = lyricBlockHeight(lines);
      const current = pages[pages.length - 1];
      if (current && current.length > 0 && used + height > maxContent) pushPage();
      pages[pages.length - 1]?.push(lines);
      used += height;
    }
  }
  for (const pageBlocks of pages) {
    const contentH = pageBlocks.reduce((sum, lines) => sum + lyricBlockHeight(lines), 0);
    const height = fittedPageHeight(contentH, note);
    const page = pdf.addPage([A4.width, height]);
    page.drawRectangle({ x: 0, y: 0, width: A4.width, height, color: toRgb(PDF_PAGE_BG) });
    let y = height - chrome.top;
    for (const lines of pageBlocks) {
      y -= LYRIC_LINE;
      for (const [index, line] of lines.entries()) {
        if (index > 0) y -= LYRIC_LINE;
        page.drawText(line, { x: MARGIN, y, size: 12, font: fonts.regular, color: toRgb(PDF_TEXT) });
      }
      y -= LYRIC_GAP;
    }
    drawChrome(page, fonts, title, infos, note, date);
  }
}

async function addDrumPages(
  pdf: PDFDocument,
  fonts: { regular: PDFFont; bold: PDFFont },
  song: Song,
  note: string,
  date: Date
): Promise<void> {
  const title = songDisplayName(song);
  const infos = songTitleMetaParts(song);
  const chrome = chromeHeights(note);
  const maxContent = A4.height - chrome.top - chrome.footer;
  const inner = A4.width - MARGIN * 2;
  const captured = await captureDrumChartPng(song);
  const image = await pdf.embedPng(captured.bytes);
  const destW = inner;
  const destH = image.height * (destW / image.width);
  const pages = Math.max(1, Math.ceil(destH / Math.max(1, maxContent)));
  for (let index = 0; index < pages; index++) {
    const slice = Math.min(maxContent, destH - index * maxContent);
    const height = fittedPageHeight(slice, note);
    const page = pdf.addPage([A4.width, height]);
    page.drawRectangle({ x: 0, y: 0, width: A4.width, height, color: toRgb(PDF_PAGE_BG) });
    page.drawImage(image, {
      x: MARGIN,
      y: height - chrome.top - destH + index * maxContent,
      width: destW,
      height: destH
    });
    drawChrome(page, fonts, title, infos, note, date);
  }
}

export async function buildSongPdf(options: {
  song: Song;
  target: PdfExportTarget;
  notaBytes?: ArrayBuffer;
  rects?: NotaSectionBox[];
  date?: Date;
}): Promise<Uint8Array> {
  const date = options.date ?? new Date();
  const note = pageNoteFor(parseSongInfo(options.song.info).pageNotes, options.target);
  const pdf = await PDFDocument.create();
  const fonts = await embedFonts(pdf);
  pdf.setTitle(`${songDisplayName(options.song)} - ${options.target}`);
  pdf.setAuthor(PDF_BRAND);
  const headerInfos = songTitleMetaParts(options.song);
  if (headerInfos.length > 0) pdf.setSubject(headerInfos.join("  ·  "));
  if (options.target === "lyrics") {
    await addLyricPages(pdf, fonts, options.song, note, date);
  } else if (options.target === "drums") {
    await addDrumPages(pdf, fonts, options.song, note, date);
  } else {
    if (!options.notaBytes) throw new Error("This song has no score PDF.");
    await addScorePages(
      pdf,
      fonts,
      options.song,
      options.notaBytes,
      options.rects ?? [],
      note,
      date
    );
  }
  return pdf.save();
}
