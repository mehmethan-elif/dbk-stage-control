import type { TempoPoint, Section } from "./models.js";

const DEFAULT_TEMPO: TempoPoint = {
  time: 0,
  measure: 1,
  bpm: 120,
  numerator: 4,
  denominator: 4
};

export function sectionNamed(section: Section | undefined, name: string): boolean {
  return section?.name.trim().toLocaleUpperCase("tr-TR") === name.trim().toLocaleUpperCase("tr-TR");
}

export function firstSectionNamed(sections: Section[] | undefined, name: string): boolean {
  return sectionNamed(sections?.[0], name);
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

export function secondsPerMeasure(point: TempoPoint): number {
  return point.numerator * secondsPerQuarter(point.bpm) * (4 / point.denominator);
}

export function secondsPerBeat(point: TempoPoint): number {
  return secondsPerMeasure(point) / point.numerator;
}

export function measureStartTimes(map: TempoPoint[], duration: number): number[] {
  const end = Math.max(0, duration);
  const points = map.length > 0 ? [...map].sort((a, b) => a.time - b.time) : [DEFAULT_TEMPO];
  const starts: number[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!point || point.time > end) continue;
    const segmentEnd = Math.min(end, points[index + 1]?.time ?? end);
    const length = secondsPerMeasure(point);
    if (length <= 0) continue;
    for (let time = Math.max(0, point.time); time < segmentEnd - 1e-6; time += length) {
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

  const elapsed = t - active.time;
  const measureLen = secondsPerMeasure(active);
  const beatLen = secondsPerBeat(active);
  if (measureLen <= 0 || beatLen <= 0) {
    return { measure: active.measure, beat: 1 };
  }

  const measuresElapsed = elapsed / measureLen;
  const wholeMeasures = Math.floor(measuresElapsed);
  const remainder = elapsed - wholeMeasures * measureLen;
  const beat = 1 + remainder / beatLen;

  return {
    measure: active.measure + wholeMeasures,
    beat: Math.min(active.numerator + 0.999, Math.max(1, beat))
  };
}

export function sectionAt(sections: Section[], time: number): Section | undefined {
  return sections.find((section) => time >= section.start && time < section.end);
}

export function sectionIndexAt(sections: Section[], time: number): number {
  if (sections.length === 0) return -1;
  const found = sections.findIndex((section) => time >= section.start && time < section.end);
  if (found >= 0) return found;
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i];
    if (section && time >= section.start) return i;
  }
  return 0;
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
