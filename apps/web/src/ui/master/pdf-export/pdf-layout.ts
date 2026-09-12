export const PDF_BRAND_STAGE = "DBK STAGE";
export const PDF_BRAND_NAME = "ELİF AVCI";
export const PDF_BRAND = `${PDF_BRAND_STAGE} - ${PDF_BRAND_NAME}`;
export const PDF_CREATOR = "Mehmethan Dişbudak";
export const PDF_ORANGE = { r: 0xea / 255, g: 0x84 / 255, b: 0 };
export const PDF_BLUE = { r: 47 / 255, g: 111 / 255, b: 237 / 255 };
export const PDF_INK = { r: 0.07, g: 0.07, b: 0.07 };
export const PDF_PAGE_BG = { r: 17 / 255, g: 17 / 255, b: 17 / 255 };
export const PDF_TEXT = { r: 238 / 255, g: 238 / 255, b: 238 / 255 };
export const PDF_HEADER_H = 32;
export const PDF_NOTE_H = 22;
export const PDF_FOOTER_H = 28;
export const PDF_GAP = 10;

/** On-screen `.nota-section-label` is always 13px on the scaled score. */
export const SCORE_LABEL_CSS = {
  font: 13,
  padX: 7,
  padY: 2,
  radius: 3,
  track: 0.04,
  line: 1.15,
  refWidth: 922
} as const;

/** On-screen `.nota-rect-chord` font-size. PDF scales this with the score. */
export const SCORE_CHORD_CSS = {
  font: 16,
  track: 0.02
} as const;

export function scoreLabelScale(scoreWidth: number, cssWidth = SCORE_LABEL_CSS.refWidth): number {
  return scoreWidth / Math.max(1, cssWidth);
}

export function liveScoreCssWidth(): number | undefined {
  if (typeof document === "undefined") return undefined;
  const canvas = document.querySelector<HTMLCanvasElement>("canvas.nota-page");
  const width = canvas?.getBoundingClientRect().width ?? 0;
  return width >= 200 ? width : undefined;
}

export const SECTION_TONE = {
  count: { r: 230 / 255, g: 193 / 255, b: 74 / 255 },
  serbest: { r: 139 / 255, g: 92 / 255, b: 246 / 255 },
  song: { r: 61 / 255, g: 186 / 255, b: 122 / 255 },
  final: { r: 226 / 255, g: 74 / 255, b: 74 / 255 },
  def: { r: 47 / 255, g: 111 / 255, b: 237 / 255 }
} as const;

export function formatExportDate(date = new Date()): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

export function exportCreditLine(date = new Date()): string {
  return `created by ${PDF_CREATOR}, ${formatExportDate(date)}`;
}

export function pageNoteFor(
  notes: Partial<Record<"lyrics" | "score" | "chord" | "drums", string>> | undefined,
  target: "lyrics" | "score" | "chords" | "drums"
): string {
  const key = target === "chords" ? "chord" : target;
  return notes?.[key]?.trim() ?? "";
}

export function chromeHeights(note: string): { header: number; note: number; footer: number; top: number } {
  const noteH = note ? PDF_NOTE_H : 0;
  return {
    header: PDF_HEADER_H,
    note: noteH,
    footer: PDF_FOOTER_H,
    top: PDF_HEADER_H + noteH + PDF_GAP
  };
}

export function fittedPageHeight(contentH: number, note = ""): number {
  const chrome = chromeHeights(note);
  return chrome.top + Math.max(0, contentH) + chrome.footer;
}

function tokens(name: string): string[] {
  return name
    .trim()
    .toLocaleUpperCase("tr-TR")
    .split(/[^A-Z0-9]+/)
    .filter((part) => part.length > 0);
}

function isNamed(name: string, token: string): boolean {
  const normalized = name.trim().toLocaleUpperCase("tr-TR");
  if (normalized === token || normalized.startsWith(`${token} `)) return true;
  return tokens(name).includes(token);
}

export function sectionTone(name: string): (typeof SECTION_TONE)[keyof typeof SECTION_TONE] {
  if (isNamed(name, "COUNT")) return SECTION_TONE.count;
  if (isNamed(name, "SERBEST")) return SECTION_TONE.serbest;
  if (isNamed(name, "SAN") || isNamed(name, "NAK")) return SECTION_TONE.song;
  if (isNamed(name, "FINAL") || isNamed(name, "RALL")) return SECTION_TONE.final;
  return SECTION_TONE.def;
}
