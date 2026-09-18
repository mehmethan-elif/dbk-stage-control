import { timeToMusical, type Section, type Song, type TempoPoint } from "@dbk/core";
import {
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

export function firstTempoChangeTime(map: readonly TempoPoint[] | undefined): number | undefined {
  const measure = firstTempoChangeMeasure(map);
  if (measure == null) return undefined;
  return [...(map ?? [])].find((point) => point.measure === measure)?.time;
}

export function showsRallAlert(absMeasure: number, rallMeasure: number | undefined): boolean {
  return rallMeasure != null && absMeasure >= rallMeasure - 1;
}

function lyricLineShowsMeasure(
  song: Pick<Song, "tempoMap"> | undefined,
  line: { time: number; end?: number },
  time: number,
  target: number | undefined
): boolean {
  if (target == null) return false;
  const map = [...(song?.tempoMap ?? [])];
  const measure = timeToMusical(map, Math.max(0, time)).measure;
  if (!showsRallAlert(measure, target)) return false;
  const end = line.end != null && line.end > line.time ? line.end : line.time;
  return time + TIME_EPS >= line.time && time < end + TIME_EPS;
}

export function lyricLineShowsRall(
  song: Pick<Song, "tempoMap"> | undefined,
  line: { time: number; end?: number },
  time: number
): boolean {
  return lyricLineShowsMeasure(song, line, time, firstTempoChangeMeasure(song?.tempoMap));
}

export function lyricLineShowsFinal(
  song: Pick<Song, "finalAt" | "tempoMap" | "sections" | "duration"> | undefined,
  line: { time: number; end?: number },
  time: number
): boolean {
  if (!song || finalMeasure(song) == null) return false;
  const map = [...(song.tempoMap ?? [])];
  const measure = timeToMusical(map, Math.max(0, time)).measure;
  if (!showsFinalAlert(measure, song)) return false;
  const end = line.end != null && line.end > line.time ? line.end : line.time;
  return time + TIME_EPS >= line.time && time < end + TIME_EPS;
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

function sectionAtTime(
  sections: readonly Section[],
  time: number
): Section | undefined {
  return sections.find(
    (section) => time >= section.start - TIME_EPS && time < section.end - TIME_EPS
  );
}

export function rallOwnerSection(song: Pick<Song, "sections" | "tempoMap">): Section | undefined {
  const rall = firstTempoChangeMeasure(song.tempoMap);
  if (rall == null) return undefined;
  const point = [...(song.tempoMap ?? [])].find((item) => item.measure === rall);
  if (!point) return undefined;
  return sectionAtTime(song.sections, point.time);
}

export function finalOwnerSection(
  song: Pick<Song, "sections" | "finalAt" | "tempoMap">
): Section | undefined {
  const at = song.finalAt;
  if (at == null || !Number.isFinite(at)) return undefined;
  return sectionAtTime(song.sections, at);
}

function runShowsCueBar(
  run: { start: number; end: number },
  row: { section: Section; runs: ReadonlyArray<{ start: number; end: number }> },
  song: Pick<Song, "sections" | "tempoMap">,
  lastRun: boolean,
  lastNamedRow: boolean,
  measure: number | undefined,
  owner: Section | undefined,
  skip = false
): boolean {
  if (skip || measure == null) return false;
  if (!owner || owner.name !== row.section.name) return false;
  if (runCoversAbsoluteMeasure(song.tempoMap ?? [], row.section.start, row.section.end, measure)) {
    return runCoversAbsoluteMeasure(song.tempoMap ?? [], run.start, run.end, measure);
  }
  return lastNamedRow && lastRun;
}

export function runShowsRallBar(
  run: { start: number; end: number },
  row: { section: Section; runs: ReadonlyArray<{ start: number; end: number }> },
  song: Pick<Song, "sections" | "tempoMap">,
  lastRun: boolean,
  lastNamedRow = true
): boolean {
  return runShowsCueBar(
    run,
    row,
    song,
    lastRun,
    lastNamedRow,
    firstTempoChangeMeasure(song.tempoMap),
    rallOwnerSection(song),
    isRallSectionName(row.section.name)
  );
}

export function runShowsFinalBar(
  run: { start: number; end: number },
  row: { section: Section; runs: ReadonlyArray<{ start: number; end: number }> },
  song: Pick<Song, "sections" | "finalAt" | "tempoMap">,
  lastRun: boolean,
  lastNamedRow = true
): boolean {
  return runShowsCueBar(
    run,
    row,
    song,
    lastRun,
    lastNamedRow,
    finalMeasure(song),
    finalOwnerSection(song)
  );
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

/** Absolute measure of the FINAL marker, when the export found one. */
export function finalMeasure(song: Pick<Song, "finalAt" | "tempoMap"> | undefined): number | undefined {
  const at = song?.finalAt;
  if (at == null || !Number.isFinite(at) || at < 0) return undefined;
  return timeToMusical([...(song.tempoMap ?? [])], at).measure;
}

export function lastFormMeasure(
  song: Pick<Song, "tempoMap" | "sections"> | undefined
): number | undefined {
  const last = song?.sections?.[song.sections.length - 1];
  if (!last) return undefined;
  return timeToMusical(
    [...(song.tempoMap ?? [])],
    Math.max(last.end - TIME_EPS, last.start)
  ).measure;
}

/** Last bar that still flashes — the last measure of the last section. */
export function finalLastMeasure(
  song: Pick<Song, "finalAt" | "tempoMap" | "sections" | "duration"> | undefined
): number | undefined {
  const start = finalMeasure(song);
  if (start == null || !song) return undefined;
  const owner = finalOwnerSection(song);
  const end = owner?.end ?? song.duration;
  const ownerLast =
    end == null
      ? start
      : timeToMusical(
          [...(song.tempoMap ?? [])],
          Math.max(end - TIME_EPS, song.finalAt ?? 0)
        ).measure;
  const formLast = lastFormMeasure(song);
  return Math.max(start, ownerLast, formLast ?? start);
}

/** FINAL flashes one bar early, then stays through the last bar of its section. */
export function showsFinalAlert(
  absMeasure: number,
  song: Pick<Song, "finalAt" | "tempoMap" | "sections" | "duration"> | undefined
): boolean {
  const start = finalMeasure(song);
  const last = finalLastMeasure(song);
  return start != null && last != null && absMeasure >= start - 1 && absMeasure <= last;
}

export function finalDrumTone(
  currentMeasure: number | undefined,
  song: Pick<Song, "finalAt" | "tempoMap" | "sections" | "duration"> | undefined,
  sectionCurrent: boolean
): RallDrumTone {
  if (!sectionCurrent || currentMeasure == null) return "idle";
  const start = finalMeasure(song);
  const last = finalLastMeasure(song);
  if (start == null || last == null) return "idle";
  if (currentMeasure > last || currentMeasure < start - 1) return "idle";
  if (currentMeasure >= start) return "now";
  return "soon";
}

export type SongCueKind = "rall" | "final";

export function isFinalSectionName(name: string): boolean {
  return name.trim().toLocaleUpperCase("tr-TR") === "FINAL";
}

function lastSectionName(
  song: Pick<Song, "sections"> | undefined
): string | undefined {
  const sections = song?.sections ?? [];
  return sections[sections.length - 1]?.name;
}

/** Cues drawn as a last section bar — skipped when that name is already the last section. */
export function songCues(
  song: Pick<Song, "finalAt" | "tempoMap" | "sections" | "duration"> | undefined
): SongCueKind[] {
  if (!song) return [];
  const last = lastSectionName(song);
  const cues: SongCueKind[] = [];
  if (firstTempoChangeMeasure(song.tempoMap) != null && !isRallSectionName(last ?? "")) {
    cues.push("rall");
  }
  if (finalMeasure(song) != null && !isFinalSectionName(last ?? "")) {
    cues.push("final");
  }
  return cues;
}

export function songCueTone(
  measure: number | undefined,
  kind: SongCueKind,
  song: Pick<Song, "finalAt" | "tempoMap" | "sections" | "duration"> | undefined
): RallDrumTone {
  if (measure == null) return "idle";
  const last = lastFormMeasure(song);
  if (last != null && measure > last) return "idle";
  if (kind === "rall") {
    return rallDrumTone(measure, firstTempoChangeMeasure(song?.tempoMap), true);
  }
  return finalDrumTone(measure, song, true);
}

export function applySongCueTone(el: HTMLElement, tone: RallDrumTone): void {
  el.classList.remove("idle", "soon", "now");
  el.classList.add(tone);
}

export function cueMeasureAt(
  song: Pick<Song, "tempoMap"> | undefined,
  time: number
): number {
  return timeToMusical([...(song?.tempoMap ?? [])], Math.max(0, time)).measure;
}

function overlayBoxesForMeasure(
  song: Song,
  rects: readonly NotaSectionBox[],
  time: number | undefined,
  broken: readonly BrokenMeasureChain[],
  inWindow: (abs: number) => boolean
): NotaSectionBox[] {
  if (time == null) return [];
  const abs = timeToMusical([...(song.tempoMap ?? [])], time).measure;
  if (!inWindow(abs)) return [];
  const hit = notaHitAt(song, time);
  if (!hit) return [];
  const current = rectsForHit(rects, hit, broken, song.sections).filter((box) => !isSectionLabel(box));
  if (current.length > 0) return current;
  const label = rects.find(
    (box) =>
      isSectionLabel(box) &&
      box.name === hit.name &&
      (box.sectionIndex == null || box.sectionIndex === hit.sectionIndex)
  );
  return label ? [label] : [];
}

export function rallOverlayBoxes(
  song: Song,
  rects: readonly NotaSectionBox[],
  time?: number,
  broken: readonly BrokenMeasureChain[] = []
): NotaSectionBox[] {
  const rall = firstTempoChangeMeasure(song.tempoMap);
  return overlayBoxesForMeasure(song, rects, time, broken, (abs) => showsRallAlert(abs, rall));
}

export function finalOverlayBoxes(
  song: Song,
  rects: readonly NotaSectionBox[],
  time?: number,
  broken: readonly BrokenMeasureChain[] = []
): NotaSectionBox[] {
  return overlayBoxesForMeasure(song, rects, time, broken, (abs) => showsFinalAlert(abs, song));
}

/** Score keeps the marks on the page; tone is idle until the warning bar. */
export function scoreFooterCues(
  song: Song,
  time: number | undefined
): { kind: SongCueKind; tone: RallDrumTone }[] {
  const measure = time == null ? undefined : cueMeasureAt(song, time);
  return songCues(song).map((kind) => ({ kind, tone: songCueTone(measure, kind, song) }));
}
