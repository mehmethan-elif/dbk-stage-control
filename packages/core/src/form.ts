import type { ChordEvent, Section, Song } from "./models.js";
import { secondsPerMeasure, timeToMusical } from "./timeline.js";

const TIME_EPS = 0.02;

export type FormJump = "none" | "repeat" | "ds" | "coda";

export interface FormBlock {
  id: string;
  name: string;
  originIndex: number;
  originStart: number;
  originEnd: number;
  segno: boolean;
  coda: boolean;
  toCoda: boolean;
  toCodaAt?: number;
  ds: boolean;
  repeatStart: boolean;
  repeatEnd: boolean;
}

export interface FormVisit {
  blockId: string;
  start: number;
  end: number;
  pass: number;
  fromJump: FormJump;
}

export interface SongForm {
  blocks: FormBlock[];
  visits: FormVisit[];
}

export interface SongFormOptions {
  identity?: "arrangement" | "chords" | "names" | "drums";
  foldInnerRepeats?: boolean;
}

export interface FormPosition {
  visit: FormVisit;
  block: FormBlock;
  originTime: number;
}

function sectionList(song: Song): Section[] {
  return song.sections.length > 0 ? song.sections : [{ name: "", start: 0, end: song.duration }];
}

function blockKey(section: Section, index: number): string {
  const name = section.name.trim();
  return name || `_${index}`;
}

function nameKey(name: string, index: number): string {
  const trimmed = name.trim();
  return trimmed || `_${index}`;
}

function patternGridKey(pattern: { time: number; end: number; notes?: { time: number; pitch: number }[] }): string {
  const span = Math.max(TIME_EPS, pattern.end - pattern.time);
  return (pattern.notes ?? [])
    .map((note) => {
      const step = Math.round(((note.time - pattern.time) / span) * 16);
      const pc = ((note.pitch % 12) + 12) % 12;
      return `${step}:${pc}`;
    })
    .sort()
    .join(",");
}

function sectionGroove(song: Song, section: Section, identity: SongFormOptions["identity"]): string {
  if (identity === "names") return "";
  if (identity !== "chords") {
    const patterns = (song.patterns ?? [])
      .filter((pattern) => pattern.time >= section.start - TIME_EPS && pattern.time < section.end - TIME_EPS)
      .map((pattern) => {
        const text = pattern.text.trim().toUpperCase();
        if (!text || text === "FILL") return "";
        if (identity === "drums") {
          const grid = patternGridKey(pattern);
          return grid ? `${text}[${grid}]` : text;
        }
        return text;
      })
      .filter((text) => text.length > 0);
    if (patterns.length > 0) return `p:${patterns.join("|")}`;
    if (identity === "drums") return "";
  }
  const chords = (song.chords ?? [])
    .filter((chord) => chord.time >= section.start - TIME_EPS && chord.time < section.end - TIME_EPS)
    .map((chord) => {
      const text = chord.text.trim();
      if (!text || text === "-") return "";
      const offset = (chord.time - section.start).toFixed(4);
      const notes = (chord.notes ?? [])
        .map((note) => `${(note.time - section.start).toFixed(4)}:${note.pitch}`)
        .join(",");
      return `${offset}:${text}[${notes}]`;
    })
    .filter(Boolean);
  if (chords.length > 0) return `c:${chords.join("|")}`;
  return "";
}

function runOffset(sections: Section[], index: number, key: string): number {
  let offset = 0;
  for (let cursor = index; cursor >= 0; cursor--) {
    const section = sections[cursor];
    if (!section || blockKey(section, cursor) !== key) break;
    if (cursor < index) offset += 1;
  }
  return offset;
}

function groovesMatch(written: string | undefined, current: string): boolean {
  if (written === current) return true;
  if (!written?.startsWith("c:") || !current.startsWith("c:")) return false;
  return written.startsWith(`${current}|`);
}

function matchWrittenBlock(
  blocks: FormBlock[],
  grooves: Map<string, string>,
  key: string,
  groove: string,
  previousKey: string | undefined,
  previousBlock: FormBlock | undefined,
  offset: number
): FormBlock | undefined {
  const same = blocks.filter((block) => nameKey(block.name, block.originIndex) === key);
  if (previousKey === key) {
    return offset < same.length ? same[offset] : undefined;
  }
  if (previousBlock) {
    const byContext = same.find((block) => {
      const blockIndex = blocks.indexOf(block);
      const writtenPrevious = blocks[blockIndex - 1];
      return (
        writtenPrevious?.id === previousBlock.id &&
        (!groove || groovesMatch(grooves.get(block.id), groove))
      );
    });
    if (byContext) return byContext;

    const contextAlreadyWritten = same.some((block) => {
      const blockIndex = blocks.indexOf(block);
      const writtenPrevious = blocks[blockIndex - 1];
      return (
        writtenPrevious != null &&
        nameKey(writtenPrevious.name, writtenPrevious.originIndex) === previousKey
      );
    });
    if (contextAlreadyWritten) return undefined;
  }
  if (groove) {
    const byGroove = same.find((block) => groovesMatch(grooves.get(block.id), groove));
    if (byGroove) return byGroove;
    return undefined;
  }
  return same[0];
}

function matchAfterDs(
  blocks: FormBlock[],
  key: string,
  previousBlock: FormBlock | undefined
): FormBlock | undefined {
  const same = blocks.filter((block) => nameKey(block.name, block.originIndex) === key);
  if (same.length === 0) return undefined;
  if (previousBlock) {
    const byContext = same.find((block) => {
      const blockIndex = blocks.indexOf(block);
      return blocks[blockIndex - 1]?.id === previousBlock.id;
    });
    if (byContext) return byContext;
  }
  return same[0];
}

export function isCodaName(name: string): boolean {
  const n = name.trim().toUpperCase();
  return n === "FINAL" || n === "CODA" || n.startsWith("CODA ");
}

export function songForm(song: Song | undefined, options: SongFormOptions = {}): SongForm {
  if (!song) return { blocks: [], visits: [] };
  const sections = sectionList(song);
  const blocks: FormBlock[] = [];
  const grooves = new Map<string, string>();
  const visits: FormVisit[] = [];
  const passById = new Map<string, number>();

  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    if (!section) continue;
    const key = blockKey(section, index);
    const previous = sections[index - 1];
    const previousKey = previous ? blockKey(previous, index - 1) : undefined;
    const prev = visits[visits.length - 1];
    const previousBlock = prev
      ? blocks.find((item) => item.id === prev.blockId)
      : undefined;
    const groove = sectionGroove(song, section, options.identity);
    let block = matchWrittenBlock(
      blocks,
      grooves,
      key,
      groove,
      previousKey,
      previousBlock,
      runOffset(sections, index, key)
    );
    if (
      !block &&
      visits.some((visit) => visit.fromJump === "ds") &&
      !isCodaName(section.name)
    ) {
      block = matchAfterDs(blocks, key, previousBlock);
    }
    if (!block) {
      block = {
        id: `form_${blocks.length}`,
        name: section.name,
        originIndex: index,
        originStart: section.start,
        originEnd: section.end,
        segno: false,
        coda: isCodaName(section.name),
        toCoda: false,
        ds: false,
        repeatStart: false,
        repeatEnd: false
      };
      blocks.push(block);
      if (groove) grooves.set(block.id, groove);
    }
    const pass = (passById.get(block.id) ?? 0) + 1;
    passById.set(block.id, pass);
    const thisIndex = blocks.indexOf(block);
    const prevIndex = previousBlock ? blocks.indexOf(previousBlock) : -1;
    const pairRepeat = prevIndex >= 0 && Math.abs(prevIndex - thisIndex) === 1;
    let fromJump: FormJump = "none";
    if (prev?.blockId === block.id) fromJump = "repeat";
    else if (block.coda) fromJump = "coda";
    else if (pass > 1 && pairRepeat) fromJump = "repeat";
    else if (pass > 1) fromJump = "ds";
    visits.push({
      blockId: block.id,
      start: section.start,
      end: section.end,
      pass,
      fromJump
    });
  }

  const firstReturn = visits.find((visit) => visit.fromJump === "ds");
  if (firstReturn) {
    const segno = blocks.find((block) => block.id === firstReturn.blockId);
    if (segno) segno.segno = true;
    const fromIndex = visits.indexOf(firstReturn) - 1;
    const from = fromIndex >= 0 ? blocks.find((block) => block.id === visits[fromIndex]?.blockId) : undefined;
    if (from && !from.coda) from.ds = true;
  }

  const codaVisit = visits.find((visit) => blocks.some((block) => block.id === visit.blockId && block.coda));
  if (codaVisit) {
    const fromIndex = visits.indexOf(codaVisit) - 1;
    const fromVisit = fromIndex >= 0 ? visits[fromIndex] : undefined;
    const from = fromVisit
      ? blocks.find((block) => block.id === fromVisit.blockId)
      : undefined;
    if (from && fromVisit) {
      from.toCoda = true;
      from.toCodaAt = Math.min(
        from.originEnd,
        from.originStart + Math.max(0, fromVisit.end - fromVisit.start)
      );
    }
  }

  markRepeatBars(blocks, visits);
  if (options.foldInnerRepeats) {
    for (const block of blocks) foldInnerRepeat(song, block);
  }
  return { blocks, visits };
}

function markRepeatBars(blocks: FormBlock[], visits: FormVisit[]): void {
  for (let index = 1; index < visits.length; index++) {
    const prev = visits[index - 1];
    const visit = visits[index];
    if (!prev || !visit || visit.fromJump !== "repeat") continue;
    if (prev.blockId === visit.blockId) continue;
    const current = blocks.find((block) => block.id === visit.blockId);
    const last = blocks.find((block) => block.id === prev.blockId);
    if (!current || !last) continue;
    const currentIndex = blocks.indexOf(current);
    const lastIndex = blocks.indexOf(last);
    if (currentIndex < lastIndex) {
      current.repeatStart = true;
      last.repeatEnd = true;
    }
  }
}

export function formRepeats(form: SongForm, blockId: string): number {
  return form.visits.filter((visit) => visit.blockId === blockId).length;
}

function measureSpan(map: Song["tempoMap"], measure: number): { start: number; end: number } {
  let point = map[0];
  for (const item of map) {
    if (item.measure <= measure) point = item;
    else break;
  }
  if (!point) return { start: 0, end: 0 };
  const length = secondsPerMeasure(point);
  const start = point.time + (measure - point.measure) * length;
  return { start, end: start + length };
}

function chordEnd(chords: ChordEvent[], index: number, fallback: number): number {
  const current = chords[index];
  if (current?.end != null) return current.end;
  return chords[index + 1]?.time ?? fallback;
}

function chordPrintInMeasure(
  chords: ChordEvent[],
  start: number,
  end: number,
  duration: number
): string {
  const starting = chords
    .filter((chord) => chord.time >= start - TIME_EPS && chord.time < end - TIME_EPS)
    .map((chord) => chord.text.trim() || "-");
  if (starting.length > 0) return starting.join(",");
  for (let index = chords.length - 1; index >= 0; index--) {
    const chord = chords[index];
    if (!chord || chord.time > start + TIME_EPS) continue;
    if (chordEnd(chords, index, duration) > start + TIME_EPS) {
      return chord.text.trim() || "-";
    }
    break;
  }
  return "-";
}

function chordLaneName(pitch: number): string | undefined {
  const pitchClass = ((pitch % 12) + 12) % 12;
  return new Map([
    [7, "G"],
    [5, "F"],
    [4, "E"],
    [2, "D"],
    [0, "C"]
  ]).get(pitchClass);
}

function measureChordPrints(song: Song, start: number, end: number): string[] {
  const chords = [...(song.chords ?? [])].sort((a, b) => a.time - b.time);
  if (chords.length === 0) return [];
  const first = timeToMusical(song.tempoMap, start + TIME_EPS).measure;
  const last = timeToMusical(song.tempoMap, Math.max(start, end - TIME_EPS)).measure;
  const prints: string[] = [];
  for (let measure = first; measure <= last; measure++) {
    const span = measureSpan(song.tempoMap, measure);
    const measureStart = Math.max(span.start, start);
    const measureEnd = Math.min(span.end, end);
    if (measureEnd - measureStart <= TIME_EPS) continue;
    const measureLength = span.end - span.start;
    const hits = new Map<number, string>();
    const seen = new Set<string>();
    for (let chordIndex = 0; chordIndex < chords.length; chordIndex++) {
      const chord = chords[chordIndex];
      if (!chord) continue;
      const endOfChord = chordEnd(chords, chordIndex, song.duration);
      if (chord.time >= measureEnd - TIME_EPS || endOfChord <= measureStart + TIME_EPS) {
        continue;
      }
      for (const note of chord.notes ?? []) {
        if (note.measure != null && note.measure !== measure) continue;
        if (note.time < measureStart - TIME_EPS || note.time >= measureEnd - TIME_EPS) continue;
        const key = `${note.time.toFixed(5)}:${note.pitch}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const lane = chordLaneName(note.pitch);
        if (!lane || measureLength <= 0) continue;
        const step = Math.max(
          0,
          Math.min(15, Math.round(((note.time - span.start) / measureLength) * 16))
        );
        hits.set(step, lane);
      }
    }
    const notePrint = [...hits.entries()]
      .sort(([left], [right]) => left - right)
      .map(([step, lane]) => `${step}:${lane}`)
      .join(",");
    prints.push(
      `${chordPrintInMeasure(chords, measureStart, measureEnd, song.duration)}#${notePrint}`
    );
  }
  return prints;
}

function foldInnerRepeat(song: Song, block: FormBlock): void {
  const prints = measureChordPrints(song, block.originStart, block.originEnd);
  if (prints.length < 4 || prints.length % 2 !== 0) return;
  if (prints.every((print) => print === "-#")) return;
  const half = prints.length / 2;
  if (prints.slice(0, half).join("|") !== prints.slice(half).join("|")) return;
  const firstMeasure = timeToMusical(song.tempoMap, block.originStart + TIME_EPS).measure;
  const mid = measureSpan(song.tempoMap, firstMeasure + half).start;
  if (mid <= block.originStart + TIME_EPS || mid >= block.originEnd - TIME_EPS) return;
  block.originEnd = mid;
  block.repeatStart = true;
  block.repeatEnd = true;
}

export function formAt(form: SongForm, time: number): FormPosition | null {
  if (form.visits.length === 0) return null;
  let visit = form.visits.find((item) => time >= item.start - TIME_EPS && time < item.end - TIME_EPS);
  if (!visit) {
    const last = form.visits[form.visits.length - 1];
    visit = last && time >= last.start - TIME_EPS && time <= last.end + TIME_EPS ? last : undefined;
  }
  if (!visit) return null;
  const block = form.blocks.find((item) => item.id === visit.blockId);
  if (!block) return null;
  const local = Math.max(0, time - visit.start);
  const originSpan = Math.max(TIME_EPS, block.originEnd - block.originStart);
  const visitSpan = Math.max(TIME_EPS, visit.end - visit.start);
  const wrapped = visitSpan > originSpan + TIME_EPS ? local % originSpan : Math.min(local, originSpan - TIME_EPS);
  const originTime = block.originStart + Math.min(wrapped, originSpan - TIME_EPS);
  return { visit, block, originTime };
}

export function formNextAt(form: SongForm, time: number, afterOriginTime: number): FormPosition | null {
  const current = formAt(form, time);
  if (!current) return null;
  const originSpan = Math.max(TIME_EPS, current.block.originEnd - current.block.originStart);
  const passOffset = Math.floor(Math.max(0, time - current.visit.start) / originSpan) * originSpan;
  const atWrittenEnd = afterOriginTime >= current.block.originEnd - TIME_EPS;
  if (!atWrittenEnd) {
    return { visit: current.visit, block: current.block, originTime: afterOriginTime };
  }
  const nextPass = current.visit.start + passOffset + originSpan;
  if (nextPass < current.visit.end - TIME_EPS) {
    return { visit: current.visit, block: current.block, originTime: current.block.originStart };
  }
  const index = form.visits.findIndex(
    (visit) => visit.blockId === current.visit.blockId && visit.start === current.visit.start && visit.end === current.visit.end
  );
  const next = form.visits[index + 1];
  return next ? formAt(form, next.start) : null;
}
