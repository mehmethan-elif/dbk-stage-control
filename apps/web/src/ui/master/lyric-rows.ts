import type { LyricLine, Song } from "@dbk/core";

const TIME_EPS = 0.05;

export type LyricStageRow =
  | { kind: "section"; time: number; end: number; name: string }
  | { kind: "lyric"; time: number; end: number; line: LyricLine; lyricIndex: number };

export function lyricBlocks(line: LyricLine): string[] {
  return line.text.split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
}

export function lyricCovers(lyrics: LyricLine[], time: number): boolean {
  return lyrics.some((line) => {
    if (Math.abs(line.time - time) <= TIME_EPS) return true;
    if (line.end == null) return false;
    return line.time < time + TIME_EPS && time + TIME_EPS < line.end;
  });
}

export function stageRows(song: Song | undefined, showSections = true): LyricStageRow[] {
  const lyrics = song?.lyrics ?? [];
  const rows: LyricStageRow[] = [];
  if (showSections) {
    for (const section of song?.sections ?? []) {
      if (!lyricCovers(lyrics, section.start)) {
        rows.push({ kind: "section", time: section.start, end: section.end, name: section.name });
      }
    }
  }
  lyrics.forEach((line, lyricIndex) => {
    rows.push({
      kind: "lyric",
      time: line.time,
      end: line.end ?? line.time,
      line,
      lyricIndex
    });
  });
  rows.sort((a, b) => a.time - b.time || (a.kind === "section" ? -1 : 1));
  const duration = song?.duration ?? 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.end > row.time) continue;
    row.end = rows[i + 1]?.time ?? duration;
  }
  return rows;
}
