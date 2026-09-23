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

/**
 * Where a chord sits in its section, to the millisecond. Two passes of the same bars are the same
 * music, but each pass counts its time from a different point of the tempo map, so the arithmetic
 * leaves dust: the first CEV+ FINAL of Biz opens a hair before its own section and printed
 * "-0.0000" where the last one printed "0.0000", which read as new music and hung a coda on the
 * song. A millisecond is finer than anyone plays, and zero has no sign.
 */
function offsetKey(time: number, start: number): string {
  const at = Math.round((time - start) * 1000) / 1000;
  return (at === 0 ? 0 : at).toFixed(3);
}

/**
 * Where a strum sits in its bar. Kerkük's second cycle is the same music as the first, but the
 * export's note times drift by a few milliseconds, and a stamp in seconds still splits 3.74 from
 * 3.76 and hides the D.S. The chord page already reads hits by their step in the bar; the form
 * uses that same reading so two passes of the same bars stay one block.
 */
function noteStamp(
  map: Song["tempoMap"],
  note: { time: number; pitch: number },
  origin: number
): string {
  // Count the hit from the chord's bar, not its own clock: a strum that lands on a bar line
  // in the second pass of Kerkük's first ARA prints as step 15 in one cycle and step 0 in
  // the other, which used to look like new music and put the segno on the ARA after it.
  const measure = timeToMusical(map ?? [], origin + TIME_EPS).measure;
  const span = measureSpan(map, measure);
  const length = Math.max(TIME_EPS, span.end - span.start);
  const step = Math.max(0, Math.min(15, Math.round(((note.time - span.start) / length) * 16)));
  return `${step}:${note.pitch}`;
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
      const offset = offsetKey(chord.time, section.start);
      const notes = (chord.notes ?? [])
        .map((note) => noteStamp(song.tempoMap, note, chord.time))
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

function sameNamedBlocks(blocks: FormBlock[], key: string): FormBlock[] {
  return blocks.filter((block) => nameKey(block.name, block.originIndex) === key);
}

/**
 * Whether this music is already on the page under this name. Later passes are matched by where
 * they sit in the running order, which is right while a pass repeats what was written, but on its
 * own it also swallows an ending nobody has seen: the last NAK of a song that finishes on a
 * rallentando plays SLOW and TUS where the written NAK played ROCK, and the drummer would be
 * reading the wrong bars. A groove written nowhere is new music and earns its own row. An empty
 * groove means this view has nothing to compare, so it is not treated as a difference.
 */
function grooveAlreadyWritten(
  same: FormBlock[],
  grooves: Map<string, string>,
  groove: string
): boolean {
  if (!groove) return true;
  return same.some((block) => {
    const written = grooves.get(block.id);
    return groovesMatch(written, groove) || sameDrumPattern(written, groove);
  });
}

/**
 * Chord letters and note pitches, without where they sit in the bar. A rall stretches the last
 * NAK of Karahisar by a few tenths and would otherwise look like new music and hang a coda on
 * bars the band is already reading.
 */
function chordShape(groove: string): string | undefined {
  if (!groove.startsWith("c:")) return undefined;
  return groove
    .slice(2)
    .split("|")
    .map((part) =>
      part
        .replace(/^-?\d+\.\d+:/, "")
        .replace(/\[(.*?)\]/, (_, notes: string) =>
          `[${notes
            .split(",")
            .map((note) => note.replace(/^\d+:/, ""))
            .join(",")}]`
        )
    )
    .join("|");
}

/**
 * The pattern names in a drum groove, without the note grid. A repeat that plays HALAY TOM II
 * with a different sticking is still that bar. A different pattern name is new music.
 */
function drumPattern(groove: string | undefined): string | undefined {
  if (!groove?.startsWith("p:")) return undefined;
  const names = groove
    .slice(2)
    .split("|")
    .map((part) => part.replace(/\[[^\]]*\]/g, ""))
    .join("|");
  return names || undefined;
}

function sameDrumPattern(written: string | undefined, current: string): boolean {
  const left = drumPattern(written);
  const right = drumPattern(current);
  return Boolean(left && right && left === right);
}

function groovesMatch(written: string | undefined, current: string): boolean {
  if (!written) return false;
  if (written === current) return true;
  const writtenShape = chordShape(written);
  const currentShape = chordShape(current);
  if (writtenShape != null && currentShape != null) {
    if (writtenShape === currentShape) return true;
    if (writtenShape.startsWith(`${currentShape}|`)) return true;
  }
  if (!written.startsWith("c:") || !current.startsWith("c:")) return false;
  return written.startsWith(`${current}|`);
}

function matchWrittenBlock(
  blocks: FormBlock[],
  grooves: Map<string, string>,
  key: string,
  groove: string,
  previousKey: string | undefined,
  previousBlock: FormBlock | undefined,
  offset: number,
  sections: Section[],
  index: number
): FormBlock | undefined {
  const same = sameNamedBlocks(blocks, key);
  if (previousKey === key) {
    if (!grooveAlreadyWritten(same, grooves, groove)) return undefined;
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
    if (byContext) return phraseStart(blocks, byContext, sections, index);

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
    if (byGroove) return phraseStart(blocks, byGroove, sections, index);
    // No grid matches. The same pattern name is still the written bar: Lorke's repeat
    // plays the NAK sticking on the ARA, and the last NAK is another sticking of HALAY TOM II.
    const byPattern = same.find((block) => sameDrumPattern(grooves.get(block.id), groove));
    if (byPattern) return phraseStart(blocks, byPattern, sections, index);
    return undefined;
  }
  return same[0];
}

/**
 * The block a repeat goes back to, when a groove match lands in the middle of a run.
 *
 * Toycular writes two ARAs. The repeat opens on the second ARA's drum pattern, so a groove
 * match hangs the segno there. The names that follow still line up with the first ARA.
 */
function phraseStart(
  blocks: FormBlock[],
  candidate: FormBlock,
  sections: Section[],
  index: number
): FormBlock {
  const run = sameNameRun(blocks, candidate);
  if (run.length < 2) return candidate;
  let best = candidate;
  let bestLength = nameRunLength(sections, candidate.originIndex, index);
  for (const block of run) {
    const length = nameRunLength(sections, block.originIndex, index);
    if (length > bestLength) {
      best = block;
      bestLength = length;
    }
  }
  return best;
}

function sameNameRun(blocks: FormBlock[], block: FormBlock): FormBlock[] {
  const key = nameKey(block.name, block.originIndex);
  const at = blocks.indexOf(block);
  let start = at;
  let end = at;
  while (start > 0) {
    const previous = blocks[start - 1];
    if (!previous || nameKey(previous.name, previous.originIndex) !== key) break;
    start -= 1;
  }
  while (end + 1 < blocks.length) {
    const next = blocks[end + 1];
    if (!next || nameKey(next.name, next.originIndex) !== key) break;
    end += 1;
  }
  return blocks.slice(start, end + 1);
}

/** How far the written names from `from` keep agreeing with the names from `index`. */
function nameRunLength(sections: Section[], from: number, index: number): number {
  let length = 0;
  while (from + length < sections.length && index + length < sections.length) {
    const written = sections[from + length];
    const current = sections[index + length];
    if (!written || !current) break;
    if (blockKey(written, from + length) !== blockKey(current, index + length)) break;
    length += 1;
  }
  return length;
}

/**
 * Where a section on a later pass belongs, once the running order alone has stopped deciding.
 *
 * Counting is what settles it: the second SAN of the repeat is the second SAN on the page,
 * whatever groove it happens to be played on. The groove cannot be the judge here — a pass
 * that plays written bars a different way is a variation, not new music, and sending the
 * reader to whichever block matches the groove takes them off the bars they are on.
 *
 * Nor can "the block written after the one just played": where an intervening section is
 * written once but played twice, every later section looks like it follows that same block.
 * Gönlüm writes one CEVAP and two SAN B, so both SAN B appear to follow CEVAP, and the
 * repeat's second SAN B was landing on the first SAN B's bars. That also cost the song its
 * D.S. — the block before FINAL was no longer the one carrying the sign, so the ending read
 * as a coda jump and hung "to Coda" on bars the band never jumps from.
 */
function matchAfterDs(
  blocks: FormBlock[],
  key: string,
  passOffset: number,
  previousBlock: FormBlock | undefined
): FormBlock | undefined {
  const same = sameNamedBlocks(blocks, key);
  if (same.length === 0) return undefined;
  const byCount = same[passOffset];
  if (byCount) return byCount;
  if (previousBlock) {
    const byContext = same.find((block) => {
      const blockIndex = blocks.indexOf(block);
      return blocks[blockIndex - 1]?.id === previousBlock.id;
    });
    if (byContext) return byContext;
  }
  return same[0];
}

/** How many sections of this name the current pass has already been through. */
function passOffsetOf(sections: Section[], from: number, index: number, key: string): number {
  let offset = 0;
  for (let cursor = Math.max(0, from); cursor < index; cursor++) {
    const section = sections[cursor];
    if (section && blockKey(section, cursor) === key) offset += 1;
  }
  return offset;
}

/** A coda is a section the band jumps to. FINAL is the last section they play, not that jump. */
export function isCodaName(name: string): boolean {
  const n = name.trim().toUpperCase();
  return n === "CODA" || n.startsWith("CODA ");
}

export function songForm(song: Song | undefined, options: SongFormOptions = {}): SongForm {
  if (!song) return { blocks: [], visits: [] };
  const sections = sectionList(song);
  const blocks: FormBlock[] = [];
  const grooves = new Map<string, string>();
  const visits: FormVisit[] = [];
  const passById = new Map<string, number>();
  /** The section the current pass began at, so a repeat can be counted from its own start. */
  let passStart = 0;

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
    const sameNamed = sameNamedBlocks(blocks, key);
    const alreadyWritten = grooveAlreadyWritten(sameNamed, grooves, groove);
    const returned = visits.some((visit) => visit.fromJump === "ds");
    let block = matchWrittenBlock(
      blocks,
      grooves,
      key,
      groove,
      previousKey,
      previousBlock,
      runOffset(sections, index, key),
      sections,
      index
    );
    const lastSection = index === sections.length - 1;
    if (
      !block &&
      returned &&
      !isCodaName(section.name) &&
      (alreadyWritten || !lastSection)
    ) {
      // After D.S., the same named bars are that written row even when the return
      // adds a layer (Osman Ağa SAN A picks up TERS KICK LATIN). A different groove
      // on the last section is the ending, not another verse.
      block = matchAfterDs(blocks, key, passOffsetOf(sections, passStart, index, key), previousBlock);
    }
    if (!block) {
      // A later pass playing something written nowhere is still its own row: a song that
      // finishes on a rallentando leaves the written NAK. It is not a coda jump.
      block = {
        id: `form_${blocks.length}`,
        name: section.name,
        originIndex: index,
        originStart: section.start,
        originEnd: section.end,
        segno: false,
        coda: false,
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
    else if (pass > 1 && pairRepeat) fromJump = "repeat";
    else if (pass > 1) fromJump = "ds";
    // A return to the sign starts the count over: the sections of this pass are counted from
    // here, not from the top of the song.
    if (fromJump === "ds") passStart = index;
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
    if (from) from.ds = true;
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
