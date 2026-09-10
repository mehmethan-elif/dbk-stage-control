import { timeToMusical, type Section, type Song, type TempoPoint } from "@dbk/core";
import {
  boxAbsoluteMeasure,
  isSectionLabel,
  notaHitAt,
  rectsForHit,
  type BrokenMeasureChain,
  type NotaSectionBox
} from "./nota-sections";

const TIME_EPS = 0.02;

export function firstTempoChangeMeasure(map: readonly TempoPoint[] | undefined): number | undefined {
  if (!map || map.length < 2) return undefined;
  const points = [...map]
    .filter((point) => point.bpm > 0)
    .sort((a, b) => a.time - b.time || a.measure - b.measure);
  const first = points[0];
  if (!first) return undefined;
  const change = points.find(
    (point) => point.time > first.time + TIME_EPS && Math.abs(point.bpm - first.bpm) > 1e-6
  );
  return change?.measure;
}

export function showsRallAlert(absMeasure: number, rallMeasure: number | undefined): boolean {
  return rallMeasure != null && absMeasure >= rallMeasure - 1;
}

export type RallDrumTone = "idle" | "soon" | "now";

export function rallDrumTone(
  currentMeasure: number | undefined,
  rallMeasure: number | undefined,
  sectionCurrent: boolean
): RallDrumTone {
  if (!sectionCurrent || currentMeasure == null || rallMeasure == null) return "idle";
  if (currentMeasure >= rallMeasure) return "now";
  if (currentMeasure === rallMeasure - 1) return "soon";
  return "idle";
}

export function isRallSectionName(name: string): boolean {
  return name.trim().toLocaleUpperCase("tr-TR") === "RALL";
}

export function rallOwnerSection(song: Pick<Song, "sections" | "tempoMap">): Section | undefined {
  const rall = firstTempoChangeMeasure(song.tempoMap);
  if (rall == null) return undefined;
  const point = [...(song.tempoMap ?? [])].find((item) => item.measure === rall);
  if (!point) return undefined;
  return song.sections.find(
    (section) => point.time >= section.start - TIME_EPS && point.time < section.end - TIME_EPS
  );
}

export function runShowsRallBar(
  run: { start: number; end: number },
  row: { section: Section; runs: ReadonlyArray<{ start: number; end: number }> },
  song: Pick<Song, "sections" | "tempoMap">,
  lastRun: boolean,
  lastNamedRow = true
): boolean {
  if (isRallSectionName(row.section.name)) return false;
  const rall = firstTempoChangeMeasure(song.tempoMap);
  if (rall == null) return false;
  const owner = rallOwnerSection(song);
  if (!owner || owner.name !== row.section.name) return false;
  if (runCoversAbsoluteMeasure(song.tempoMap ?? [], row.section.start, row.section.end, rall)) {
    return runCoversAbsoluteMeasure(song.tempoMap ?? [], run.start, run.end, rall);
  }
  return lastNamedRow && lastRun;
}

export function runCoversAbsoluteMeasure(
  map: readonly TempoPoint[],
  start: number,
  end: number,
  measure: number
): boolean {
  if (end - start <= TIME_EPS) return false;
  const first = timeToMusical([...map], start + TIME_EPS).measure;
  const last = timeToMusical([...map], Math.max(start, end - TIME_EPS)).measure;
  return measure >= first && measure <= last;
}

export function rallOverlayBoxes(
  song: Song,
  rects: readonly NotaSectionBox[],
  time?: number,
  broken: readonly BrokenMeasureChain[] = []
): NotaSectionBox[] {
  if (time == null) return [];
  const rall = firstTempoChangeMeasure(song.tempoMap);
  if (rall == null) return [];
  const hit = notaHitAt(song, time);
  if (!hit) return [];
  const abs = boxAbsoluteMeasure(song, hit);
  if (abs == null || !showsRallAlert(abs, rall)) return [];
  const current = rectsForHit(rects, hit, broken).filter((box) => !isSectionLabel(box));
  if (current.length > 0) return current;
  const label = rects.find(
    (box) =>
      isSectionLabel(box) &&
      box.name === hit.name &&
      (box.sectionIndex == null || box.sectionIndex === hit.sectionIndex)
  );
  return label ? [label] : [];
}
