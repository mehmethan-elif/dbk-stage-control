export const PDF_EXPORT_TARGETS = ["lyrics", "chords", "drums"] as const;

export type PdfExportTarget = (typeof PDF_EXPORT_TARGETS)[number];

export const PDF_EXPORT_LABELS: Record<PdfExportTarget, string> = {
  lyrics: "Lyrics",
  chords: "Chords",
  drums: "Drums"
};

export function exportPdfFileName(title: string, target: PdfExportTarget): string {
  const safe = title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim() || "Song";
  return `${safe} - ${PDF_EXPORT_LABELS[target]}.pdf`;
}

export function isExportPdfName(name: string): boolean {
  return /^.+ - (Lyrics|Score|Chords|Drums)\.pdf$/.test(name);
}
