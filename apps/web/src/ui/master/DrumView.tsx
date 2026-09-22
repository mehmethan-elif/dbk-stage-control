import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  createId,
  isLockedElif,
  isTalkEntry,
  talkDisplayLabel,
  insertAfterSelected,
  trimElifAfterLastSong,
  isSongEntry,
  withKeyChangeElifs,
  PlaybackState,
  measureRangeFill,
  secondsPerMeasure,
  songDisplayName,
  tempoAt,
  timeToMusical,
  formAt,
  formNextAt,
  isRealMetronomeTrack,
  songForm,
  type FormBlock,
  type PatternEvent,
  type PatternNote,
  type Section,
  type SetlistEntry,
  type Song,
  type SongForm,
  type TempoPoint
} from "@dbk/core";
import { followClockPlaying, followClockTime } from "../../store/follow-clock";
import {
  readingOffShow,
  currentGig,
  elifCanEditSetlist,
  pageEntrySongId,
  pageEntryId,
  followsSharedPlayhead,
  panicBlocksFollow,
  selectAddedSetlistEntry,
  stageAutoScroll,
  stagePlayheadTime,
  useMasterStore
} from "../../store/master-store";
import {
  findSongByRef,
  isSongLibraryGig,
  librarySongsNotOnSetlist,
  selectedLibraryEntries,
  withSelectedLibrarySong
} from "../../store/song-library";
import { StageSetlist } from "./StageSetlist";
import { CONCERT_FINAL_LABEL, StageFinishRow, stageBodyEntries } from "./setlist-marker";
import { MetroDraftNotes } from "./metro-draft-notes";
import { StageSongHead } from "./StageSongHead";
import { SongTitleMeta } from "./stage-title-meta";
import { scrollStageToFollowedRows, stageLeadInNode } from "./stage-scroll";
import { usePinSelectedSong } from "./stage-pin";
import {
  handoffScrollEntryId,
  handoffScrollKey,
  ignoreOutgoingPlayhead,
  nextSetlistSongEntry,
  nextSongFollowId,
  upcomingSongLeadIn
} from "./next-song-section";
import { FormSectionBar } from "./form-marks";
import { hidesCountSection, isCountSection } from "./count-section";
import { sectionBarClass } from "./section-color";
import { paintSongCueBars, SongCueBars } from "./song-cue-bar";

const TIME_EPS = 0.02;
const STEPS_PER_BEAT = 4;

export function drumBarSteps(map: TempoPoint[], time: number): number {
  const beats = Math.max(1, Math.round(tempoAt(map, time).numerator) || 4);
  return Math.max(STEPS_PER_BEAT, beats * STEPS_PER_BEAT);
}
const NOTE_LANES = [
  { name: "F", pc: 5 },
  { name: "E", pc: 4 },
  { name: "D", pc: 2 },
  { name: "C", pc: 0 }
] as const;

interface TextCue {
  text: string;
  start: number;
  end: number;
}

interface PatternRun {
  name: string;
  start: number;
  end: number;
  cycle: number;
  repeats: number;
  written: number;
  steps: number;
  barSteps: number;
  hits: Map<string, Set<number>>;
  cue: TextCue | null;
}

interface SectionChart {
  section: Section;
  index: number;
  runs: PatternRun[];
}

type WrittenRow = SectionChart & { block: FormBlock };

function hasNotes(pattern: PatternEvent): boolean {
  return pattern.notes.length > 0;
}

function measureCount(map: TempoPoint[], start: number, end: number): number {
  if (end - start <= TIME_EPS) return 0;
  const first = timeToMusical(map, start + TIME_EPS).measure;
  const last = timeToMusical(map, end - TIME_EPS).measure;
  return Math.max(0, last - first + 1);
}

function measureEndAt(map: TempoPoint[], time: number): number {
  const point = tempoAt(map, time);
  const measure = timeToMusical(map, time).measure;
  return point.time + (measure - point.measure + 1) * secondsPerMeasure(point);
}

export function stepOf(
  note: PatternNote,
  start: number,
  steps: number,
  map: TempoPoint[],
  barSteps: number
): number {
  const origin = timeToMusical(map, start);
  const at = timeToMusical(map, note.time);
  const raw =
    (at.measure - origin.measure) * barSteps + (at.beat - origin.beat) * STEPS_PER_BEAT;
  return Math.max(0, Math.min(steps - 1, Math.round(raw)));
}

function hasPatternData(song: Song | undefined): boolean {
  return (song?.patterns?.length ?? 0) > 0;
}

function laneName(pitch: number): string | undefined {
  const pc = ((pitch % 12) + 12) % 12;
  return NOTE_LANES.find((lane) => lane.pc === pc)?.name;
}

export function buildHits(pattern: PatternEvent, map: TempoPoint[]): {
  hits: Map<string, Set<number>>;
  cycle: number;
  steps: number;
  barSteps: number;
  written: number;
} {
  const cycle = Math.max(TIME_EPS, pattern.end - pattern.time);
  const written = Math.max(1, measureCount(map, pattern.time, pattern.end));
  const barSteps = drumBarSteps(map, pattern.time);
  const steps = written * barSteps;
  const hits = new Map<string, Set<number>>();
  for (const note of pattern.notes) {
    const name = laneName(note.pitch);
    if (!name) continue;
    const lane = hits.get(name) ?? new Set<number>();
    lane.add(stepOf(note, pattern.time, steps, map, barSteps));
    hits.set(name, lane);
  }
  return { hits, cycle, steps, barSteps, written };
}

function isFillText(pattern: PatternEvent): boolean {
  return pattern.text.trim().toLocaleUpperCase("tr-TR") === "FILL";
}

function textCueBefore(
  texts: PatternEvent[],
  nextTime: number,
  map: TempoPoint[]
): TextCue | null {
  const last = texts.filter((pattern) => {
    if (pattern.time > nextTime - TIME_EPS) return false;
    return measureCount(map, pattern.time, nextTime) === 1;
  });
  const cue = last[last.length - 1];
  if (!cue) return null;
  return { text: cue.text.trim(), start: cue.time, end: Math.min(cue.end, nextTime) };
}

function runCue(
  texts: PatternEvent[],
  start: number,
  spanEnd: number,
  map: TempoPoint[]
): TextCue | null {
  const fills = texts.filter(
    (item) => isFillText(item) && item.time >= start - TIME_EPS && item.time < spanEnd - TIME_EPS
  );
  const fill = fills[fills.length - 1];
  if (fill) return { text: fill.text.trim(), start: fill.time, end: Math.min(fill.end, spanEnd) };
  return textCueBefore(texts, spanEnd, map);
}

/** FILL is text-only and can move on a later visit; read it from the visit, not the written bar. */
export function visitFillCue(
  song: Song | undefined,
  visit: { start: number; end: number } | null | undefined
): TextCue | null {
  if (!song || !visit) return null;
  const fills = (song.patterns ?? []).filter((pattern) => {
    if (hasNotes(pattern) || !isFillText(pattern)) return false;
    return pattern.time >= visit.start - TIME_EPS && pattern.time < visit.end - TIME_EPS;
  });
  const fill = fills[fills.length - 1];
  if (!fill) return null;
  return { text: fill.text.trim(), start: fill.time, end: Math.min(fill.end, visit.end) };
}

function cueLeadIn(map: TempoPoint[], start: number): number {
  return Math.max(0, start - secondsPerMeasure(tempoAt(map, start)));
}

function cuePhase(
  cue: TextCue,
  time: number,
  map: TempoPoint[],
  live: boolean
): "hidden" | "soon" | "live" {
  if (!live) return "hidden";
  if (time >= cue.start && time < cue.end) return "live";
  if (time >= cueLeadIn(map, cue.start) && time < cue.start) return "soon";
  return "hidden";
}

function patternRun(
  pattern: PatternEvent,
  spanEnd: number,
  map: TempoPoint[],
  cue: TextCue | null,
  start = pattern.time
): PatternRun {
  const written = Math.max(1, measureCount(map, pattern.time, pattern.end));
  const total = Math.max(written, measureCount(map, start, spanEnd));
  const built = buildHits(pattern, map);
  return {
    name: pattern.text.trim(),
    start,
    end: spanEnd,
    cycle: built.cycle,
    repeats: Math.max(1, Math.round(total / written)),
    written,
    steps: built.steps,
    barSteps: built.barSteps,
    hits: built.hits,
    cue
  };
}

function sameGrid(left: PatternRun, right: PatternRun): boolean {
  if (left.name !== right.name) return false;
  if (left.steps !== right.steps || left.barSteps !== right.barSteps) return false;
  if (left.hits.size !== right.hits.size) return false;
  for (const [lane, steps] of left.hits) {
    const other = right.hits.get(lane);
    if (!other || other.size !== steps.size) return false;
    for (const step of steps) if (!other.has(step)) return false;
  }
  return true;
}

/**
 * The same bar written out again is one bar played twice. A rallentando arrives as a pattern per
 * bar because every bar sits at its own tempo, and drawing those as TUS x1 TUS x1 asks the drummer
 * to read two rows that say one thing. Runs are joined on the grid rather than the name, so the
 * bar of the rall that thins out to the downbeat still gets its own row. A run carrying a text cue
 * keeps it by staying separate, since the cue belongs to the bar it was written in.
 */
function joinRepeatedRuns(runs: PatternRun[]): PatternRun[] {
  const joined: PatternRun[] = [];
  for (const run of runs) {
    const last = joined[joined.length - 1];
    if (last && !last.cue && !run.cue && Math.abs(last.end - run.start) < TIME_EPS && sameGrid(last, run)) {
      joined[joined.length - 1] = { ...last, end: run.end, repeats: last.repeats + run.repeats };
      continue;
    }
    joined.push(run);
  }
  return joined;
}

function sectionChart(song: Song | undefined): SectionChart[] {
  if (!song) return [];
  const sections =
    song.sections.length > 0 ? song.sections : [{ name: "", start: 0, end: song.duration }];
  const patterns = [...(song.patterns ?? [])].sort((a, b) => a.time - b.time);
  const midi = patterns.filter(hasNotes);
  const texts = patterns.filter((pattern) => !hasNotes(pattern));
  return sections.map((section, index) => {
    const runs: PatternRun[] = [];
    for (const pattern of midi) {
      if (pattern.time < section.start - TIME_EPS) continue;
      if (pattern.time >= section.end - TIME_EPS) break;
      const next = midi.find((item) => item.time >= pattern.end - TIME_EPS);
      const spanEnd = Math.min(next?.time ?? song.duration, section.end);
      runs.push(patternRun(pattern, spanEnd, song.tempoMap, runCue(texts, pattern.time, spanEnd, song.tempoMap)));
    }
    // Ayrıldım writes HALAY once, then only the SENKOP at the end of the next ARA.
    // The second ARA is still HALAY x5 + SENKOP x1 — the export just omitted the
    // opening bars. A few milliseconds of drift is not a missing groove.
    const firstMidi = midi.find(
      (item) => item.time >= section.start - TIME_EPS && item.time < section.end - TIME_EPS
    );
    const openingGap = firstMidi
      ? firstMidi.time - section.start
      : 0;
    const bar = secondsPerMeasure(tempoAt(song.tempoMap, section.start));
    if (firstMidi && openingGap > Math.max(TIME_EPS, bar * 0.5)) {
      const lateName = firstMidi.text.trim().toUpperCase();
      const carried = [...midi].reverse().find((item) => {
        if (item.time >= section.start - TIME_EPS) return false;
        const text = item.text.trim().toUpperCase();
        if (!text || text === "FILL") return false;
        return text !== lateName;
      });
      if (carried) {
        runs.unshift(
          patternRun(
            carried,
            firstMidi.time,
            song.tempoMap,
            runCue(texts, section.start, firstMidi.time, song.tempoMap),
            section.start
          )
        );
      }
    }
    if (runs.length === 0) {
      const inSection = (item: PatternEvent) =>
        item.time >= section.start - TIME_EPS && item.time < section.end - TIME_EPS;
      const sectionTexts = texts.filter(inSection);
      const carried = [...midi].reverse().find((item) => item.time < section.start - TIME_EPS);
      if (carried && sectionTexts.length > 0 && sectionTexts.every(isFillText)) {
        const next = midi.find((item) => item.time >= section.start - TIME_EPS);
        const spanEnd = Math.min(next?.time ?? song.duration, section.end);
        runs.push(
          patternRun(
            carried,
            spanEnd,
            song.tempoMap,
            runCue(sectionTexts, section.start, spanEnd, song.tempoMap),
            section.start
          )
        );
      } else {
        for (const pattern of sectionTexts) {
          if (isFillText(pattern)) continue;
          const next = texts.find((item) => item.time >= pattern.end - TIME_EPS && !isFillText(item));
          const spanEnd = Math.min(next?.time ?? section.end, section.end);
          runs.push(patternRun(pattern, spanEnd, song.tempoMap, null));
        }
      }
    }
    return { section, index, runs: joinRepeatedRuns(runs) };
  });
}

export function writtenChart(song: Song | undefined, form: SongForm): WrittenRow[] {
  const linear = sectionChart(song);
  return form.blocks.flatMap((block) => {
    const row = linear[block.originIndex];
    if (!row) return [];
    return [
      {
        ...row,
        block,
        runs: row.runs
          .filter((run) => run.start < block.originEnd - TIME_EPS)
          .map((run) => {
            const end = Math.min(run.end, block.originEnd);
            const total = Math.max(run.written, measureCount(song?.tempoMap ?? [], run.start, end));
            return { ...run, end, repeats: Math.max(1, Math.round(total / run.written)) };
          })
      }
    ];
  });
}

export function drumFollowKey(form: SongForm, time: number): string {
  return formAt(form, time)?.block.id ?? "";
}

/** The run the band reads next, including the first groove of a new section. */
export function nextDrumPatternRun(
  chart: WrittenRow[],
  pos: { block: { id: string } } | null,
  nextPos: { block: { id: string }; originTime: number } | null
): PatternRun | undefined {
  if (!nextPos) return undefined;
  const nextRow = chart.find((row) => row.block.id === nextPos.block.id);
  if (!nextRow) return undefined;
  const covering = nextRow.runs.find(
    (run) => nextPos.originTime >= run.start - TIME_EPS && nextPos.originTime < run.end
  );
  if (covering) return covering;
  if (pos && nextPos.block.id !== pos.block.id) return nextRow.runs[0];
  return undefined;
}

/**
 * Which written row the playhead sits on. `paintDrumLive` already marks it every frame, so
 * reading the marker back aims the scroll at the same row the drummer sees highlighted
 * without repeating the run maths here.
 */
function drumRowKey(stage: HTMLElement | null): string {
  const row = stage?.querySelector<HTMLElement>(".drum-run.current");
  if (!row) return "";
  return `${row.dataset.blockId ?? ""}@${row.dataset.runStart ?? ""}`;
}

/**
 * Played run (or its pack), plus the next pack. Lead-in of the next song is a next pack —
 * not a replacement for the row the playhead is on. Exclusive next-song scroll is only
 * for a wrap handoff, same as the chord page.
 */
export function drumFollowTargets(opts: {
  currentRun: Element | null;
  currentPack: Element | null;
  nextPack: Element | null;
  song: Element | null;
}): { current: Element | null; next: Element | null } {
  const pack = opts.currentRun?.closest(".drum-pack") ?? opts.currentPack;
  const firstPack = opts.song?.querySelector(".drum-pack") ?? opts.song;
  return { current: opts.currentRun ?? pack ?? firstPack, next: opts.nextPack };
}

function sectionFill(
  live: boolean,
  time: number,
  start: number,
  end: number,
  map?: TempoPoint[]
): number {
  if (!live) return 0;
  return measureRangeFill(map, start, end, time);
}

function sectionTakesFullRow(row: SectionChart, song: Song | undefined): boolean {
  return isCountSection(song, row.section) || row.runs.length >= 2;
}

function packSections(chart: SectionChart[], song: Song | undefined): SectionChart[][] {
  const packs: SectionChart[][] = [];
  for (const row of chart) {
    const last = packs[packs.length - 1];
    const head = last?.[0];
    if (
      last &&
      head &&
      last.length === 1 &&
      !sectionTakesFullRow(head, song) &&
      !sectionTakesFullRow(row, song)
    ) {
      last.push(row);
    } else {
      packs.push([row]);
    }
  }
  return packs;
}

function paintDrumLive(
  root: HTMLElement,
  chart: WrittenRow[],
  packs: WrittenRow[][],
  form: SongForm,
  time: number,
  map: TempoPoint[],
  song: Song | undefined,
  live: boolean,
  preview: boolean,
  chainNext: boolean
): void {
  const pos = live && !ignoreOutgoingPlayhead(song, time, chainNext) ? formAt(form, time) : null;
  const writtenTime = pos?.originTime ?? time;
  const currentRun = pos
    ? chart
        .find((row) => row.block.id === pos.block.id)
        ?.runs.find((run) => pos.originTime >= run.start && pos.originTime < run.end)
    : undefined;
  const actualMeasureEnd = pos ? measureEndAt(map, time) : 0;
  const visitOriginEnd = pos
    ? pos.block.originStart + Math.max(TIME_EPS, pos.visit.end - pos.visit.start)
    : 0;
  const originMeasureEnd = pos ? measureEndAt(map, pos.originTime) : 0;
  const afterOriginTime =
    pos &&
    (actualMeasureEnd >= pos.visit.end - TIME_EPS || originMeasureEnd >= visitOriginEnd - TIME_EPS)
      ? pos.block.originEnd
      : originMeasureEnd;
  const nextPos = chainNext ? null : pos ? formNextAt(form, time, afterOriginTime) : null;
  const nextRun = nextDrumPatternRun(chart, pos, nextPos);
  const visitIndex = pos ? form.visits.indexOf(pos.visit) : -1;
  const followingBlockId = visitIndex >= 0 ? form.visits[visitIndex + 1]?.blockId : undefined;

  root.querySelectorAll<HTMLElement>("[data-drum-pack]").forEach((el, packIndex) => {
    const written = packs[packIndex];
    if (!written) return;
    const packCurrent = written.some((row) => pos?.block.id === row.block.id);
    const packLeadIn = el.hasAttribute("data-lead-in");
    el.classList.toggle("current", packCurrent);
    el.classList.toggle(
      "next",
      packLeadIn || (!packCurrent && written.some((row) => nextPos?.block.id === row.block.id))
    );
    el.classList.toggle(
      "scroll-next",
      packLeadIn || (!packCurrent && written.some((row) => row.block.id === followingBlockId))
    );
  });

  for (const row of chart) {
    const visit = pos?.block.id === row.block.id ? pos.visit : null;
    const fill = visit ? sectionFill(live, time, visit.start, visit.end, song?.tempoMap) : 0;
    for (const el of root.querySelectorAll<HTMLElement>(`[data-drum-section="${row.block.id}"]`)) {
      const packLeadIn = Boolean(el.closest("[data-lead-in]"));
      el.classList.toggle("current", Boolean(live && visit));
      el.classList.toggle(
        "next",
        packLeadIn || (pos?.block.id !== row.block.id && nextPos?.block.id === row.block.id)
      );
      el.style.setProperty("--playhead", String(fill));
    }

    for (const el of root.querySelectorAll<HTMLElement>(`[data-block-id="${row.block.id}"][data-run-start]`)) {
      const start = Number(el.dataset.runStart);
      const run = row.runs.find((item) => Math.abs(item.start - start) < 1e-6);
      if (!run) continue;
      const current = currentRun === run && pos?.block.id === row.block.id;
      el.classList.toggle("current", current);
      el.classList.toggle(
        "next",
        currentRun !== run && nextRun === run && nextPos?.block.id === row.block.id
      );
      const runLive = live && pos?.block.id === row.block.id;
      const visitCue = visitFillCue(song, visit);
      const liveCue = visitCue ?? run.cue;
      const phase = liveCue ? cuePhase(liveCue, visitCue ? time : writtenTime, map, runLive) : "hidden";
      const cueLive = phase === "live";
      el.classList.toggle("cue-live", cueLive);
      const cue = el.querySelector<HTMLElement>(".drum-run-cue");
      if (cue) {
        cue.classList.toggle("current", cueLive);
        cue.hidden = phase === "hidden";
      }
      const count = el.querySelector(".drum-count");
      if (count) {
        const elapsed = current ? Math.max(0, (pos?.originTime ?? time) - run.start) : 0;
        count.textContent = String(
          current ? Math.min(run.repeats, Math.floor(elapsed / run.cycle) + 1) : 1
        );
      }
    }
  }
  paintSongCueBars(root, song, time, live || preview, "drum");
}

export function DrumView() {
  const songs = useMasterStore((s) => s.songs);
  const gig = useMasterStore(currentGig);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const selectSetlistEntry = useMasterStore((s) => s.selectSetlistEntry);
  const updateGig = useMasterStore((s) => s.updateGig);
  const playback = useMasterStore((s) => s.playback);
  const readOnly = useMasterStore((s) => s.deviceKind === "client");
  const elifEdits = useMasterStore(elifCanEditSetlist);
  const selectPracticeSong = useMasterStore((s) => s.selectPracticeSong);
  const setlistOpen = useMasterStore((s) => s.setlistOpen);
  const zoom = useMasterStore((s) => s.stageZooms.drums);
  const masterPage = useMasterStore((s) => s.masterPage);
  const autoScroll = useMasterStore(stageAutoScroll);
  // Someone reading a song out of the library is not watching the show, so nothing follows a
  // playhead until the master moves on and puts them back on it.
  const reading = useMasterStore(readingOffShow);
  const panicFollow = useMasterStore(panicBlocksFollow) && !reading;
  const detached = useMasterStore(followsSharedPlayhead);
  // The page opens where the master has the show, not where this device's selection is. They are
  // the same row everywhere except on Elif's, where selecting is how she reorders the setlist.
  const showEntry = useMasterStore(pageEntrySongId);
  // The row to scroll to, which is the ELIF KONUSMA or STOP itself rather than the song it leads
  // into. See `pageEntryId`.
  const scrollEntry = useMasterStore(pageEntryId);
  const metroFollow = useMasterStore((s) => s.metronomePlaying);
  const stageRef = useRef<HTMLElement>(null);
  const [leadInId, setLeadInId] = useState<string>();
  const [chainNext, setChainNext] = useState(false);
  const listEntries = gig
    ? isSongLibraryGig(gig)
      ? gig.setlist
      : withKeyChangeElifs(gig.setlist, songs)
    : [];
  const entries = listEntries.filter(isSongEntry);
  const library = librarySongsNotOnSetlist(songs, listEntries);
  const bodySource = isSongLibraryGig(gig)
    ? selectedLibraryEntries(listEntries, selectedEntryId)
    : readOnly
      ? withSelectedLibrarySong(listEntries, songs, showEntry)
      : listEntries;
  const playing =
    !reading &&
    (playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning);
  const following = playing || panicFollow || (metroFollow && !reading);
  const playingEntryId = detached && (playing || panicFollow)
    ? (playback.clock?.setlistEntryId ?? undefined)
    : !detached && following
      ? (showEntry ?? playback.clock?.setlistEntryId ?? undefined)
      : undefined;
  const liveEntryId =
    following && playback.clock?.setlistEntryId
      ? playback.clock.setlistEntryId
      : playingEntryId;
  const visible = (readOnly || isSongLibraryGig(gig) ? bodySource.filter(isSongEntry) : entries).filter(
    (entry) => !entry.skipped
  );
  const bodyEntries = stageBodyEntries(bodySource);
  const onLeadIn = useCallback((entryId: string | undefined, chain: boolean) => {
    setLeadInId((current) => (current === entryId ? current : entryId));
    setChainNext((current) => (current === chain ? current : chain));
  }, []);

  usePinSelectedSong(stageRef, "data-drum-song", {
    page: masterPage,
    scrollEntry,
    skip:
      panicFollow ||
      Boolean(
        autoScroll &&
          (playingEntryId ||
            playback.state === PlaybackState.Transitioning ||
            Boolean(playback.endedToEntryId))
      )
  });

  const addSong = (songId: string) => {
    if (!gig) return;
    const entryId = createId("entry");
    void updateGig((currentGigState) => ({
      ...currentGigState,
      setlist: insertAfterSelected(currentGigState.setlist, selectedEntryId, {
        type: "song",
        entryId,
        songId
      })
    })).then(() => selectAddedSetlistEntry(entryId));
  };

  const removeSong = (entryId: string) => {
    void updateGig((currentGigState) => ({
      ...currentGigState,
      setlist: trimElifAfterLastSong(
        currentGigState.setlist.filter((item) => item.entryId !== entryId)
      )
    }));
  };

  return (
    <div className="lyrics-page">
      <div className={`lyrics-body${setlistOpen ? "" : " no-setlist"}`}>
        {setlistOpen ? (
          <StageSetlist
            entries={listEntries}
            library={library}
            songs={songs}
            selectedEntryId={selectedEntryId}
            readOnly={readOnly && !elifEdits}
            onSelect={selectSetlistEntry}
            onRemove={removeSong}
            onAdd={addSong}
            onSelectLibrary={readOnly ? selectPracticeSong : undefined}
            stageRef={stageRef}
            songAttr="data-drum-song"
          />
        ) : null}
        <section
          ref={stageRef}
          className="lyrics-stage"
          style={{ "--lyrics-zoom": String(zoom) } as CSSProperties}
        >
          {visible.length === 0 ? (
            <div className="lyrics-empty meta">No patterns</div>
          ) : (
            <>
              {bodyEntries.map((entry) => {
                if (isTalkEntry(entry)) {
                  return (
                    <StageFinishRow
                      key={entry.entryId}
                      label={talkDisplayLabel(entry)}
                      entryId={entry.entryId}
                      locked={isLockedElif(entry)}
                      notes={entry.notes}
                      attr="data-drum-song"
                    />
                  );
                }
                if (!isSongEntry(entry)) return null;
                const item = findSongByRef(songs, entry.songId);
                return (
                  <SongPatterns
                    key={entry.entryId}
                    entryId={entry.entryId}
                    song={item}
                    live={liveEntryId === entry.entryId}
                    preview={showEntry === entry.entryId}
                    leadIn={leadInId === entry.entryId}
                    chainNext={
                      chainNext &&
                      liveEntryId === entry.entryId &&
                      leadInId !== entry.entryId
                    }
                  />
                );
              })}
              {entries.length > 0 ? <StageFinishRow label={CONCERT_FINAL_LABEL} /> : null}
              <DrumFollow
                stageRef={stageRef}
                songs={songs}
                bodySource={bodySource}
                playingEntryId={playingEntryId}
                selectedEntryId={showEntry ?? undefined}
                detached={detached}
                autoScroll={autoScroll}
                zoom={zoom}
                onLeadIn={onLeadIn}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function DrumFollow(props: {
  stageRef: { current: HTMLElement | null };
  songs: Song[];
  bodySource: readonly SetlistEntry[];
  playingEntryId: string | undefined;
  selectedEntryId: string | undefined;
  detached: boolean;
  autoScroll: boolean;
  zoom: number;
  onLeadIn: (entryId: string | undefined, chain: boolean) => void;
}) {
  const playback = useMasterStore((s) => s.playback);
  const [scrollKey, setScrollKey] = useState("");
  const [leadInId, setLeadInId] = useState<string>();
  const entries = props.bodySource.filter(isSongEntry);
  const playingSong = findSongByRef(
    props.songs,
    playback.clock?.songId ??
      entries.find((entry) => entry.entryId === props.selectedEntryId)?.songId
  );
  const form = useMemo(() => songForm(playingSong, { identity: "drums" }), [playingSong]);
  const propsRef = useRef(props);
  const songRef = useRef(playingSong);
  const formRef = useRef(form);
  propsRef.current = props;
  songRef.current = playingSong;
  formRef.current = form;

  useEffect(() => {
    if (!props.playingEntryId) {
      setScrollKey("");
      const playback = useMasterStore.getState().playback;
      if (
        playback.state !== PlaybackState.Transitioning &&
        !playback.endedToEntryId
      ) {
        setLeadInId(undefined);
        props.onLeadIn(undefined, false);
      }
      return;
    }
    let handle = 0;
    let lastKey = "";
    let lastLead: string | undefined;
    let lastHandoff: string | undefined;
    let lastTime = Number.NaN;
    const loop = () => {
      const current = propsRef.current;
      const song = songRef.current;
      const state = useMasterStore.getState();
      const raw = followClockPlaying() ? followClockTime() : stagePlayheadTime(state);
      const time = song && song.duration > 0 ? Math.min(song.duration, raw) : raw;
      const entryId = state.playback.clock?.setlistEntryId ?? current.playingEntryId;
      const nextEntry = nextSetlistSongEntry(current.bodySource, entryId);
      const upcoming = entryId
        ? upcomingSongLeadIn(current.bodySource, current.songs, entryId, song, time)
        : undefined;
      const followId = nextSongFollowId({
        playingEntryId: entryId,
        clockEntryId: state.playback.clock?.setlistEntryId,
        upcomingId: undefined,
        latchedId: lastHandoff,
        prevTime: lastTime,
        time: raw,
        duration: song?.duration ?? 0,
        nextEntryId: nextEntry?.entryId
      });
      lastTime = raw;
      lastHandoff = followId;
      const leadId = followId ?? upcoming?.entryId;
      if (followId) {
        const key = handoffScrollKey(followId);
        if (key !== lastKey) {
          lastKey = key;
          setScrollKey(key);
        }
        if (leadId !== lastLead) {
          lastLead = leadId;
          setLeadInId(leadId);
          current.onLeadIn(leadId, true);
        }
        handle = requestAnimationFrame(loop);
        return;
      }
      const block = entryId && song ? drumFollowKey(formRef.current, time) : "";
      // A section lasts several bars, so keying the scroll on it alone let the playhead run
      // off the bottom of the view before anything moved. The row is the scroll target, but
      // the measure is what re-aims: a row of eight repeats holds one row key for eight bars,
      // and until the key changes a hand scroll away from the playhead is never corrected.
      // The score page re-aims every measure, so match that — the scroll policy returns
      // "no move" when the target is already in view, so this costs one layout read a bar.
      const row = block ? drumRowKey(current.stageRef.current) || block : "";
      const key = row && song ? `${row}#${timeToMusical(song.tempoMap, time).measure}` : row;
      if (key !== lastKey) {
        lastKey = key;
        setScrollKey(key);
      }
      if (leadId !== lastLead) {
        lastLead = leadId;
        setLeadInId(leadId);
        current.onLeadIn(leadId, Boolean(leadId));
      }
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, [props.playingEntryId, props.onLeadIn]);

  useEffect(() => {
    if (!props.autoScroll || !props.playingEntryId) return;
    const stage = props.stageRef.current;
    if (!stage) return;
    const wrapId = handoffScrollEntryId(scrollKey);
    const article = wrapId ? stage.querySelector(`[data-drum-song="${wrapId}"]`) : null;
    const nextFirst =
      (article instanceof HTMLElement
        ? article.querySelector(".drum-pack") ?? article
        : null) ?? stageLeadInNode(stage, "data-drum-song", wrapId);
    if (wrapId && nextFirst instanceof HTMLElement) {
      scrollStageToFollowedRows(stage, nextFirst, null);
      return;
    }
    const liveId = playback.clock?.setlistEntryId ?? props.playingEntryId ?? props.selectedEntryId;
    const song = liveId ? stage.querySelector(`[data-drum-song="${liveId}"]`) : null;
    const root = song instanceof HTMLElement ? song : stage;
    const { current, next } = drumFollowTargets({
      currentRun: root.querySelector(".drum-run.current"),
      currentPack: root.querySelector(".drum-pack.current"),
      nextPack: stage.querySelector(".drum-pack.scroll-next"),
      song
    });
    const leadIn = stageLeadInNode(stage, "data-drum-song", leadInId);
    if (!(current instanceof HTMLElement) && !(leadIn instanceof HTMLElement) && !(next instanceof HTMLElement)) {
      return;
    }
    scrollStageToFollowedRows(stage, current, next, leadIn);
  }, [
    props.autoScroll,
    scrollKey,
    props.playingEntryId,
    props.selectedEntryId,
    props.zoom,
    leadInId,
    playback.clock?.setlistEntryId
  ]);

  return null;
}

const SongPatterns = memo(function SongPatterns(props: {
  entryId: string;
  song: Song | undefined;
  live: boolean;
  preview?: boolean;
  leadIn?: boolean;
  chainNext?: boolean;
}) {
  return (
    <article
      className="lyrics-song"
      data-drum-song={props.entryId}
      data-lead-in={props.leadIn && !hasPatternData(props.song) ? "" : undefined}
    >
      <StageSongHead songId={props.song?.id} entryId={props.entryId} page="drums">
        <span className="nota-song-name">{songDisplayName(props.song)}</span>
        <SongTitleMeta song={props.song} entryId={props.entryId} page="drums" />
      </StageSongHead>
      <DrumChartBody
        song={props.song}
        live={props.live}
        preview={props.preview}
        leadIn={props.leadIn}
        chainNext={props.chainNext}
      />
    </article>
  );
});

export const DrumChartBody = memo(function DrumChartBody(props: {
  song: Song | undefined;
  live?: boolean;
  preview?: boolean;
  leadIn?: boolean;
  chainNext?: boolean;
}) {
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const files = props.song
    ? [...(fileIndex[props.song.id] ?? []), ...(props.song.folder ? (fileIndex[props.song.folder] ?? []) : [])]
    : undefined;
  const live = Boolean(props.live);
  const form = useMemo(() => songForm(props.song, { identity: "drums" }), [props.song]);
  const chart = useMemo(
    () => (hasPatternData(props.song) ? writtenChart(props.song, form) : []),
    [props.song, form]
  );
  const packs = useMemo(() => packSections(chart.filter((row) => !hidesCountSection(props.song, row.section)), props.song) as WrittenRow[][], [chart, props.song]);
  const map = props.song?.tempoMap ?? [];
  const rootRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef(chart);
  const packsRef = useRef(packs);
  const formRef = useRef(form);
  const mapRef = useRef(map);
  const songRef = useRef(props.song);
  chartRef.current = chart;
  packsRef.current = packs;
  formRef.current = form;
  mapRef.current = map;
  songRef.current = props.song;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const paint = (time: number) =>
      paintDrumLive(
        root,
        chartRef.current,
        packsRef.current,
        formRef.current,
        time,
        mapRef.current,
        songRef.current,
        live,
        Boolean(props.preview),
        Boolean(props.chainNext)
      );
    if (!live) {
      paint(props.preview ? stagePlayheadTime(useMasterStore.getState()) : 0);
      if (!props.preview) return;
      return useMasterStore.subscribe((state) => {
        paint(stagePlayheadTime(state));
      });
    }
    let handle = 0;
    const loop = () => {
      const time = followClockPlaying()
        ? followClockTime()
        : stagePlayheadTime(useMasterStore.getState());
      paint(time);
      handle = requestAnimationFrame(loop);
    };
    paint(
      followClockPlaying() ? followClockTime() : stagePlayheadTime(useMasterStore.getState())
    );
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, [live, props.preview, props.chainNext, props.song?.id]);

  if (chart.length === 0) {
    return isRealMetronomeTrack(props.song, files) ? (
      <MetroDraftNotes
        song={props.song}
        files={files}
        page="drums"
        label="Paste pattern notes"
        emptyLabel="No Pattern Data"
      />
    ) : (
      <div className="lyrics-empty meta">No Pattern Data</div>
    );
  }
  return (
    <div ref={rootRef} className="drum-section-list">
      {packs.map((written, packIndex) => {
        const showGrids = written.some((row) => !isCountSection(props.song, row.section));
        const spanRow = written.some(
          (row) => !isCountSection(props.song, row.section) && row.runs.length >= 2
        );
        const pair = written.length === 2;
        return (
          <div
            key={written.map((row) => row.block.id).join("+")}
            data-drum-pack={written.map((row) => row.block.id).join("+")}
            data-lead-in={props.leadIn && packIndex === 0 ? "" : undefined}
            className={`drum-pack wide${pair ? " pair" : ""}`}
          >
            <div className={`drum-pack-titles${spanRow ? " span" : ""}`}>
              {written.map((row) => (
                <DrumSectionTitle key={row.block.id} row={row} song={props.song} block={row.block} />
              ))}
            </div>
            {showGrids ? (
              <div className="drum-pack-grids">
                {written.map((row) =>
                  isCountSection(props.song, row.section) ? (
                    <div key={row.block.id} />
                  ) : (
                    <div
                      key={row.block.id}
                      data-drum-section={row.block.id}
                      className="drum-section-runs"
                    >
                      {row.runs.map((run) => (
                          <DrumRunView
                            key={`${run.name}-${run.start}`}
                            run={run}
                            blockId={row.block.id}
                          />
                        ))}
                    </div>
                  )
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      <SongCueBars
        song={props.song}
        time={0}
        active={false}
        attrPrefix="drum"
      />
    </div>
  );
});

function DrumSectionTitle(props: {
  row: SectionChart;
  song: Song | undefined;
  block: FormBlock;
}) {
  const isCount = isCountSection(props.song, props.row.section);
  if (!props.row.section.name) return <div />;
  const extra = isCount
    ? props.row.runs.map((run) => run.name).filter(Boolean).join("  ")
    : null;
  return (
    <div
      data-drum-section={props.block.id}
      className={`lyrics-section drum-section-name playhead-green${sectionBarClass(props.row.section.name)}`}
    >
      <span className="lyrics-playhead" aria-hidden="true" />
      <div className="lyrics-cue-body drum-section-bar">
        <FormSectionBar
          block={props.block}
          showRepeats={false}
          extra={extra}
          extraClass={isCount ? "drum-count-label" : undefined}
        />
      </div>
    </div>
  );
}

function DrumRunView(props: {
  run: PatternRun;
  blockId: string;
}) {
  const barSteps = Math.max(STEPS_PER_BEAT, props.run.barSteps);
  return (
    <div
      className="drum-run"
      data-drum-row={`${props.run.name}-${props.run.start}`}
      data-block-id={props.blockId}
      data-run-start={String(props.run.start)}
      style={
        {
          "--drum-steps": String(props.run.steps),
          "--drum-bar-steps": String(barSteps)
        } as CSSProperties
      }
    >
      <div className="drum-run-grid">
        <div className="drum-measure-name">
          <span className="drum-pattern-name">{props.run.name}</span>
          <span className="drum-repeat">
            <span>x{props.run.repeats}</span>
            <span className="drum-count">1</span>
          </span>
          {props.run.cue ? (
            <span className="drum-run-cue" hidden>
              {props.run.cue.text}
            </span>
          ) : null}
        </div>
        <div className="drum-grid">
          {NOTE_LANES.map((lane) => {
            const hits = [...(props.run.hits.get(lane.name) ?? [])].sort((left, right) => left - right);
            return (
              <div key={lane.name} className="drum-lane">
                {hits.map((step) => (
                  <span
                    key={step}
                    data-note={lane.name}
                    className="drum-hit"
                    style={{ "--drum-hit": String(step) } as CSSProperties}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
