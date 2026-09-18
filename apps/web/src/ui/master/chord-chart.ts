import {
  formAt,
  formNextAt,
  secondsPerMeasure,
  tempoAt,
  timeToMusical,
  type FormBlock,
  type Section,
  type Song,
  type SongForm,
  type TempoPoint
} from "@dbk/core";
import {
  beatsForMeasure,
  chordMarksForMeasure,
  measureSpan,
  noteGridKey,
  notesForMeasure,
  stepsForMeasure,
  type ChordNoteHit
} from "./chord-notes";
import { finalMeasure, firstTempoChangeMeasure } from "./rall-alert";

const TIME_EPS = 0.02;

/** A chord sheet is read four bars to a line, the way the band already reads paper. */
export const BARS_PER_LINE = 4;

/**
 * Two bars saying the same thing are not worth a repeat sign — the band reads them faster than
 * they read the sign. A repeat is worth writing once it saves a line.
 */
export const MIN_REPEAT_BARS = 4;

export interface ChordSlot {
  text: string;
  beat: number;
  step: number;
  /** Where the chord sounds in its bar, 0 to 1. A bar read twice needs no clock of its own. */
  from: number;
  to: number;
}

/** Same columns as the note and drum grids, so Am|Bm sits on a beat line. */
export function slotGridPlacement(
  slot: Pick<ChordSlot, "step" | "from" | "to">,
  steps: number
): { column: number; span: number } {
  const n = Math.max(1, Math.round(steps));
  const column = Math.min(n, Math.max(1, slot.step + 1));
  const span = Math.min(n - column + 1, Math.max(1, Math.round((slot.to - slot.from) * n)));
  return { column, span };
}

export interface ChordBar {
  measure: number;
  start: number;
  end: number;
  beats: number;
  steps: number;
  slots: ChordSlot[];
  notes: ChordNoteHit[];
}

/** Bars written once, and how many times they are played. */
export interface ChordSpan {
  id: string;
  lines: ChordBar[][];
  bars: number;
  plays: number;
  /** A repeat opening at the first of these bars, closed on a later span or a later row. */
  opens?: boolean;
  /** A repeat closing after the last of these bars, in this many plays. */
  closes?: number;
  /** Where a pass that ends differently begins in these bars, and which pass it is. */
  ending?: { at: number; pass: number };
}

/** A name over a set of bars. The first of a row owns the bars; the rest are read off them. */
export interface ChordHead {
  block: FormBlock;
  section: Section;
}

export interface ChordRow {
  /** Every name on these bars, top to bottom, in the order the song plays them. */
  heads: ChordHead[];
  spans: ChordSpan[];
  /** How much of a full line the section name bar covers, so a short section reads as short. */
  width: number;
}

export interface ChordBarRef {
  blockId: string;
  measure: number;
}

/** Where the tempo first gives, said over the line the band is reading when it does. */
export interface ChordRall {
  /** The bar on the page the rall is read from, which can be a bar written for an earlier pass. */
  shown: ChordBarRef;
  /** The bar the band is playing when the tempo gives. */
  measure: number;
  /** The section they are in then, so the sign stays dim until they are on that pass. */
  blockId: string;
}

export interface ChordChart {
  rows: ChordRow[];
  /** Every bar the band plays, pointed at the bar on the page that stands for it. */
  drawn: Map<string, ChordBarRef>;
  /** The bars each block plays, for a playhead that lands a hair past the last of them. */
  bounds: Map<string, { first: number; last: number }>;
  /** The name that lights for a section with no name of its own, read off another's bars. */
  named: Map<string, string>;
  /** Bars marked 1. or 2. where two passes end differently. */
  endings: Set<string>;
  rall: ChordRall | null;
  final: ChordRall | null;
}

export interface ChordPlayhead extends ChordBarRef {
  next: ChordBarRef | null;
  /** How far through the bar the band is, 0 to 1, for picking out the chord sounding now. */
  phase: number;
  /** The section being played, which can be one named under another section's bars. */
  playing: string;
  /** The section read next, for lighting the name they are about to play. */
  nextPlaying: string | null;
}

export function hasChordData(song: Song | undefined): boolean {
  return (song?.chords ?? []).some((chord) => chord.text.trim().length > 0);
}

function barKey(blockId: string, measure: number): string {
  return `${blockId}#${measure}`;
}

function barNumbers(song: Song, block: FormBlock): number[] {
  const map = song.tempoMap ?? [];
  const first = timeToMusical(map, block.originStart + TIME_EPS).measure;
  const last = timeToMusical(map, Math.max(block.originStart, block.originEnd - TIME_EPS)).measure;
  const bars: number[] = [];
  for (let measure = first; measure <= last; measure += 1) bars.push(measure);
  return bars;
}

function slotsInBar(song: Song, measure: number): ChordSlot[] {
  const steps = stepsForMeasure(song, measure);
  const marks = chordMarksForMeasure(song, measure).filter((mark) => mark.text.trim().length > 0);
  return marks.map((mark, index) => {
    const next = marks[index + 1];
    return {
      text: mark.text,
      beat: mark.beat,
      step: mark.step,
      from: mark.step / steps,
      to: next ? next.step / steps : 1
    };
  });
}

function barOf(song: Song, measure: number, block: FormBlock): ChordBar {
  const span = measureSpan(song.tempoMap ?? [], measure);
  return {
    measure,
    start: span.start,
    end: Math.min(span.end, Math.max(span.start, block.originEnd)),
    beats: beatsForMeasure(song, measure),
    steps: stepsForMeasure(song, measure),
    slots: slotsInBar(song, measure),
    notes: notesForMeasure(song, measure)
  };
}

/** What makes one bar the same as another: the chords on their beats, and the strum. */
function barPrint(bar: ChordBar): string {
  const chords = bar.slots.map((slot) => `${slot.step}:${slot.text}`).join(",");
  return `${bar.steps}/${chords}/${noteGridKey(bar.notes)}`;
}

function samePrints(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((print, index) => print === right[index]);
}

function repeats(prints: readonly string[], start: number, length: number): number {
  let plays = 1;
  for (;;) {
    const from = start + length * plays;
    if (from + length > prints.length) break;
    if (!samePrints(prints.slice(start, start + length), prints.slice(from, from + length))) break;
    plays += 1;
  }
  return plays;
}

/**
 * The shortest group of bars from here that is played again straight away.
 *
 * Shortest wins: eight bars of the same thing are four bars played twice, not eight played once,
 * and the band reads the shorter page. Anything under `MIN_REPEAT_BARS` is left written out.
 */
function repeatFrom(
  prints: readonly string[],
  start: number
): { length: number; plays: number } | null {
  const room = Math.floor((prints.length - start) / 2);
  for (let length = MIN_REPEAT_BARS; length <= room; length += 1) {
    const plays = repeats(prints, start, length);
    if (plays > 1) return { length, plays };
  }
  return null;
}

function lines(bars: ChordBar[]): ChordBar[][] {
  const out: ChordBar[][] = [];
  for (let index = 0; index < bars.length; index += BARS_PER_LINE) {
    out.push(bars.slice(index, index + BARS_PER_LINE));
  }
  return out;
}

function spanOf(id: string, bars: ChordBar[], plays: number): ChordSpan {
  return { id, lines: lines(bars), bars: bars.length, plays };
}

/** Groups a block's bars into what is written once and what carries a repeat sign. */
function spansOf(blockId: string, bars: ChordBar[], prints: string[]): ChordSpan[] {
  const spans: ChordSpan[] = [];
  let plain: ChordBar[] = [];
  const flush = () => {
    if (plain.length === 0) return;
    spans.push(spanOf(`${blockId}_s${spans.length}`, plain, 1));
    plain = [];
  };
  let index = 0;
  while (index < bars.length) {
    const found = repeatFrom(prints, index);
    if (!found) {
      const bar = bars[index];
      if (bar) plain.push(bar);
      index += 1;
      continue;
    }
    flush();
    spans.push(
      spanOf(`${blockId}_s${spans.length}`, bars.slice(index, index + found.length), found.plays)
    );
    index += found.length * found.plays;
  }
  flush();
  return spans;
}

interface Written {
  heads: ChordHead[];
  bars: ChordBar[];
  owners: string[];
  prints: string[];
  /** The block as it first arrived, for spotting a later block that plays the same bars. */
  unit: string[];
  /** Bars played off this row by a section named under it, each at its place in the row. */
  shared: { blockId: string; bar: ChordBar; at: number; head: string }[];
  /** How many times these bars are played, one for each name standing over them. */
  passes: number;
  /** A repeat over this row and the rows folded with it: where it opens, and where it closes. */
  opens: boolean;
  closes: number;
  /** Where the bars the first pass alone plays begin, when the passes part company at the end. */
  ending: number;
  /** The bars the last pass ends on instead, written after the repeat as a second ending. */
  tail: { bars: ChordBar[]; owners: string[]; head: string } | null;
}

function headName(item: Written | undefined): string {
  return item?.heads[0]?.section.name.trim() ?? "";
}

/**
 * The name a section is one of. SAN 1, SAN 2 and SAN A all belong to SAN, and CEV+ FINAL to CEV.
 *
 * Only sections of one name stack, because a stack is read as one thing played again: NAK 2 over
 * ARA 1 would be two names for two different places in the song sitting on one set of bars, and
 * the band would have to work out which of them they are on.
 */
function family(name: string): string {
  const letters = name.trim().match(/^\p{L}+/u)?.[0] ?? name.trim();
  return letters.toUpperCase();
}

function runsMatch(left: Written[], right: Written[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => samePrints(item.prints, right[index]?.prints ?? []))
  );
}

/** Writes a section's names into the row that already has its bars, and says which name lights. */
function nameHeads(target: Written, source: Written): Map<string, string> {
  const lights = new Map<string, string>();
  for (const head of source.heads) {
    const name = head.section.name.trim();
    const already = target.heads.find((item) => item.section.name.trim() === name);
    if (already) lights.set(head.block.id, already.block.id);
    else {
      target.heads.push(head);
      lights.set(head.block.id, head.block.id);
    }
  }
  return lights;
}

/** Writes the next run's names under this run's bars, and its bars onto them. */
function stack(target: Written, source: Written): void {
  const lights = nameHeads(target, source);
  const first = source.heads[0];
  const fallback = (first ? lights.get(first.block.id) : "") ?? "";
  source.bars.forEach((bar, at) => {
    const blockId = source.owners[at];
    if (blockId)
      target.shared.push({
        blockId,
        bar,
        at,
        head: lights.get(blockId) ?? fallback
      });
  });
  for (const item of source.shared) target.shared.push(item);
  target.passes += source.passes;
}

function unmarked(item: Written): boolean {
  return item.heads.every(
    (head) =>
      !head.block.coda &&
      !head.block.toCoda &&
      !head.block.segno &&
      !head.block.ds &&
      !head.block.repeatStart &&
      !head.block.repeatEnd
  );
}

/** Whether a later run can be read off the bars of the one before it, under its own names. */
function foldable(first: Written[], next: Written[]): boolean {
  if (!runsMatch(first, next)) return false;
  if (next.some((item) => item.heads.some((head) => head.block.coda))) return false;
  return first.every((item, at) => {
    const name = headName(next[at]);
    if (!name || family(name) !== family(headName(item))) return false;
    return !item.heads.some((head) => head.section.name.trim() === name);
  });
}

/**
 * A run of sections played straight through again is named under the bars it repeats, with a
 * repeat sign round them: Biz plays SAN 1 and CEV over again as SAN 2 and CEV+ FINAL, and the
 * band reads one set of bars, twice, with both names on it.
 *
 * Only a run that follows the one it repeats folds this way. A section that happens to share its
 * bars with something else on the page stays where the band plays it, or the page would stop
 * reading in the order the song is played. Every section of the run has to bring a name of its
 * own from the same family, since those names are the only word the band gets that the bars come
 * round again. An ending is always written out, so the sign that sends the band there has bars to
 * land on.
 */
function foldRepeatedRuns(written: Written[]): Written[] {
  const rows: Written[] = [];
  let index = 0;
  while (index < written.length) {
    let folded = 0;
    for (let length = Math.floor((written.length - index) / 2); length >= 1; length -= 1) {
      const first = written.slice(index, index + length);
      let passes = 1;
      for (;;) {
        const from = index + length * passes;
        const next = written.slice(from, from + length);
        if (next.length < length || !foldable(first, next)) break;
        first.forEach((item, at) => {
          const source = next[at];
          if (source) stack(item, source);
        });
        passes += 1;
      }
      if (passes === 1) continue;
      const open = first[0];
      const close = first[length - 1];
      if (open) open.opens = true;
      if (close) close.closes = passes;
      rows.push(...first);
      folded = length * passes;
      break;
    }
    if (folded === 0) {
      const item = written[index];
      if (item) rows.push(item);
    }
    index += folded || 1;
  }
  return rows;
}

/**
 * How many bars two passes have in common when they part company only at the end, or none if
 * they are not a pair for a repeat with two endings.
 *
 * The common bars have to be the bulk of the pass, or the repeat saves the band nothing, and
 * neither pass may carry a sign of its own: a to Coda over the second pass has to stay on the
 * bars it is written over.
 */
function endingSplit(left: Written, right: Written): number {
  if (left.tail || right.tail) return 0;
  if (left.passes > 1 || right.passes > 1 || left.shared.length > 0 || right.shared.length > 0) {
    return 0;
  }
  if (!unmarked(left)) return 0;
  // D.S. and to Coda sit on the last section of a cycle, which is still the second
  // ending of that section: Kerkük's second SAN D sends the band back and out.
  if (
    right.heads.some(
      (head) => head.block.coda || head.block.segno || head.block.repeatStart || head.block.repeatEnd
    )
  ) {
    return 0;
  }
  if (left.prints.length !== right.prints.length) return 0;
  if (left.prints.length < MIN_REPEAT_BARS) return 0;
  if (family(headName(left)) !== family(headName(right))) return 0;
  let common = 0;
  while (common < left.prints.length && left.prints[common] === right.prints[common]) common += 1;
  const tail = left.prints.length - common;
  if (tail === 0 || common < tail) return 0;
  return common;
}

/**
 * Two passes that part company only at the end are written once, as a repeat with a first and a
 * second ending: Kerkük's SAN A plays the same four bars twice and lands differently each time,
 * so the page carries the bars once, then the two last bars marked 1. and 2.
 */
function foldEndings(rows: Written[]): Written[] {
  const out: Written[] = [];
  let index = 0;
  while (index < rows.length) {
    const left = rows[index];
    const right = rows[index + 1];
    const common = left && right ? endingSplit(left, right) : 0;
    if (!left || !right || common === 0) {
      if (left) out.push(left);
      index += 1;
      continue;
    }
    const lights = nameHeads(left, right);
    const shown = left.heads[0];
    for (const head of right.heads) {
      if (!shown) break;
      if (head.block.ds) shown.block.ds = true;
      if (head.block.toCoda) {
        shown.block.toCoda = true;
        if (head.block.toCodaAt != null) shown.block.toCodaAt = head.block.toCodaAt;
      }
    }
    const head = right.heads[0];
    const light = (head ? lights.get(head.block.id) : "") ?? "";
    right.bars.slice(0, common).forEach((bar, at) => {
      const blockId = right.owners[at];
      if (blockId)
        left.shared.push({
          blockId,
          bar,
          at,
          head: lights.get(blockId) ?? light
        });
    });
    left.ending = common;
    left.tail = {
      bars: right.bars.slice(common),
      owners: right.owners.slice(common),
      head: light
    };
    left.passes = 2;
    out.push(left);
    index += 2;
  }
  return out;
}

/**
 * The spans of one row: the bars as written, with the signs saying how often they are played.
 *
 * A row with two endings keeps the bars of the first ending on the end of the bars it repeats, so
 * the band reads them straight on and the repeat closes in the gap after them, rather than
 * dropping a bar or two onto a line of their own.
 */
function spansOfRow(owner: string, item: Written): ChordSpan[] {
  if (item.tail) {
    const repeated = spanOf(`${owner}_s0`, item.bars, 1);
    repeated.opens = true;
    repeated.closes = item.passes;
    if (item.ending > 0) repeated.ending = { at: item.ending, pass: 1 };
    const tail = spanOf(`${owner}_e1`, item.tail.bars, 1);
    tail.ending = { at: 0, pass: 2 };
    return [repeated, tail];
  }
  const spans = spansOf(owner, item.bars, item.prints);
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (item.opens && first) first.opens = true;
  if (item.closes > 1 && last) last.closes = item.closes;
  applyFormRepeatMarks(item, spans);
  return spans;
}

/**
 * A form repeat that jumps back a section (Yolcu's CEV into NAK) is marked on those blocks.
 * The signs belong on the chord and note rows, so the name bars stay names.
 */
function applyFormRepeatMarks(item: Written, spans: ChordSpan[]): void {
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (item.heads.some((head) => head.block.repeatStart) && first) first.opens = true;
  if (item.heads.some((head) => head.block.repeatEnd) && last) {
    last.closes = last.closes && last.closes > 1 ? last.closes : 2;
  }
}

function nameBarWidth(spans: ChordSpan[]): number {
  const first = spans[0];
  if (!first || spans.length > 1 || first.lines.length > 1) return 1;
  return Math.min(1, (first.lines[0]?.length ?? BARS_PER_LINE) / BARS_PER_LINE);
}

/**
 * The bars of a song in the order the page is read, block by block off the form.
 *
 * Bars that come round again are written once and given a repeat sign, whether the repeat sits
 * inside a section or is a whole section played twice, and the playhead map keeps pointing the
 * second pass at the bars on the page that stand for it. A run of sections played again under new
 * names of the same family is folded the same way, with the names stacked over the bars they
 * share, and two passes that part company only at the end become one repeat with two endings.
 */
export function chordChart(song: Song | undefined, form: SongForm): ChordChart {
  if (!song) {
    return {
      rows: [],
      drawn: new Map(),
      bounds: new Map(),
      named: new Map(),
      endings: new Set(),
      rall: null,
      final: null
    };
  }
  const written: Written[] = [];
  for (const block of form.blocks) {
    const section = song.sections[block.originIndex];
    if (!section) continue;
    const bars = barNumbers(song, block).map((measure) => barOf(song, measure, block));
    const prints = bars.map(barPrint);
    const last = written[written.length - 1];
    const name = section.name.trim();
    // A section that plays the section before it again, note for note, belongs on its bars. An
    // ending is left alone: the band has to see the bars they land on.
    if (last && headName(last) === name && !block.coda && samePrints(last.unit, prints)) {
      last.bars.push(...bars);
      last.owners.push(...bars.map(() => block.id));
      last.prints.push(...prints);
      const shown = last.heads[0];
      if (shown) {
        if (block.ds) shown.block.ds = true;
        if (block.toCoda) {
          shown.block.toCoda = true;
          if (block.toCodaAt != null) shown.block.toCodaAt = block.toCodaAt;
        }
      }
      continue;
    }
    written.push({
      heads: [{ block, section }],
      bars,
      owners: bars.map(() => block.id),
      prints,
      unit: prints,
      shared: [],
      passes: 1,
      opens: false,
      closes: 0,
      ending: 0,
      tail: null
    });
  }

  const drawn = new Map<string, ChordBarRef>();
  const bounds = new Map<string, { first: number; last: number }>();
  const named = new Map<string, string>();
  const endings = new Set<string>();
  const rows = foldEndings(foldRepeatedRuns(written)).map((item) => {
    const owner = item.heads[0]?.block.id ?? "";
    const spans = spansOfRow(owner, item);
    for (const span of spans) {
      if (!span.ending) continue;
      const bar = span.lines.flat()[span.ending.at];
      if (bar) endings.add(barKey(owner, bar.measure));
    }
    // The bar on the page each played bar is read from, in the order the row is played.
    const sequence: ChordBar[] = [];
    for (const span of spans) {
      const unit = span.lines.flat();
      for (let index = 0; index < unit.length * span.plays; index += 1) {
        const shown = unit[index % unit.length];
        if (shown) sequence.push(shown);
      }
    }
    const point = (blockId: string, measure: number, shown: number) => {
      drawn.set(barKey(blockId, measure), { blockId: owner, measure: shown });
      const seen = bounds.get(blockId);
      bounds.set(blockId, {
        first: Math.min(seen?.first ?? measure, measure),
        last: Math.max(seen?.last ?? measure, measure)
      });
    };
    const titled = new Set(item.heads.map((head) => head.block.id));
    item.bars.forEach((bar, index) => {
      const owns = item.owners[index];
      const shown = sequence[index];
      if (!owns || !shown) return;
      point(owns, bar.measure, shown.measure);
      if (!titled.has(owns)) named.set(owns, owner);
    });
    for (const head of item.shared) {
      const shown = sequence[head.at];
      if (shown) point(head.blockId, head.bar.measure, shown.measure);
      if (!titled.has(head.blockId)) named.set(head.blockId, head.head || owner);
    }
    // A second ending is written out, so the bars the last pass ends on stand for themselves.
    item.tail?.bars.forEach((bar, at) => {
      const blockId = item.tail?.owners[at];
      if (!blockId) return;
      point(blockId, bar.measure, bar.measure);
      if (!titled.has(blockId)) named.set(blockId, item.tail?.head || owner);
    });
    return { heads: item.heads, spans, width: nameBarWidth(spans) };
  });
  return {
    rows,
    drawn,
    bounds,
    named,
    endings,
    rall: cueOf(song, drawn, form, firstTempoChangeMeasure(song.tempoMap)),
    final: cueOf(song, drawn, form, finalMeasure(song))
  };
}

/**
 * The bar a cue is read from. The bar it is played in is often not on the page at all — the
 * last pass of Karahisar's NAK is read off the bars written for the pass before it — so the sign
 * goes over the line those bars are on, and lights when the band reaches the pass that slows.
 */
function cueOf(
  song: Song,
  drawn: Map<string, ChordBarRef>,
  form: SongForm,
  measure: number | undefined
): ChordRall | null {
  if (measure == null) return null;
  for (const [key, shown] of drawn) {
    const cut = key.lastIndexOf("#");
    if (Number(key.slice(cut + 1)) !== measure) continue;
    return { shown, measure, blockId: key.slice(0, cut) };
  }
  const fromMap = (song.tempoMap ?? []).find((item) => item.measure === measure);
  const time = fromMap?.time ?? (Number.isFinite(song.finalAt) ? song.finalAt : undefined);
  if (time == null) return null;
  const pos = formAt(form, time + TIME_EPS);
  if (!pos) return null;
  const originMeasure = timeToMusical(song.tempoMap ?? [], pos.originTime + TIME_EPS).measure;
  const shown = drawn.get(barKey(pos.block.id, originMeasure));
  if (!shown) return null;
  return { shown, measure, blockId: pos.block.id };
}

/**
 * A section's written end can sit a few milliseconds past its last bar line, and the playhead
 * lands in that sliver for a frame. Holding it on the last bar keeps the band lit on the bar they
 * are playing, rather than putting a bar on the page that nobody wrote.
 */
function pinned(chart: ChordChart, blockId: string, measure: number): number {
  const edge = chart.bounds.get(blockId);
  if (!edge) return measure;
  return Math.min(edge.last, Math.max(edge.first, measure));
}

function measureEndAt(map: TempoPoint[], time: number): number {
  const point = tempoAt(map, time);
  const measure = timeToMusical(map, time).measure;
  return point.time + (measure - point.measure + 1) * secondsPerMeasure(point);
}

/**
 * The next bar is only worth lighting when the band has to look somewhere else: the next
 * section, the top of a repeat, or a 1. / 2. ending.
 */
export function showsNextChordMeasure(
  chart: ChordChart,
  here: ChordBarRef,
  next: ChordBarRef,
  playing: string,
  nextPlaying: string | null
): boolean {
  if (nextPlaying != null && nextPlaying !== playing) return true;
  if (here.blockId !== next.blockId) return true;
  if (next.measure < here.measure) return true;
  return chart.endings.has(barKey(next.blockId, next.measure));
}

/**
 * The bar on the page under the playhead, and the bar the band reads next when that jump
 * matters.
 *
 * Both are looked up through the chart, so a second pass of a repeat lights the bars it is read
 * from, and the bar after the last of a repeat is the top of that repeat rather than whatever
 * comes below it on the page.
 */
export function chordPlayhead(
  chart: ChordChart,
  form: SongForm,
  time: number,
  map: TempoPoint[],
  chainNext = false
): ChordPlayhead | null {
  const pos = formAt(form, time);
  if (!pos) return null;
  const measure = pinned(chart, pos.block.id, timeToMusical(map, pos.originTime).measure);
  const here = chart.drawn.get(barKey(pos.block.id, measure));
  if (!here) return null;
  const bar = measureSpan(map, measure);
  const length = Math.max(TIME_EPS, bar.end - bar.start);
  const phase = Math.min(1, Math.max(0, (pos.originTime - bar.start) / length));
  const playing = chart.named.get(pos.block.id) ?? pos.block.id;
  const onward = chart.drawn.get(barKey(pos.block.id, measure + 1));
  const visitEnd = pos.block.originStart + Math.max(TIME_EPS, pos.visit.end - pos.visit.start);
  const onwardInVisit = Boolean(onward && bar.end < visitEnd - TIME_EPS);
  let next: ChordBarRef | null = null;
  let nextPlaying: string | null = null;
  if (onwardInVisit && onward) {
    next = onward;
    nextPlaying = playing;
  } else if (!chainNext) {
    const played = measureEndAt(map, time);
    const after =
      played >= pos.visit.end - TIME_EPS || bar.end >= visitEnd - TIME_EPS
        ? pos.block.originEnd
        : measureEndAt(map, pos.originTime);
    const nextPos = formNextAt(form, time, after);
    if (nextPos) {
      const top = timeToMusical(map, nextPos.block.originStart + TIME_EPS).measure;
      next = chart.drawn.get(barKey(nextPos.block.id, top)) ?? null;
      nextPlaying = chart.named.get(nextPos.block.id) ?? nextPos.block.id;
    }
  }
  const lastVisit = form.visits[form.visits.length - 1] === pos.visit;
  const showNext =
    Boolean(next) &&
    (showsNextChordMeasure(chart, here, next!, playing, nextPlaying) ||
      (lastVisit && (next!.blockId !== here.blockId || next!.measure !== here.measure)));
  return {
    ...here,
    phase,
    playing,
    next: showNext ? next : null,
    nextPlaying: showNext ? nextPlaying : playing
  };
}
