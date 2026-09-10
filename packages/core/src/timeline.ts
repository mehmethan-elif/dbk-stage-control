import type { TempoPoint, Section } from "./models.js";

const DEFAULT_TEMPO: TempoPoint = {
  time: 0,
  measure: 1,
  bpm: 120,
  numerator: 4,
  denominator: 4
};

const MEASURE_EPS = 1e-9;
/** Section JSON is rounded; at 114 BPM a barline can sit ~0.2ms off the written start. */
const SECTION_BOUNDARY_EPS = 1e-3;

export function sectionNamed(section: Section | undefined, name: string): boolean {
  return section?.name.trim().toLocaleUpperCase("tr-TR") === name.trim().toLocaleUpperCase("tr-TR");
}

export function firstSectionNamed(sections: Section[] | undefined, name: string): boolean {
  return sectionNamed(sections?.[0], name);
}

export function nextSectionStart(sections: Section[] | undefined, time: number): number | undefined {
  if (!sections || sections.length === 0) return undefined;
  const current = sectionAt(sections, time);
  const following = sectionAfter(sections, current);
  if (following) return following.start;
  const later = sections.find((section) => section.start > time + 1e-6);
  return later?.start;
}

export function sectionBoundaryTimes(sections: Section[] | undefined): number[] {
  if (!sections || sections.length === 0) return [0];
  const times: number[] = [];
  for (const section of sections) {
    for (const time of [section.start, section.end]) {
      if (!times.some((existing) => Math.abs(existing - time) < 1e-6)) times.push(time);
    }
  }
  return times.sort((a, b) => a - b);
}

export function snapToSectionBoundary(sections: Section[] | undefined, time: number): number {
  return snapToMeasureStart(sectionBoundaryTimes(sections), time);
}

export function sectionForBoundary(
  sections: Section[] | undefined,
  time: number
): Section | undefined {
  if (!sections || sections.length === 0) return undefined;
  const starting = sections.find((section) => Math.abs(section.start - time) < 1e-6);
  if (starting) return starting;
  return [...sections].reverse().find((section) => Math.abs(section.end - time) < 1e-6);
}

export function snapToMeasureStart(starts: number[], time: number): number {
  if (starts.length === 0) return Math.max(0, time);
  let best = starts[0] ?? 0;
  for (const start of starts) {
    if (Math.abs(start - time) < Math.abs(best - time)) best = start;
  }
  return best;
}

export function nextMeasureStart(starts: number[], time: number, fallback?: number): number {
  for (const start of starts) {
    if (start > time + 1e-6) return start;
  }
  return fallback ?? starts[starts.length - 1] ?? Math.max(0, time);
}

export function panicDefaultTarget(
  sections: Section[] | undefined,
  measureStarts: number[],
  time: number
): number {
  const sectionStart = nextSectionStart(sections, time);
  if (sectionStart != null) return snapToMeasureStart(measureStarts, sectionStart);
  return nextMeasureStart(measureStarts, time);
}

export function sectionAfter(
  sections: Section[] | undefined,
  section: Section | undefined
): Section | undefined {
  if (!sections || !section) return undefined;
  const index = sections.findIndex(
    (item) =>
      item === section ||
      (item.start === section.start && item.end === section.end && item.name === section.name)
  );
  return index >= 0 ? sections[index + 1] : undefined;
}

export function secondsPerQuarter(bpm: number): number {
  return 60 / bpm;
}

function resolvedMeter(
  point: TempoPoint,
  inherited?: { numerator: number; denominator: number }
): { numerator: number; denominator: number } {
  const numerator =
    point.numerator > 0
      ? point.numerator
      : inherited?.numerator && inherited.numerator > 0
        ? inherited.numerator
        : 4;
  const denominator =
    point.denominator > 0
      ? point.denominator
      : inherited?.denominator && inherited.denominator > 0
        ? inherited.denominator
        : 4;
  return { numerator, denominator };
}

function withResolvedMeter(
  point: TempoPoint,
  inherited?: { numerator: number; denominator: number }
): TempoPoint {
  return { ...point, ...resolvedMeter(point, inherited) };
}

export function secondsPerMeasure(point: TempoPoint): number {
  const { numerator, denominator } = resolvedMeter(point);
  return numerator * secondsPerQuarter(point.bpm) * (4 / denominator);
}

export function secondsPerBeat(point: TempoPoint): number {
  const { numerator } = resolvedMeter(point);
  return secondsPerMeasure(point) / numerator;
}

export function measureStartTimes(map: TempoPoint[] | undefined, duration: number): number[] {
  const end = Math.max(0, duration);
  const points = map && map.length > 0 ? [...map].sort((a, b) => a.time - b.time) : [DEFAULT_TEMPO];
  const starts: number[] = [];
  let inherited = { numerator: 4, denominator: 4 };
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!point || point.time > end) continue;
    if (point.numerator > 0 && point.denominator > 0) {
      inherited = { numerator: point.numerator, denominator: point.denominator };
    }
    const segmentEnd = Math.min(end, points[index + 1]?.time ?? end);
    const length = secondsPerMeasure(withResolvedMeter(point, inherited));
    if (length <= 0) continue;
    const first = Math.max(0, point.time);
    const count = Math.max(0, Math.ceil((segmentEnd - first) / length - 1e-6));
    for (let i = 0; i < count; i++) {
      const time = first + i * length;
      if (time >= segmentEnd - 1e-6) break;
      if (!starts.some((existing) => Math.abs(existing - time) < 1e-6)) starts.push(time);
    }
  }
  if (starts.length === 0) starts.push(0);
  return starts.sort((a, b) => a - b);
}

export function tempoAt(map: TempoPoint[], time: number): TempoPoint {
  if (map.length === 0) return DEFAULT_TEMPO;
  let current = map[0] ?? DEFAULT_TEMPO;
  for (const point of map) {
    if (point.time <= time + 1e-9) current = point;
    else break;
  }
  return current;
}

export interface MusicalPosition {
  measure: number;
  beat: number;
}

export function timeToMusical(map: TempoPoint[], time: number): MusicalPosition {
  const points = map.length > 0 ? map : [DEFAULT_TEMPO];
  const t = Math.max(0, time);

  let active = points[0] ?? DEFAULT_TEMPO;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const next = points[i + 1];
    if (!point) continue;
    if (next && t >= next.time) {
      active = next;
      continue;
    }
    active = point;
    break;
  }

  let inherited = { numerator: 4, denominator: 4 };
  for (const point of points) {
    if (point.time > active.time + 1e-9) break;
    if (point.numerator > 0 && point.denominator > 0) {
      inherited = { numerator: point.numerator, denominator: point.denominator };
    }
  }
  const resolved = withResolvedMeter(active, inherited);
  const elapsed = t - active.time;
  const measureLen = secondsPerMeasure(resolved);
  const beatLen = secondsPerBeat(resolved);
  if (measureLen <= 0 || beatLen <= 0) {
    return { measure: active.measure, beat: 1 };
  }

  const measuresElapsed = elapsed / measureLen;
  const wholeMeasures = Math.floor(measuresElapsed + MEASURE_EPS);
  const remainder = elapsed - wholeMeasures * measureLen;
  const beat = 1 + remainder / beatLen;

  return {
    measure: active.measure + wholeMeasures,
    beat: Math.min(resolved.numerator + 0.999, Math.max(1, beat))
  };
}

export function measureRangeFill(
  map: TempoPoint[] | undefined,
  start: number,
  end: number,
  time: number
): number {
  if (time < start - 1e-6) return 0;
  if (time >= end - 1e-6) return 1;
  const points = map ?? [];
  const startMeasure = timeToMusical(points, start).measure;
  const last = Math.max(start, end - 0.02);
  const endMeasure = timeToMusical(points, last).measure;
  const currentMeasure = timeToMusical(points, Math.min(Math.max(time, start), last)).measure;
  const total = Math.max(1, endMeasure - startMeasure + 1);
  const number = Math.min(total, Math.max(1, currentMeasure - startMeasure + 1));
  return number / total;
}

function timeInSection(time: number, start: number, end: number): boolean {
  return time >= start - SECTION_BOUNDARY_EPS && time < end;
}

export function sectionAt(sections: Section[], time: number): Section | undefined {
  const next = sections.find(
    (section) => section.start > time && section.start - time <= SECTION_BOUNDARY_EPS
  );
  const at = next ? next.start : time;
  return sections.find((section) => timeInSection(at, section.start, section.end));
}

export function sectionIndexAt(sections: Section[], time: number): number {
  if (sections.length === 0) return -1;
  const next = sections.find(
    (section) => section.start > time && section.start - time <= SECTION_BOUNDARY_EPS
  );
  const at = next ? next.start : time;
  const found = sections.findIndex((section) => timeInSection(at, section.start, section.end));
  if (found >= 0) return found;
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i];
    if (section && at >= section.start) return i;
  }
  return 0;
}

const EVENT_BARLINE_SNAP_SEC = 0.05;

export function resolveTempoMeters(map: readonly TempoPoint[]): TempoPoint[] {
  let inherited = { numerator: 4, denominator: 4 };
  return map.map((point) => {
    if (point.numerator > 0 && point.denominator > 0) {
      inherited = { numerator: point.numerator, denominator: point.denominator };
      return { ...point, ...inherited };
    }
    return { ...point, ...inherited };
  });
}

function snapNearBarline(starts: number[], time: number, always: boolean): number {
  if (starts.length === 0) return time;
  const snapped = snapToMeasureStart(starts, time);
  if (always || Math.abs(snapped - time) <= EVENT_BARLINE_SNAP_SEC) return snapped;
  return time;
}

export function snapSongToMeasureGrid<
  T extends {
    duration: number;
    tempoMap: TempoPoint[];
    sections: Section[];
    lyrics?: { time: number; end?: number }[];
    chords?: { time: number; end?: number }[];
  }
>(song: T): T {
  const tempoMap = resolveTempoMeters(song.tempoMap);
  const gridEnd = Math.max(
    song.duration,
    song.sections.reduce((end, section) => Math.max(end, section.end), 0)
  );
  const starts = measureStartTimes(tempoMap, gridEnd);
  const sections = song.sections.map((section) => ({
    ...section,
    start: snapNearBarline(starts, section.start, true),
    end: snapNearBarline(starts, section.end, true)
  }));
  const measureLen = starts.length >= 2 ? starts[1]! - starts[0]! : 2;
  for (let index = 0; index < sections.length - 1; index++) {
    const current = sections[index];
    const next = sections[index + 1];
    if (!current || !next) continue;
    if (current.end > next.start || next.start - current.end < measureLen * 0.5) {
      current.end = next.start;
    }
    if (current.end <= current.start) current.end = next.start;
  }
  const snapEvent = <E extends { time: number; end?: number }>(event: E): E => ({
    ...event,
    time: snapNearBarline(starts, event.time, false),
    end: event.end != null ? snapNearBarline(starts, event.end, false) : event.end
  });
  return {
    ...song,
    tempoMap,
    sections,
    lyrics: song.lyrics?.map(snapEvent),
    chords: song.chords?.map(snapEvent)
  };
}

export function currentLyricIndex(lyrics: { time: number }[], time: number): number {
  let index = -1;
  for (let i = 0; i < lyrics.length; i++) {
    const line = lyrics[i];
    if (line && line.time <= time) index = i;
    else break;
  }
  return index;
}
