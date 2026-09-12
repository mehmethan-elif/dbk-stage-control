import { type CSSProperties } from "react";
import {
  secondsPerMeasure,
  tempoAt,
  timeToMusical,
  type ChordEvent,
  type PatternNote,
  type Song,
  type TempoPoint
} from "@dbk/core";
import {
  boxAbsoluteMeasure,
  editableNotaSections,
  isSectionLabel,
  sectionMeasureNumbers,
  type NotaSectionBox
} from "./nota-sections";

const TIME_EPS = 0.02;
const MAJ7 = /maj7/gi;

export const STEPS_PER_BEAT = 4;
export const STEPS_PER_MEASURE = STEPS_PER_BEAT * 4;

export function stepsForBeats(beats: number): number {
  return Math.max(STEPS_PER_BEAT, Math.max(1, Math.round(beats)) * STEPS_PER_BEAT);
}

export function stepsFromTempoMap(map: TempoPoint[], measure: number): number {
  const start = measureSpan(map, measure).start;
  return stepsForBeats(Math.max(1, Math.round(tempoAt(map, start).numerator) || 4));
}

export function displayChordText(text: string): string {
  return text.replace(MAJ7, "Δ");
}

export const NOTE_LANES = [
  { name: "G", pc: 7 },
  { name: "F", pc: 5 },
  { name: "E", pc: 4 },
  { name: "D", pc: 2 },
  { name: "C", pc: 0 }
] as const;

export interface ChordNoteHit {
  step: number;
  lane: string;
}

export function measureSpan(map: TempoPoint[], measure: number): { start: number; end: number } {
  let point = map[0];
  for (const item of map) {
    if (item.measure <= measure) point = item;
    else break;
  }
  if (!point) return { start: 0, end: 0 };
  const len = secondsPerMeasure(point);
  const start = point.time + (measure - point.measure) * len;
  return { start, end: start + len };
}

export function chordEnd(chords: ChordEvent[], index: number, fallback: number): number {
  const current = chords[index];
  if (current?.end != null) return current.end;
  return chords[index + 1]?.time ?? fallback;
}

function laneName(pitch: number): string | undefined {
  const pc = ((pitch % 12) + 12) % 12;
  return NOTE_LANES.find((lane) => lane.pc === pc)?.name;
}

function stepOf(note: PatternNote, origin: number, steps: number, map: TempoPoint[]): number {
  const meter = tempoAt(map, note.time);
  const measureLen = secondsPerMeasure(meter);
  if (measureLen <= 0) return 0;
  const raw = ((note.time - origin) / measureLen) * steps;
  return Math.max(0, Math.min(steps - 1, Math.round(raw)));
}

export function notesInMeasure(
  chords: ChordEvent[],
  measure: number,
  start: number,
  end: number,
  duration: number,
  map: TempoPoint[]
): ChordNoteHit[] {
  const origin = measureSpan(map, measure).start;
  const hits = new Map<string, ChordNoteHit>();
  const seen = new Set<string>();
  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    const cEnd = chordEnd(chords, i, duration);
    if (chord.time >= end - TIME_EPS || cEnd <= start + TIME_EPS) continue;
    for (const note of chord.notes ?? []) {
      if (note.measure != null && note.measure !== measure) continue;
      if (note.time < start - TIME_EPS || note.time >= end - TIME_EPS) continue;
      const key = `${note.time.toFixed(5)}:${note.pitch}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lane = laneName(note.pitch);
      if (!lane) continue;
      const step = stepOf(note, origin, stepsFromTempoMap(map, measure), map);
      hits.set(`${step}:${lane}`, { step, lane });
    }
  }
  return [...hits.values()].sort((a, b) => a.step - b.step || a.lane.localeCompare(b.lane));
}

export function songHasChordNotes(song: Song | undefined): boolean {
  return (song?.chords ?? []).some((chord) => (chord.notes?.length ?? 0) > 0);
}

export function notesForMeasure(song: Song, measure: number): ChordNoteHit[] {
  const span = measureSpan(song.tempoMap, measure);
  const start = span.start;
  const end = Math.min(span.end, song.duration);
  if (end - start <= TIME_EPS) return [];
  return notesInMeasure(song.chords ?? [], measure, start, end, song.duration, song.tempoMap);
}

export function playheadMeasure(song: Song, time: number): number {
  const last = Math.max(0, song.duration - TIME_EPS);
  return timeToMusical(song.tempoMap, Math.min(Math.max(time, 0), last)).measure;
}

function stepAt(time: number, origin: number, map: TempoPoint[], steps: number): number {
  const meter = tempoAt(map, time);
  const measureLen = secondsPerMeasure(meter);
  if (measureLen <= 0) return 0;
  const raw = ((time - origin) / measureLen) * steps;
  return Math.max(0, Math.min(steps - 1, Math.round(raw)));
}

export interface ChordBeatMark {
  text: string;
  step: number;
  beat: number;
}

export function beatIndexAtTime(time: number, start: number, end: number, beats: number): number {
  const n = Math.max(1, beats);
  const span = end - start;
  if (span <= TIME_EPS) return 0;
  const raw = ((time - start) / span) * n;
  const nearest = Math.round(raw);
  if (Math.abs(raw - nearest) < 1e-3) {
    return Math.max(0, Math.min(n - 1, nearest));
  }
  return Math.max(0, Math.min(n - 1, Math.floor(raw + 1e-6)));
}

export function beatIndexForChord(
  chord: Pick<ChordEvent, "time" | "beat">,
  start: number,
  end: number,
  beats: number
): number {
  return beatIndexAtTime(chord.time, start, end, beats);
}

export function chordMarksForMeasure(song: Song, measure: number): ChordBeatMark[] {
  const span = measureSpan(song.tempoMap, measure);
  const start = span.start;
  const end = Math.min(span.end, song.duration);
  if (end - start <= TIME_EPS) return [];
  const beats = beatsForMeasure(song, measure);
  const steps = stepsForBeats(beats);
  const chords = song.chords ?? [];
  const starting = chords.filter(
    (chord) => chord.time >= start - TIME_EPS && chord.time < end - TIME_EPS && chord.text.trim()
  );
  if (starting.length > 0) {
    return starting.map((chord) => ({
      text: chord.text.trim(),
      step: stepAt(chord.time, start, song.tempoMap, steps),
      beat: beatIndexForChord(chord, start, end, beats)
    }));
  }
  for (let i = chords.length - 1; i >= 0; i--) {
    const chord = chords[i];
    if (!chord || chord.time > start + TIME_EPS) continue;
    if (chordEnd(chords, i, song.duration) > start + TIME_EPS) {
      const text = chord.text.trim();
      return text ? [{ text, step: 0, beat: 0 }] : [];
    }
    break;
  }
  return [];
}

export function beatsForMeasure(song: Song, measure: number): number {
  const map = song.tempoMap ?? [];
  const start = measureSpan(map, measure).start;
  return Math.max(1, Math.round(tempoAt(map, start).numerator) || 4);
}

export function stepsForMeasure(song: Song, measure: number): number {
  return stepsForBeats(beatsForMeasure(song, measure));
}

export function stepsForBox(
  song: Song | undefined,
  box: Pick<NotaSectionBox, "name" | "measure" | "sectionIndex"> | undefined
): number {
  if (!song || !box) return STEPS_PER_MEASURE;
  const measure = boxAbsoluteMeasure(song, box);
  if (measure == null) return STEPS_PER_MEASURE;
  return stepsForMeasure(song, measure);
}

export function notesForCurrentMeasure(song: Song | undefined, time: number): ChordNoteHit[] {
  if (!song || !songHasChordNotes(song)) return [];
  return notesForMeasure(song, playheadMeasure(song, time));
}

export function notesForNextMeasure(song: Song | undefined, time: number): ChordNoteHit[] {
  if (!song || !songHasChordNotes(song)) return [];
  return notesForMeasure(song, playheadMeasure(song, time) + 1);
}

export function beatIndexForStep(step: number, beats: number): number {
  const n = Math.max(1, beats);
  return beatIndexAtTime(step / stepsForBeats(n), 0, 1, n);
}

export interface RectChordLane {
  beats: number;
  marks: Array<{ text: string; beat: number }>;
}

export function rectChordLane(
  song: Song | undefined,
  box: Pick<NotaSectionBox, "name" | "measure" | "sectionIndex">
): RectChordLane | undefined {
  if (!song) return undefined;
  const measure = boxAbsoluteMeasure(song, box);
  if (measure == null) return undefined;
  const beats = beatsForMeasure(song, measure);
  const byBeat = new Map<number, string[]>();
  for (const mark of chordMarksForMeasure(song, measure)) {
    const texts = byBeat.get(mark.beat) ?? [];
    texts.push(mark.text);
    byBeat.set(mark.beat, texts);
  }
  return {
    beats,
    marks: [...byBeat.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([beat, texts]) => ({ beat, text: texts.join(" ") }))
  };
}

export function chordNamesForBox(
  song: Song | undefined,
  box: Pick<NotaSectionBox, "name" | "measure" | "sectionIndex">
): string {
  return (
    rectChordLane(song, box)
      ?.marks.map((mark) => mark.text)
      .join(" ") ?? ""
  );
}

function chordBoxRank(box: Pick<NotaSectionBox, "sectionIndex">): number {
  return box.sectionIndex ?? -1;
}

export function uniqueChordLabelBoxes(rects: readonly NotaSectionBox[]): NotaSectionBox[] {
  const byKey = new Map<string, NotaSectionBox>();
  for (const box of rects) {
    if (isSectionLabel(box)) continue;
    const key = [
      box.page,
      box.name,
      box.measure,
      box.x.toFixed(5),
      box.y.toFixed(5),
      box.w.toFixed(5),
      box.h.toFixed(5)
    ].join("|");
    const current = byKey.get(key);
    if (!current || chordBoxRank(box) < chordBoxRank(current)) {
      byKey.set(key, box);
    }
  }
  return [...byKey.values()];
}

export function notesForBox(
  song: Song | undefined,
  box: Pick<NotaSectionBox, "name" | "measure" | "sectionIndex"> | undefined
): ChordNoteHit[] {
  if (!song || !box) return [];
  const measure = boxAbsoluteMeasure(song, box);
  if (measure == null) return [];
  return notesForMeasure(song, measure);
}

export function noteGridKey(hits: readonly ChordNoteHit[]): string {
  return hits
    .map((hit) => `${hit.step}:${hit.lane}`)
    .sort()
    .join("|");
}

export function nextNoteGridIfDifferent(
  current: readonly ChordNoteHit[],
  next: readonly ChordNoteHit[]
): ChordNoteHit[] | undefined {
  if (next.length === 0) return undefined;
  if (noteGridKey(current) === noteGridKey(next)) return undefined;
  return next.map((hit) => ({ ...hit }));
}

const LINE_Y_SLOP = 0.02;

export function measureNoteReadingOrder(a: NotaSectionBox, b: NotaSectionBox): number {
  if (a.page !== b.page) return a.page - b.page;
  if (Math.abs(a.y - b.y) >= LINE_Y_SLOP) return a.y - b.y;
  return a.x - b.x;
}

export function firstDistinctMeasureNoteGrids(
  items: readonly { box: NotaSectionBox; notes: ChordNoteHit[] }[]
): { box: NotaSectionBox; notes: ChordNoteHit[] }[] {
  return firstDistinctMeasureNoteStacks(
    items.map((item) => ({ box: item.box, layers: item.notes.length > 0 ? [item.notes] : [] }))
  ).map((item) => ({ box: item.box, notes: item.layers[0] ?? [] }));
}

export function occurrenceNoteGridsForBox(
  song: Song,
  box: Pick<NotaSectionBox, "name" | "measure">
): ChordNoteHit[][] {
  const layers: ChordNoteHit[][] = [];
  const seen = new Set<string>();
  for (const item of editableNotaSections(song.sections ?? [])) {
    if (item.name !== box.name) continue;
    const notes = notesForBox(song, {
      name: box.name,
      measure: box.measure,
      sectionIndex: item.index
    });
    if (notes.length === 0) continue;
    const key = noteGridKey(notes);
    if (seen.has(key)) continue;
    seen.add(key);
    layers.push(notes);
  }
  return layers;
}

export function firstDistinctMeasureNoteStacks(
  items: readonly { box: NotaSectionBox; layers: ChordNoteHit[][] }[]
): { box: NotaSectionBox; layers: ChordNoteHit[][] }[] {
  const shown: { box: NotaSectionBox; layers: ChordNoteHit[][] }[] = [];
  let lastKey: string | undefined;
  for (const item of items) {
    if (item.layers.length === 0) {
      lastKey = undefined;
      continue;
    }
    const key = item.layers.map((layer) => noteGridKey(layer)).join("\n");
    if (key === lastKey) continue;
    lastKey = key;
    shown.push(item);
  }
  return shown;
}

export function measureNoteGridsToPlace(
  song: Song | undefined,
  rects: readonly NotaSectionBox[]
): { box: NotaSectionBox; layers: ChordNoteHit[][] }[] {
  if (!song) return [];
  const items = [...rects]
    .filter((box) => !isSectionLabel(box))
    .sort(measureNoteReadingOrder)
    .map((box) => ({ box, layers: occurrenceNoteGridsForBox(song, box) }));
  return firstDistinctMeasureNoteStacks(items);
}

export interface SectionNoteGridGroup {
  label: string;
  grids: ChordNoteHit[][];
}

export interface SectionNoteGrids {
  name: string;
  groups: SectionNoteGridGroup[];
}

export function sectionNoteGridCount(row: SectionNoteGrids): number {
  const keys = new Set<string>();
  for (const group of row.groups) {
    for (const hits of group.grids) keys.add(noteGridKey(hits));
  }
  return keys.size;
}

export function uniqueSectionNoteGrids(song: Song | undefined): SectionNoteGrids[] {
  if (!song) return [];
  const byName = new Map<string, Map<string, Map<string, ChordNoteHit[]>>>();
  const order: string[] = [];
  for (const item of editableNotaSections(song.sections ?? [])) {
    const section = song.sections[item.index];
    if (!section) continue;
    let occurrences = byName.get(item.name);
    if (!occurrences) {
      occurrences = new Map();
      byName.set(item.name, occurrences);
      order.push(item.name);
    }
    let seen = occurrences.get(item.label);
    if (!seen) {
      seen = new Map();
      occurrences.set(item.label, seen);
    }
    const measures = sectionMeasureNumbers([section], song.tempoMap, section.name);
    for (const measure of measures) {
      const hits = notesForBox(song, {
        name: item.name,
        measure,
        sectionIndex: item.index
      });
      if (hits.length === 0) continue;
      const key = noteGridKey(hits);
      if (!seen.has(key)) seen.set(key, hits);
    }
  }
  return order.flatMap((name) => {
    const occurrences = byName.get(name);
    if (!occurrences) return [];
    const merged = new Map<string, { labels: string[]; grids: ChordNoteHit[][] }>();
    const mergeOrder: string[] = [];
    for (const [label, grids] of occurrences) {
      if (grids.size === 0) continue;
      const key = [...grids.keys()].sort().join("\n");
      let entry = merged.get(key);
      if (!entry) {
        entry = { labels: [], grids: [...grids.values()] };
        merged.set(key, entry);
        mergeOrder.push(key);
      }
      entry.labels.push(label);
    }
    const groups = mergeOrder.map((key) => {
      const entry = merged.get(key);
      return { label: entry?.labels[0] ?? "", grids: entry?.grids ?? [] };
    });
    return groups.length > 0 ? [{ name, groups }] : [];
  });
}

function stepTone(step: number, steps: number): string {
  if (step % steps === 0) return " measure";
  if (step % STEPS_PER_BEAT === 0) return " beat";
  return "";
}

export function ChordNoteLane(props: {
  notes: ChordNoteHit[];
  steps?: number;
  className?: string;
}) {
  const steps = Math.max(STEPS_PER_BEAT, Math.round(props.steps ?? STEPS_PER_MEASURE));
  return (
    <div
      className={`chord-measure-notes${props.className ? ` ${props.className}` : ""}`}
      style={{ "--drum-steps": steps } as CSSProperties}
    >
      <div className="drum-lane chord-note-lane">
        {Array.from({ length: steps }, (_, step) => {
          const hit = props.notes.find((note) => note.step === step);
          return (
            <span
              key={step}
              data-note={hit?.lane}
              className={`drum-step${hit ? " hit" : ""}${stepTone(step, steps)}`}
            />
          );
        })}
      </div>
    </div>
  );
}
