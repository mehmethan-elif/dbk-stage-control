import {
  createId,
  measureStartTimes,
  sectionIndexAt,
  timeToMusical,
  type Section,
  type Song,
  type TempoPoint
} from "@dbk/core";
import { readSongSettings, updateSongSettings } from "./song-settings";

export interface NotaSectionBox {
  id: string;
  name: string;
  measure: number;
  kind?: "label";
  label?: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  sectionIndex?: number;
}

export function isSectionLabel(box: Pick<NotaSectionBox, "kind">): boolean {
  return box.kind === "label";
}

export function sectionLabelText(box: Pick<NotaSectionBox, "name" | "label">): string {
  const text = box.label?.trim();
  return text || box.name;
}

export type NotaPlayHit = { name: string; measure: number; sectionIndex: number };

export type BrokenMeasureChain = { name: string; measure: number };

const MIN_W = 0.04;
const MIN_H = 0.03;
const TIME_EPS = 0.02;
export const FIRST_NOTA_RECT_WIDTH_PX = 180;
export const FIRST_NOTA_RECT_HEIGHT_PX = 70;
const FIRST_NOTA_RECT_GAP_PX = 8;

/** Exact song.json names only. SAN, SAN A, and SAN B are unrelated. */
export function sameSectionName(left: string, right: string): boolean {
  return left === right;
}

export function uniqueSectionNames(sections: Section[]): string[] {
  const names: string[] = [];
  for (const section of sections) {
    if (!names.includes(section.name)) names.push(section.name);
  }
  return names;
}

export function rectsForLiveSections(
  rects: readonly NotaSectionBox[],
  sections: readonly Section[]
): NotaSectionBox[] {
  if (sections.length === 0) return [...rects];
  const names = new Set(sections.map((section) => section.name).filter((name) => name.trim().length > 0));
  return rects.filter((box) => names.has(box.name));
}

export function isCountSectionName(name: string): boolean {
  return name.trim().toUpperCase() === "COUNT";
}

export function editableNotaSectionNames(sections: readonly Section[]): string[] {
  return uniqueSectionNames(sections.filter((section) => !isCountSectionName(section.name)));
}

export function sectionOccurrenceNumber(sections: readonly Section[], index: number): number {
  const name = sections[index]?.name;
  if (!name) return 0;
  let n = 0;
  for (let i = 0; i <= index; i++) {
    if (sameSectionName(sections[i]?.name ?? "", name)) n += 1;
  }
  return n;
}

export function sectionEditLabel(sections: readonly Section[], index: number): string {
  const name = sections[index]?.name ?? "";
  if (!name) return "";
  const repeats = sections.filter((section) => sameSectionName(section.name, name)).length > 1;
  if (!repeats) return name;
  return `${name}(${sectionOccurrenceNumber(sections, index)})`;
}

export function editableNotaSections(
  sections: readonly Section[]
): Array<{ index: number; name: string; label: string }> {
  return sections
    .map((section, index) => ({
      index,
      name: section.name,
      label: sectionEditLabel(sections, index)
    }))
    .filter((item) => !isCountSectionName(item.name));
}

export function firstIndexNamed(sections: readonly Section[], name: string): number {
  return sections.findIndex((section) => section.name === name);
}

export function isFirstNamedSection(sections: readonly Section[], index: number): boolean {
  const name = sections[index]?.name;
  return Boolean(name) && firstIndexNamed(sections, name) === index;
}

export function namedSectionIndexes(sections: readonly Section[], name: string): number[] {
  return sections.flatMap((section, index) => (sameSectionName(section.name, name) ? [index] : []));
}

export function canChainMeasure(sections: readonly Section[], name: string): boolean {
  return namedSectionIndexes(sections, name).length > 1;
}

export function parseBrokenChains(raw: unknown): BrokenMeasureChain[] {
  if (!raw || typeof raw !== "object") return [];
  const rows = (raw as { brokenChains?: unknown }).brokenChains;
  if (!Array.isArray(rows)) return [];
  const out: BrokenMeasureChain[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; measure?: unknown };
    const name = typeof row.name === "string" ? row.name : "";
    const measure = Number(row.measure);
    if (!name || !Number.isFinite(measure) || measure < 1) continue;
    const next = { name, measure: Math.round(measure) };
    if (out.some((existing) => existing.name === next.name && existing.measure === next.measure)) {
      continue;
    }
    out.push(next);
  }
  return out;
}

export function isMeasureChained(
  broken: readonly BrokenMeasureChain[],
  name: string,
  measure: number
): boolean {
  return !broken.some((item) => item.name === name && item.measure === measure);
}

export function effectiveBrokenChains(
  rects: readonly NotaSectionBox[],
  broken: readonly BrokenMeasureChain[]
): BrokenMeasureChain[] {
  if (rects.length === 0) return [];
  return broken.filter((item) =>
    rects.some((box) => box.name === item.name && box.measure === item.measure)
  );
}

export function correspondingMeasures(song: Song, name: string, localMeasure: number): number[] {
  const out: number[] = [];
  for (const section of song.sections) {
    if (section.name !== name) continue;
    const { start, total } = sectionMeasureSpan(section, song.tempoMap);
    if (localMeasure < 1 || localMeasure > total) continue;
    out.push(start + localMeasure - 1);
  }
  return out;
}

export function sectionMeasureSpan(
  section: Section,
  tempoMap: readonly TempoPoint[] | undefined
): { start: number; total: number } {
  const map = tempoMap ? [...tempoMap] : [];
  const first = Math.min(section.start + TIME_EPS, Math.max(section.start, section.end - TIME_EPS));
  const last = Math.max(section.start, section.end - TIME_EPS);
  const start = timeToMusical(map, first).measure;
  const end = timeToMusical(map, last).measure;
  return { start, total: Math.max(1, end - start + 1) };
}

export function boxAbsoluteMeasure(
  song: Song,
  box: Pick<NotaSectionBox, "name" | "measure" | "sectionIndex">
): number | undefined {
  const section =
    box.sectionIndex != null && song.sections[box.sectionIndex]?.name === box.name
      ? song.sections[box.sectionIndex]
      : song.sections.find((item) => item.name === box.name);
  if (!section) return undefined;
  const { start, total } = sectionMeasureSpan(section, song.tempoMap);
  if (box.measure <= 0) return start;
  return start + Math.min(total, Math.max(1, box.measure)) - 1;
}

export function sectionRelativeMeasure(
  section: Section,
  tempoMap: readonly TempoPoint[] | undefined,
  time: number
): number {
  const { start, total } = sectionMeasureSpan(section, tempoMap);
  const map = tempoMap ? [...tempoMap] : [];
  const last = Math.max(section.start, section.end - TIME_EPS);
  const first = Math.min(section.start + TIME_EPS, last);
  const current = timeToMusical(map, Math.min(Math.max(time, first), last)).measure;
  return Math.min(total, Math.max(1, current - start + 1));
}

export function sectionMeasureNumbers(
  sections: readonly Section[],
  tempoMap: readonly TempoPoint[] | undefined,
  name: string
): number[] {
  let total = 0;
  for (const section of sections) {
    if (section.name !== name) continue;
    total = Math.max(total, sectionMeasureSpan(section, tempoMap).total);
  }
  return Array.from({ length: total }, (_, index) => index + 1);
}

export function notaHitAt(song: Song | undefined, time: number): NotaPlayHit | undefined {
  if (!song) return undefined;
  const sectionIndex = sectionIndexAt(song.sections, time);
  const section = sectionIndex >= 0 ? song.sections[sectionIndex] : undefined;
  if (!section || isCountSectionName(section.name)) return undefined;
  return {
    name: section.name,
    measure: sectionRelativeMeasure(section, song.tempoMap, time),
    sectionIndex
  };
}

export function nextNotaHit(song: Song | undefined, time: number): NotaPlayHit | undefined {
  if (!song) return undefined;
  const starts = measureStartTimes(song.tempoMap, song.duration);
  for (const start of starts) {
    if (start <= time + 1e-6) continue;
    const hit = notaHitAt(song, start + TIME_EPS);
    if (hit) return hit;
  }
  return undefined;
}

/** Show the next rect when it starts a section, or when that next measure is unchained. */
export function nowLooksAheadHit(
  song: Song | undefined,
  time: number,
  broken: readonly BrokenMeasureChain[] = []
): NotaPlayHit | undefined {
  const following = nextNotaHit(song, time);
  if (!following) return undefined;
  if (following.measure === 1) return following;
  if (!isMeasureChained(broken, following.name, following.measure)) return following;
  return undefined;
}

export function notaSectionHitAt(song: Song | undefined, time: number): NotaPlayHit | undefined {
  if (!song) return undefined;
  const sectionIndex = sectionIndexAt(song.sections, time);
  const section = sectionIndex >= 0 ? song.sections[sectionIndex] : undefined;
  if (!section) return undefined;
  return {
    name: section.name,
    measure: sectionRelativeMeasure(section, song.tempoMap, time),
    sectionIndex
  };
}

export function nextNotaSectionHit(song: Song | undefined, time: number): NotaPlayHit | undefined {
  if (!song) return undefined;
  const current = sectionIndexAt(song.sections, time);
  if (current < 0) return undefined;
  const nextIndex = current + 1;
  const next = song.sections[nextIndex];
  if (!next) return undefined;
  return {
    name: next.name,
    measure: 1,
    sectionIndex: nextIndex
  };
}

export function measureRectsForSection(
  rects: readonly NotaSectionBox[],
  hit: NotaPlayHit | undefined,
  broken: readonly BrokenMeasureChain[] = []
): NotaSectionBox[] {
  if (!hit) return [];
  return rectsForSectionOccurrence(rects, hit.name, hit.sectionIndex, broken).filter(
    (box) => !isSectionLabel(box)
  );
}

export function notaSectionScrollTargets(
  song: Song | undefined,
  time: number,
  rects: readonly NotaSectionBox[],
  broken: readonly BrokenMeasureChain[] = []
): {
  current: NotaSectionBox[];
  next: NotaSectionBox[];
  focus: NotaSectionBox[];
} {
  const measureHit = notaHitAt(song, time);
  const sectionHit = notaSectionHitAt(song, time);
  const nextMeasure = nextNotaHit(song, time);
  const lookAhead = nowLooksAheadHit(song, time, broken);
  const measureBoxes = (hit: NotaPlayHit | undefined) =>
    rectsForHit(rects, hit, broken).filter((box) => !isSectionLabel(box));
  const current = measureBoxes(measureHit);
  const focused = current.length > 0 ? current : measureBoxes(sectionHit);
  const next = lookAhead ? measureBoxes(lookAhead) : measureBoxes(nextMeasure);
  return { current: focused, next, focus: focused };
}

export function rectsForHit(
  rects: readonly NotaSectionBox[],
  hit: NotaPlayHit | undefined,
  broken: readonly BrokenMeasureChain[] = []
): NotaSectionBox[] {
  if (!hit) return [];
  const exact = rects.filter(
    (box) => !isSectionLabel(box) && box.name === hit.name && box.measure === hit.measure
  );
  const chained = isMeasureChained(broken, hit.name, hit.measure);
  const scoped = chained
    ? exact.filter((box) => box.sectionIndex == null)
    : exact.filter((box) => box.sectionIndex === hit.sectionIndex);
  const found =
    scoped.length > 0 ? scoped : exact.filter((box) => box.sectionIndex == null);
  if (found.length > 0) return found;
  if (exact.length > 0) return exact;
  return rects.filter(
    (box) => !isSectionLabel(box) && box.name === hit.name && box.measure <= 0
  );
}

export function boxForOccurrence(
  rects: readonly NotaSectionBox[],
  name: string,
  measure: number,
  sectionIndex: number,
  chained: boolean
): NotaSectionBox | undefined {
  const matches = rects.filter(
    (box) => !isSectionLabel(box) && box.name === name && box.measure === measure
  );
  if (chained) {
    return matches.find((box) => box.sectionIndex == null) ?? matches[0];
  }
  return (
    matches.find((box) => box.sectionIndex === sectionIndex) ??
    matches.find((box) => box.sectionIndex == null)
  );
}

export function rectsForSectionOccurrence(
  rects: readonly NotaSectionBox[],
  name: string,
  sectionIndex: number,
  broken: readonly BrokenMeasureChain[] = []
): NotaSectionBox[] {
  return rects.filter((box) => {
    if (box.name !== name) return false;
    if (box.sectionIndex === sectionIndex) return true;
    if (box.sectionIndex != null) return false;
    if (isSectionLabel(box)) return true;
    return isMeasureChained(broken, box.name, box.measure);
  });
}

export function clampNotaPage(page: number, lastPage: number): number {
  return Math.min(Math.max(0, Math.round(page)), Math.max(0, lastPage));
}

export function clampNotaBox(box: NotaSectionBox): NotaSectionBox {
  const minW = isSectionLabel(box) ? 0.02 : MIN_W;
  const minH = isSectionLabel(box) ? 0.018 : MIN_H;
  const w = Math.min(1, Math.max(minW, box.w));
  const h = Math.min(1, Math.max(minH, box.h));
  const next: NotaSectionBox = {
    id: box.id,
    name: box.name,
    measure: isSectionLabel(box) ? 0 : Math.max(0, Math.round(box.measure)),
    page: Math.max(0, Math.round(box.page)),
    w,
    h,
    x: Math.min(1 - w, Math.max(0, box.x)),
    y: Math.min(1 - h, Math.max(0, box.y))
  };
  if (isSectionLabel(box)) next.kind = "label";
  const label = box.label?.trim();
  if (label) next.label = label;
  if (box.sectionIndex != null && Number.isFinite(box.sectionIndex)) {
    next.sectionIndex = Math.max(0, Math.round(box.sectionIndex));
  }
  return next;
}

function similarBox(a: NotaSectionBox, b: NotaSectionBox): boolean {
  return (
    a.name === b.name &&
    a.measure === b.measure &&
    a.page === b.page &&
    Math.abs(a.x - b.x) < 0.04 &&
    Math.abs(a.y - b.y) < 0.04 &&
    Math.abs(a.w - b.w) < 0.04 &&
    Math.abs(a.h - b.h) < 0.04
  );
}

export function parseNotaSections(raw: unknown, sections: Section[] = []): NotaSectionBox[] {
  if (!raw || typeof raw !== "object") return [];
  const rects = (raw as { rects?: unknown }).rects;
  if (!Array.isArray(rects)) return [];
  const migrated = rects.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return typeof row.name !== "string" || row.name.length === 0;
  });
  const out: NotaSectionBox[] = [];
  for (const item of rects) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const page = Number(row.page);
    const x = Number(row.x);
    const y = Number(row.y);
    const w = Number(row.w);
    const h = Number(row.h);
    if (![page, x, y, w, h].every(Number.isFinite)) continue;
    let name = typeof row.name === "string" ? row.name : "";
    if (!name) {
      const sectionIndex = Number(row.sectionIndex);
      name = Number.isFinite(sectionIndex) ? (sections[sectionIndex]?.name ?? "") : "";
    }
    if (!name) continue;
    const id = typeof row.id === "string" && row.id ? row.id : createId("rect");
    const measureRaw = Number(row.measure);
    const measure = Number.isFinite(measureRaw) ? measureRaw : 0;
    const owned = typeof row.name === "string" && row.name.length > 0 ? Number(row.sectionIndex) : NaN;
    const kind = row.kind === "label" ? "label" : undefined;
    const label = typeof row.label === "string" ? row.label : undefined;
    const box = clampNotaBox({
      id,
      name,
      measure: kind === "label" ? 0 : measure,
      kind,
      label,
      page,
      x,
      y,
      w,
      h,
      ...(Number.isFinite(owned) ? { sectionIndex: owned } : {})
    });
    if (migrated && out.some((existing) => similarBox(existing, box))) continue;
    out.push(box);
  }
  return dedupeNotaRects(out);
}

const notaLayoutMemory = new Map<string, { rects: NotaSectionBox[]; brokenChains: BrokenMeasureChain[] }>();

export function rememberNotaLayout(
  songId: string,
  rects: NotaSectionBox[],
  brokenChains: BrokenMeasureChain[] = []
): void {
  const previous = notaLayoutMemory.get(songId);
  if (previous && losesMeasureLayout(previous.rects, rects)) return;
  notaLayoutMemory.set(songId, { rects, brokenChains });
}

export function peekNotaLayout(songId: string) {
  return notaLayoutMemory.get(songId);
}

export function clearNotaLayoutMemory(): void {
  notaLayoutMemory.clear();
}

export function preferNotaLayout(
  cached: { rects: NotaSectionBox[]; brokenChains: BrokenMeasureChain[] } | undefined,
  disk: { rects: NotaSectionBox[]; brokenChains: BrokenMeasureChain[] }
): { rects: NotaSectionBox[]; brokenChains: BrokenMeasureChain[] } {
  const diskMeasures = disk.rects.filter((box) => !isSectionLabel(box)).length;
  const cacheMeasures = cached?.rects.filter((box) => !isSectionLabel(box)).length ?? 0;
  if (cached && cacheMeasures >= diskMeasures) return cached;
  return disk;
}

export async function loadNotaLayout(
  songId: string,
  sections: Section[] = []
): Promise<{ rects: NotaSectionBox[]; brokenChains: BrokenMeasureChain[] }> {
  const cached = notaLayoutMemory.get(songId);
  try {
    const settings = await readSongSettings(songId);
    const rects = rectsForLiveSections(parseNotaSections(settings.notaSections, sections), sections);
    const disk = {
      rects,
      brokenChains: effectiveBrokenChains(rects, parseBrokenChains(settings.notaSections))
    };
    const layout = preferNotaLayout(cached, disk);
    rememberNotaLayout(songId, layout.rects, layout.brokenChains);
    return layout;
  } catch {
    return cached ?? { rects: [], brokenChains: [] };
  }
}

export async function loadNotaSections(songId: string, sections: Section[] = []): Promise<NotaSectionBox[]> {
  return (await loadNotaLayout(songId, sections)).rects;
}

type PendingNotaSave = {
  rects: NotaSectionBox[];
  touched: Set<string>;
  brokenChains?: BrokenMeasureChain[];
};

const pendingNotaSaves = new Map<string, PendingNotaSave>();

export function touchedNotaNames(
  previous: readonly NotaSectionBox[],
  next: readonly NotaSectionBox[]
): Set<string> {
  const names = new Set(next.map((box) => box.name));
  const nextNames = new Set(names);
  for (const box of previous) {
    if (!nextNames.has(box.name)) names.add(box.name);
  }
  return names;
}

export function mergeNotaRects(
  base: readonly NotaSectionBox[],
  incoming: readonly NotaSectionBox[],
  touched: ReadonlySet<string>
): NotaSectionBox[] {
  const kept = base.filter((box) => !touched.has(box.name));
  const overlay = incoming.filter((box) => touched.has(box.name));
  const incomingMeasures = overlay.filter((box) => !isSectionLabel(box));
  const rescued: NotaSectionBox[] = [];
  if (incoming.length > 0 && incomingMeasures.length === 0) {
    rescued.push(...base.filter((box) => !isSectionLabel(box)));
  } else {
    for (const name of touched) {
      const incomingForName = overlay.filter((box) => box.name === name);
      const incomingForNameMeasures = incomingForName.filter((box) => !isSectionLabel(box));
      const baseMeasures = base.filter((box) => box.name === name && !isSectionLabel(box));
      if (incomingForName.length > 0 && incomingForNameMeasures.length === 0 && baseMeasures.length > 0) {
        rescued.push(...baseMeasures);
      }
    }
  }
  return dedupeNotaRects([...overlay, ...rescued, ...kept]);
}

function serializeNotaRects(rects: readonly NotaSectionBox[]) {
  return rects.map((box) => {
    const next = clampNotaBox(box);
    return {
      id: next.id,
      name: next.name,
      measure: next.measure,
      ...(next.kind === "label" ? { kind: "label" as const } : {}),
      ...(next.label ? { label: next.label } : {}),
      page: next.page,
      x: next.x,
      y: next.y,
      w: next.w,
      h: next.h,
      ...(next.sectionIndex != null ? { sectionIndex: next.sectionIndex } : {})
    };
  });
}

function serializeBrokenChains(chains: readonly BrokenMeasureChain[]) {
  return chains.map((item) => ({ name: item.name, measure: item.measure }));
}

export async function saveNotaSections(
  songId: string,
  rects: NotaSectionBox[],
  touchedNames?: Iterable<string>,
  brokenChains?: BrokenMeasureChain[]
): Promise<void> {
  const touched = new Set(touchedNames ?? rects.map((box) => box.name));
  const previous = pendingNotaSaves.get(songId);
  if (previous) {
    for (const name of previous.touched) touched.add(name);
    pendingNotaSaves.set(songId, {
      rects: mergeNotaRects(previous.rects, rects, new Set(touchedNames ?? rects.map((box) => box.name))),
      touched,
      brokenChains: brokenChains ?? previous.brokenChains
    });
  } else {
    pendingNotaSaves.set(songId, { rects, touched, brokenChains });
  }
  await updateSongSettings(songId, (settings) => {
    const latest = pendingNotaSaves.get(songId) ?? { rects, touched, brokenChains };
    const disk = parseNotaSections(settings.notaSections);
    const merged = mergeNotaRects(disk, latest.rects, latest.touched);
    if (losesMeasureLayout(disk, merged)) {
      return settings;
    }
    const chains = latest.brokenChains ?? parseBrokenChains(settings.notaSections);
    return {
      ...settings,
      notaSections: {
        version: 1,
        rects: serializeNotaRects(merged),
        brokenChains: serializeBrokenChains(effectiveBrokenChains(latest.rects, chains))
      }
    };
  });
  pendingNotaSaves.delete(songId);
}

export function upsertNotaBox(rects: NotaSectionBox[], box: NotaSectionBox): NotaSectionBox[] {
  const next = clampNotaBox(box);
  const index = rects.findIndex((item) => item.id === next.id);
  const replaced = index < 0 ? [...rects, next] : rects.map((item, i) => (i === index ? next : item));
  return dedupeNotaRects(replaced);
}

export function hasNotaBox(
  rects: readonly NotaSectionBox[],
  name: string,
  measure: number,
  sectionIndex?: number,
  broken: readonly BrokenMeasureChain[] = []
): boolean {
  const index = sectionIndex ?? -1;
  const chained = sectionIndex == null || isMeasureChained(broken, name, measure);
  return boxForOccurrence(rects, name, measure, index, chained) != null;
}

export function nextEmptySectionMeasure(
  measures: readonly number[],
  rects: readonly NotaSectionBox[],
  name: string,
  preferred = 0,
  opts?: { sectionIndex?: number; broken?: readonly BrokenMeasureChain[] }
): number | undefined {
  const empty = (measure: number) =>
    !hasNotaBox(rects, name, measure, opts?.sectionIndex, opts?.broken);
  if (preferred > 0 && measures.includes(preferred) && empty(preferred)) return preferred;
  const after = measures.find((measure) => measure > preferred && empty(measure));
  if (after != null) return after;
  return measures.find(empty);
}

export function previousNotaBox(
  rects: readonly NotaSectionBox[],
  name: string,
  measure: number,
  sectionIndex?: number,
  broken: readonly BrokenMeasureChain[] = []
): NotaSectionBox | undefined {
  const index = sectionIndex ?? -1;
  if (measure > 1) {
    const previous = boxForOccurrence(
      rects,
      name,
      measure - 1,
      index,
      isMeasureChained(broken, name, measure - 1)
    );
    if (previous) return previous;
  }
  const same = rectsForSectionOccurrence(rects, name, index, broken)
    .filter((box) => box.measure > 0 && box.measure < measure)
    .sort((a, b) => a.measure - b.measure);
  return same.at(-1);
}

export function boxBesidePrevious(
  previous: NotaSectionBox,
  rects: readonly NotaSectionBox[] = [],
  lastPage?: number
): Pick<NotaSectionBox, "page" | "x" | "y" | "w" | "h"> {
  const w = previous.w;
  const h = previous.h;
  let page = previous.page;
  let x = previous.x + previous.w;
  let y = previous.y;
  const row = rects.filter(
    (box) =>
      !isSectionLabel(box) &&
      box.name === previous.name &&
      box.page === previous.page &&
      Math.abs(box.y - previous.y) < 0.02
  );
  const rowX = row.length > 0 ? Math.min(...row.map((box) => box.x)) : previous.x;
  if (x + w > 1 + 1e-6) {
    x = rowX;
    y = previous.y + previous.h;
    if (y + h > 1 + 1e-6) {
      const origin =
        [...rects]
          .filter((box) => box.name === previous.name)
          .sort((a, b) => a.page - b.page || a.measure - b.measure)[0] ?? previous;
      const nextPage = previous.page + 1;
      if (lastPage != null && nextPage > lastPage) {
        page = previous.page;
        x = rowX;
        y = Math.min(1 - h, origin.y);
      } else {
        page = nextPage;
        x = origin.x;
        y = origin.y;
      }
    }
  }
  return { page, x, y, w, h };
}

export function createNotaBox(
  name: string,
  measure: number,
  page: number,
  rects: readonly NotaSectionBox[] = [],
  lastPage?: number,
  sectionIndex?: number,
  broken: readonly BrokenMeasureChain[] = [],
  pageSize?: { width: number; height: number }
): NotaSectionBox {
  const previous = previousNotaBox(rects, name, measure, sectionIndex, broken);
  const stampIndex = sectionIndex != null && !isMeasureChained(broken, name, measure);
  if (!previous) {
    return defaultNotaBox(
      name,
      page,
      0,
      measure,
      stampIndex ? sectionIndex : undefined,
      rects,
      pageSize
    );
  }
  return clampNotaBox({
    id: createId("rect"),
    name,
    measure,
    ...boxBesidePrevious(previous, rects, lastPage),
    ...(stampIndex ? { sectionIndex } : {})
  });
}

export function addNotaBox(
  rects: readonly NotaSectionBox[],
  name: string,
  measure: number,
  page: number,
  lastPage?: number,
  sectionIndex?: number,
  broken: readonly BrokenMeasureChain[] = [],
  pageSize?: { width: number; height: number }
): { rects: NotaSectionBox[]; box: NotaSectionBox } | undefined {
  if (!name || measure < 1 || hasNotaBox(rects, name, measure, sectionIndex, broken)) {
    return undefined;
  }
  const box = createNotaBox(name, measure, page, rects, lastPage, sectionIndex, broken, pageSize);
  return { rects: [...rects, box], box };
}

export function hasSectionLabel(rects: readonly NotaSectionBox[], name: string): boolean {
  return rects.some((box) => isSectionLabel(box) && box.name === name);
}

function sectionLabelSize(name: string): { w: number; h: number } {
  const text = name.trim() || name;
  return {
    w: Math.min(0.2, Math.max(0.04, text.length * 0.012)),
    h: 0.032
  };
}

export function firstSectionMeasureBox(
  rects: readonly NotaSectionBox[],
  name: string
): NotaSectionBox | undefined {
  const measures = rects.filter(
    (box) => !isSectionLabel(box) && box.name === name && box.measure > 0
  );
  const firsts = measures.filter((box) => box.measure === 1);
  const pool = firsts.length > 0 ? firsts : measures;
  return [...pool].sort(
    (a, b) =>
      a.measure - b.measure ||
      (a.sectionIndex ?? Infinity) - (b.sectionIndex ?? Infinity) ||
      a.page - b.page ||
      a.y - b.y ||
      a.x - b.x
  )[0];
}

export function createSectionLabelBox(
  name: string,
  page = 0,
  x = 0.04,
  y = 0.06,
  sectionIndex?: number
): NotaSectionBox {
  const text = name.trim() || name;
  const { w, h } = sectionLabelSize(name);
  return clampNotaBox({
    id: createId("rect"),
    name,
    measure: 0,
    kind: "label",
    label: text,
    page,
    x: Math.max(0, x),
    y: Math.max(0, Math.min(1 - h, y)),
    w,
    h,
    ...(sectionIndex != null ? { sectionIndex } : {})
  });
}

export function createSectionLabelBeside(
  name: string,
  measureBox: Pick<NotaSectionBox, "page" | "x" | "y" | "h">
): NotaSectionBox {
  const { w, h } = sectionLabelSize(name);
  let x = measureBox.x - w - 0.01;
  let y = measureBox.y;
  if (x < 0) {
    x = Math.max(0, measureBox.x);
    y = Math.max(0, measureBox.y - h - 0.008);
  }
  return createSectionLabelBox(name, measureBox.page, x, y);
}

/** Persist only when boxes were added. Dropping leftover names must not rewrite the file. */
export function shouldPersistNotaLayout(
  previous: readonly NotaSectionBox[],
  next: readonly NotaSectionBox[]
): boolean {
  if (!previous.some((box) => !isSectionLabel(box))) return false;
  if (losesMeasureLayout(previous, next)) return false;
  const previousIds = new Set(previous.map((box) => box.id));
  return next.some((box) => !previousIds.has(box.id));
}

/** True when a label rewrite would replace a measured layout with leftover crumbs. */
export function losesMeasureLayout(
  previous: readonly NotaSectionBox[],
  next: readonly NotaSectionBox[]
): boolean {
  const previousMeasures = previous.filter((box) => !isSectionLabel(box)).length;
  const nextMeasures = next.filter((box) => !isSectionLabel(box)).length;
  if (previousMeasures === 0 || next.length === 0) return false;
  if (nextMeasures === 0) return true;
  const nextLabels = next.filter(isSectionLabel).length;
  return nextLabels > 0 && nextMeasures < previousMeasures && nextMeasures / previousMeasures <= 0.25;
}

export function ensureSectionLabels(
  rects: readonly NotaSectionBox[],
  sections: readonly Section[],
  page = 0
): NotaSectionBox[] | undefined {
  const live = rectsForLiveSections(rects, sections);
  const missing = editableNotaSectionNames(sections).filter((name) => !hasSectionLabel(live, name));
  if (missing.length === 0) return live.length === rects.length ? undefined : live;
  let stacked = live.filter(isSectionLabel).length;
  const added = missing.map((name) => {
    const first = firstSectionMeasureBox(live, name);
    if (first) return createSectionLabelBeside(name, first);
    const box = createSectionLabelBox(name, page, 0.04, Math.min(0.88, 0.06 + stacked * 0.048));
    stacked += 1;
    return box;
  });
  return [...live, ...added];
}

export function dedupeNotaRects(rects: readonly NotaSectionBox[]): NotaSectionBox[] {
  const seen = new Map<string, number>();
  const out: NotaSectionBox[] = [];
  for (const box of rects) {
    const key = isSectionLabel(box)
      ? box.sectionIndex == null
        ? `label\0${box.name}`
        : `label\0${box.name}\0${box.sectionIndex}`
      : box.sectionIndex == null
        ? `${box.name}\0${box.measure}`
        : `${box.name}\0${box.measure}\0${box.sectionIndex}`;
    const existing = seen.get(key);
    if (existing == null) {
      seen.set(key, out.length);
      out.push(box);
      continue;
    }
    if (box.measure > 0) out[existing] = box;
    else out.push(box);
  }
  return out;
}

export function breakMeasureChain(
  rects: readonly NotaSectionBox[],
  sections: readonly Section[],
  name: string,
  measure: number
): NotaSectionBox[] {
  const indexes = namedSectionIndexes(sections, name);
  if (indexes.length < 2) return [...rects];
  const existing = rects.filter((box) => box.name === name && box.measure === measure);
  const shared =
    existing.find((box) => box.sectionIndex == null) ??
    existing.find((box) => box.sectionIndex === indexes[0]);
  const kept = rects.filter((box) => !(box.name === name && box.measure === measure));
  if (!shared && existing.length === 0) return [...rects];
  const next = [...kept];
  indexes.forEach((index, order) => {
    const own = existing.find((box) => box.sectionIndex === index);
    if (own) {
      next.push(clampNotaBox({ ...own, sectionIndex: index }));
      return;
    }
    if (!shared) return;
    next.push(
      clampNotaBox({
        ...shared,
        id: index === indexes[0] ? shared.id : createId("rect"),
        sectionIndex: index
      })
    );
  });
  return dedupeNotaRects(next);
}

export function applyChainedRectGeometry(
  rects: readonly NotaSectionBox[],
  source: NotaSectionBox
): NotaSectionBox[] {
  if (isSectionLabel(source)) return upsertNotaBox([...rects], source);
  const geometry = {
    page: source.page,
    x: source.x,
    y: source.y,
    w: source.w,
    h: source.h
  };
  let found = false;
  const next = rects.map((box) => {
    if (box.id === source.id) {
      found = true;
      return clampNotaBox(source);
    }
    if (box.name !== source.name || box.measure !== source.measure) return box;
    found = true;
    return clampNotaBox({ ...box, ...geometry });
  });
  return found ? dedupeNotaRects(next) : upsertNotaBox([...rects], source);
}

export function linkMeasureChain(
  rects: readonly NotaSectionBox[],
  sections: readonly Section[],
  name: string,
  measure: number,
  sourceSectionIndex: number
): NotaSectionBox[] {
  const existing = rects.filter((box) => box.name === name && box.measure === measure);
  const source =
    existing.find((box) => box.sectionIndex === sourceSectionIndex) ??
    existing.find((box) => box.sectionIndex == null) ??
    existing[0];
  const kept = rects.filter((box) => !(box.name === name && box.measure === measure));
  if (!source) return kept;
  return dedupeNotaRects([
    ...kept,
    clampNotaBox({
      ...source,
      sectionIndex: undefined
    })
  ]);
}

export function firstNotaRectSize(page?: { width: number; height: number }): { w: number; h: number } {
  const width = page?.width && page.width > 0 ? page.width : 900;
  const height = page?.height && page.height > 0 ? page.height : 1165;
  return {
    w: Math.min(0.95, FIRST_NOTA_RECT_WIDTH_PX / width),
    h: Math.min(0.95, FIRST_NOTA_RECT_HEIGHT_PX / height)
  };
}

export function sectionLabelForName(
  rects: readonly NotaSectionBox[],
  name: string,
  sectionIndex?: number
): NotaSectionBox | undefined {
  const labels = rects.filter((box) => isSectionLabel(box) && box.name === name);
  if (sectionIndex != null) {
    const owned = labels.find((box) => box.sectionIndex === sectionIndex);
    if (owned) return owned;
  }
  return labels.find((box) => box.sectionIndex == null) ?? labels[0];
}

export function defaultNotaBox(
  name: string,
  page: number,
  existing = 0,
  measure = 0,
  sectionIndex?: number,
  rects: readonly NotaSectionBox[] = [],
  pageSize?: { width: number; height: number }
): NotaSectionBox {
  const { w, h } = firstNotaRectSize(pageSize);
  const label = sectionLabelForName(rects, name, sectionIndex);
  if (label) {
    const gap = pageSize && pageSize.width > 0 ? FIRST_NOTA_RECT_GAP_PX / pageSize.width : 0.01;
    let x = label.x + label.w + gap;
    let y = label.y;
    if (x + w > 1 + 1e-6) {
      x = Math.min(1 - w, Math.max(0, label.x));
      y = label.y + Math.max(label.h, 0) + gap;
    }
    return clampNotaBox({
      id: createId("rect"),
      name,
      measure,
      page: label.page,
      x,
      y,
      w,
      h,
      ...(sectionIndex != null ? { sectionIndex } : {})
    });
  }
  return clampNotaBox({
    id: createId("rect"),
    name,
    measure,
    page,
    x: 0.06,
    y: Math.min(0.78, 0.08 + existing * 0.16),
    w,
    h,
    ...(sectionIndex != null ? { sectionIndex } : {})
  });
}
