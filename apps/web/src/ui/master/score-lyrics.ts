import { measureStartTimes, type LyricLine, type Song } from "@dbk/core";
import {
  isSectionLabel,
  notaHitAt,
  rectsForHit,
  type BrokenMeasureChain,
  type NotaPlayHit,
  type NotaSectionBox
} from "./nota-sections";

const TIME_EPS = 0.02;
const LINE_Y_SLOP = 0.02;
export const SCORE_LYRIC_GAP_PX = 4;

export function lyricVerseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function lyricDisplayLine(text: string): string {
  return lyricVerseLines(text).join(" ");
}

export function lyricTimeSpan(
  song: Pick<Song, "lyrics" | "duration">,
  lyric: LyricLine,
  index: number
): { start: number; end: number } {
  const lyrics = song.lyrics ?? [];
  const start = lyric.time;
  const next = lyrics[index + 1]?.time;
  let end = lyric.end ?? next ?? song.duration;
  if (end <= start + TIME_EPS) end = next ?? song.duration;
  return { start, end: Math.max(start, end) };
}

export function lyricCoveredHits(
  song: Song,
  start: number,
  end: number
): NotaPlayHit[] {
  const starts = measureStartTimes(song.tempoMap, song.duration);
  const hits: NotaPlayHit[] = [];
  const seen = new Set<string>();
  const add = (hit: NotaPlayHit | undefined) => {
    if (!hit) return;
    const key = `${hit.sectionIndex}:${hit.measure}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };
  add(notaHitAt(song, start + TIME_EPS));
  for (const time of starts) {
    if (time < start - TIME_EPS) continue;
    if (time >= end - TIME_EPS) break;
    add(notaHitAt(song, time + TIME_EPS));
  }
  return hits;
}

export interface ScoreLyricPlacement {
  id: string;
  text: string;
  start: number;
  end: number;
  page: number;
  x: number;
  y: number;
  w: number;
}

function sameStaffLine(a: NotaSectionBox, b: NotaSectionBox): boolean {
  return a.page === b.page && Math.abs(a.y - b.y) < LINE_Y_SLOP;
}

export function splitEvenly<T>(items: readonly T[], partCount: number): T[][] {
  const parts = Math.max(1, partCount);
  if (items.length === 0) return Array.from({ length: parts }, () => []);
  const base = Math.floor(items.length / parts);
  const groups: T[][] = [];
  let start = 0;
  for (let i = 0; i < parts; i++) {
    const end = i === parts - 1 ? items.length : start + base;
    groups.push(items.slice(start, end));
    start = end;
  }
  return groups;
}

function fitVerseLines(lines: string[], slotCount: number): string[] {
  if (slotCount <= 0 || lines.length === 0) return [];
  if (lines.length <= slotCount) return lines;
  return [...lines.slice(0, slotCount - 1), lines.slice(slotCount - 1).join(" ")];
}

function placementBox(boxes: readonly NotaSectionBox[]): {
  page: number;
  x: number;
  y: number;
  w: number;
} | undefined {
  const first = boxes[0];
  if (!first) return undefined;
  const line = boxes.filter((box) => sameStaffLine(box, first));
  if (line.length === 0) return undefined;
  const x = Math.min(...line.map((box) => box.x));
  const y = Math.max(...line.map((box) => box.y + box.h));
  const w = line.reduce((sum, box) => sum + box.w, 0);
  if (w <= 0) return undefined;
  return { page: first.page, x, y, w };
}

export function scoreLyricPlacements(
  song: Song,
  rects: readonly NotaSectionBox[],
  broken: readonly BrokenMeasureChain[] = []
): ScoreLyricPlacement[] {
  const lyrics = song.lyrics ?? [];
  const out: ScoreLyricPlacement[] = [];
  lyrics.forEach((lyric, index) => {
    const verses = lyricVerseLines(lyric.text);
    if (verses.length === 0) return;
    const span = lyricTimeSpan(song, lyric, index);
    const boxes = lyricCoveredHits(song, span.start, span.end)
      .flatMap((hit) => rectsForHit(rects, hit, broken))
      .filter((box) => !isSectionLabel(box));
    const unique = [...new Map(boxes.map((box) => [box.id, box])).values()].sort(
      (a, b) => a.page - b.page || a.y - b.y || a.x - b.x
    );
    if (unique.length === 0) return;
    const lines = fitVerseLines(verses, unique.length);
    const groups = splitEvenly(unique, lines.length);
    const duration = span.end - span.start;
    lines.forEach((text, lineIndex) => {
      const group = groups[lineIndex] ?? [];
      const box = placementBox(group);
      if (!box) return;
      const from = group.length === 0 ? 0 : unique.indexOf(group[0]!);
      const start = span.start + (duration * Math.max(0, from)) / unique.length;
      const end = span.start + (duration * (from + group.length)) / unique.length;
      out.push({
        id: `lyric-${index}-${lineIndex}`,
        text,
        start,
        end,
        page: box.page,
        x: box.x,
        y: box.y,
        w: box.w
      });
    });
  });
  return out;
}

export function activeScoreLyric(
  lines: readonly ScoreLyricPlacement[],
  time: number | undefined
): ScoreLyricPlacement | undefined {
  if (time == null) return undefined;
  return lines.find((line) => time >= line.start && time < line.end);
}
