import { useEffect, useRef, type CSSProperties } from "react";
import {
  createId,
  FinishMode,
  ELIF_KONUSMA_LABEL,
  isElifKonusma,
  isLockedElif,
  insertAfterSelected,
  isSongEntry,
  withKeyChangeElifs,
  PlaybackState,
  PlayMode,
  secondsPerMeasure,
  songDisplayName,
  tempoAt,
  timeToMusical,
  formAt,
  formNextAt,
  songForm,
  type FormBlock,
  type FormVisit,
  type PatternEvent,
  type PatternNote,
  type Section,
  type Song,
  type SongForm,
  type TempoPoint
} from "@dbk/core";
import { currentGig, useMasterStore } from "../../store/master-store";
import { StageSetlist } from "./StageSetlist";
import { CONCERT_FINAL_LABEL, StageFinishRow, stageBodyEntries } from "./setlist-marker";
import { StageSongHead } from "./StageSongHead";
import { SongTitleMeta } from "./stage-title-meta";
import { scrollStageToFullSections, scrollStageToSongTitle } from "./stage-scroll";
import { ChordRepeatMark, FormSectionBar } from "./form-marks";
import { isCountSection } from "./count-section";
import { sectionBarClass } from "./section-color";

const TIME_EPS = 0.02;
const STEPS_PER_MEASURE = 16;
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
  hits: Map<string, Set<number>>;
  cue: TextCue | null;
}

interface SectionChart {
  section: Section;
  index: number;
  runs: PatternRun[];
}

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

function stepOf(note: PatternNote, start: number, steps: number, map: TempoPoint[]): number {
  const origin = timeToMusical(map, start);
  const at = timeToMusical(map, note.time);
  const meter = tempoAt(map, note.time);
  const stepsPerBeat = STEPS_PER_MEASURE / Math.max(1, meter.numerator);
  const raw =
    (at.measure - origin.measure) * STEPS_PER_MEASURE + (at.beat - origin.beat) * stepsPerBeat;
  return Math.max(0, Math.min(steps - 1, Math.round(raw)));
}

function hasPatternData(song: Song | undefined): boolean {
  return (song?.patterns?.length ?? 0) > 0;
}

function laneName(pitch: number): string | undefined {
  const pc = ((pitch % 12) + 12) % 12;
  return NOTE_LANES.find((lane) => lane.pc === pc)?.name;
}

function buildHits(pattern: PatternEvent, map: TempoPoint[]): {
  hits: Map<string, Set<number>>;
  cycle: number;
  steps: number;
  written: number;
} {
  const cycle = Math.max(TIME_EPS, pattern.end - pattern.time);
  const written = Math.max(1, measureCount(map, pattern.time, pattern.end));
  const steps = written * STEPS_PER_MEASURE;
  const hits = new Map<string, Set<number>>();
  for (const note of pattern.notes) {
    const name = laneName(note.pitch);
    if (!name) continue;
    const lane = hits.get(name) ?? new Set<number>();
    lane.add(stepOf(note, pattern.time, steps, map));
    hits.set(name, lane);
  }
  return { hits, cycle, steps, written };
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
  cue: TextCue | null
): PatternRun {
  const written = Math.max(1, measureCount(map, pattern.time, pattern.end));
  const total = Math.max(written, measureCount(map, pattern.time, spanEnd));
  const built = buildHits(pattern, map);
  return {
    name: pattern.text.trim(),
    start: pattern.time,
    end: spanEnd,
    cycle: built.cycle,
    repeats: Math.max(1, Math.round(total / written)),
    written,
    steps: built.steps,
    hits: built.hits,
    cue
  };
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
      runs.push(patternRun(pattern, spanEnd, song.tempoMap, textCueBefore(texts, spanEnd, song.tempoMap)));
    }
    if (runs.length === 0) {
      for (const pattern of texts) {
        if (pattern.time < section.start - TIME_EPS) continue;
        if (pattern.time >= section.end - TIME_EPS) break;
        const next = texts.find((item) => item.time >= pattern.end - TIME_EPS);
        const spanEnd = Math.min(next?.time ?? section.end, section.end);
        runs.push(patternRun(pattern, spanEnd, song.tempoMap, null));
      }
    }
    return { section, index, runs };
  });
}

function writtenChart(song: Song | undefined, form: SongForm): (SectionChart & { block: FormBlock })[] {
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

export function DrumView() {
  const songs = useMasterStore((s) => s.songs);
  const gig = useMasterStore(currentGig);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const selectSetlistEntry = useMasterStore((s) => s.selectSetlistEntry);
  const updateGig = useMasterStore((s) => s.updateGig);
  const previewTime = useMasterStore((s) => s.previewTime);
  const playback = useMasterStore((s) => s.playback);
  const readOnly = useMasterStore((s) => s.deviceKind === "client");
  const setlistOpen = useMasterStore((s) => s.setlistOpen);
  const zoom = useMasterStore((s) => s.stageZooms.drums);
  const autoScroll = useMasterStore((s) => s.autoScroll);
  const listEntries = gig ? withKeyChangeElifs(gig.setlist, songs) : [];
  const entries = listEntries.filter(isSongEntry);
  const addedIds = new Set(entries.map((entry) => entry.songId));
  const library = songs.filter((item) => !addedIds.has(item.id));
  const playing =
    playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
  const playingEntryId = playing
    ? (playback.clock?.setlistEntryId ?? selectedEntryId ?? undefined)
    : undefined;
  const liveTime = playing ? (playback.clock?.time ?? previewTime) : previewTime;
  const stageRef = useRef<HTMLElement>(null);
  const visible = entries.filter((entry) => !entry.skipped);
  const bodyEntries = stageBodyEntries(listEntries);

  useEffect(() => {
    if (autoScroll && playingEntryId) return;
    if (!selectedEntryId) return;
    scrollStageToSongTitle(stageRef.current, `[data-drum-song="${selectedEntryId}"]`);
  }, [selectedEntryId, autoScroll, playingEntryId]);

  useEffect(() => {
    if (!autoScroll || !playingEntryId) return;
    const stage = stageRef.current;
    if (!stage) return;
    const row = stage.querySelector(".drum-run.current");
    const current =
      row?.closest(".drum-pack") ?? stage.querySelector(".drum-pack.current");
    const next = stage.querySelector(".drum-pack.scroll-next");
    const fallbackId = playingEntryId ?? selectedEntryId;
    const fallback = fallbackId ? stage.querySelector(`[data-drum-song="${fallbackId}"]`) : null;
    const node = current ?? fallback;
    if (!(node instanceof HTMLElement)) return;
    scrollStageToFullSections(stage, node, next instanceof HTMLElement ? next : null);
  }, [autoScroll, liveTime, playingEntryId, selectedEntryId, zoom]);

  const addSong = (songId: string) => {
    if (!gig) return;
    const entryId = createId("entry");
    void updateGig((currentGigState) => ({
      ...currentGigState,
      setlist: insertAfterSelected(currentGigState.setlist, selectedEntryId, {
        type: "song",
        entryId,
        songId,
        finishMode: FinishMode.Stop,
        playMode: PlayMode.View
      })
    })).then(() => selectSetlistEntry(entryId));
  };

  const toggleSkip = (entryId: string) => {
    void updateGig((currentGigState) => ({
      ...currentGigState,
      setlist: currentGigState.setlist.map((item) =>
        item.entryId === entryId && isSongEntry(item) ? { ...item, skipped: !item.skipped } : item
      )
    }));
  };

  return (
    <div className="lyrics-page">
      <div className={`lyrics-body${setlistOpen ? "" : " no-setlist"}`}>
        {setlistOpen ? (
          <StageSetlist
            entries={listEntries}
            library={readOnly ? [] : library}
            songs={songs}
            selectedEntryId={selectedEntryId}
            readOnly={readOnly}
            onSelect={selectSetlistEntry}
            onSkip={toggleSkip}
            onAdd={addSong}
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
                if (isElifKonusma(entry)) {
                  return (
                    <StageFinishRow
                      key={entry.entryId}
                      label={ELIF_KONUSMA_LABEL}
                      entryId={entry.entryId}
                      locked={isLockedElif(entry)}
                      attr="data-drum-song"
                    />
                  );
                }
                if (!isSongEntry(entry)) return null;
                const item = songs.find((row) => row.id === entry.songId);
                return (
                  <SongPatterns
                    key={entry.entryId}
                    entryId={entry.entryId}
                    song={item}
                    live={playingEntryId === entry.entryId}
                    time={liveTime}
                  />
                );
              })}
              {entries.length > 0 ? <StageFinishRow label={CONCERT_FINAL_LABEL} /> : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function sectionFill(live: boolean, time: number, start: number, end: number): number {
  if (!live) return 0;
  if (time < start) return 0;
  if (time >= end) return 1;
  const span = end - start;
  return span <= 0 ? 1 : (time - start) / span;
}

function isWideSection(row: SectionChart, song: Song | undefined): boolean {
  return (
    isCountSection(song, row.section) ||
    row.runs.length >= 2 ||
    row.runs.some((run) => run.written >= 2)
  );
}

function packSections(chart: SectionChart[], song: Song | undefined): SectionChart[][] {
  const packs: SectionChart[][] = [];
  for (const row of chart) {
    const last = packs[packs.length - 1];
    if (
      !isWideSection(row, song) &&
      last &&
      last.length === 1 &&
      !isWideSection(last[0], song)
    ) {
      last.push(row);
    } else {
      packs.push([row]);
    }
  }
  return packs;
}

function runTakesFullRow(runs: PatternRun[], index: number): boolean {
  const run = runs[index];
  if (!run) return false;
  if (run.written >= 2) return true;

  let segmentStart = index;
  while (segmentStart > 0 && (runs[segmentStart - 1]?.written ?? 2) < 2) {
    segmentStart--;
  }
  let segmentEnd = index;
  while (segmentEnd + 1 < runs.length && (runs[segmentEnd + 1]?.written ?? 2) < 2) {
    segmentEnd++;
  }
  const segmentLength = segmentEnd - segmentStart + 1;
  return segmentLength % 2 === 1 && index === segmentEnd;
}

function SongPatterns(props: {
  entryId: string;
  song: Song | undefined;
  live: boolean;
  time: number;
}) {
  const form = songForm(props.song);
  const chart = hasPatternData(props.song) ? writtenChart(props.song, form) : [];
  const map = props.song?.tempoMap ?? [];
  const runs = chart.flatMap((section) => section.runs);
  const pos = props.live ? formAt(form, props.time) : null;
  const currentRun = pos
    ? runs.find((run) => pos.originTime >= run.start && pos.originTime < run.end)
    : undefined;
  const actualMeasureEnd = pos ? measureEndAt(map, props.time) : 0;
  const afterOriginTime =
    pos && actualMeasureEnd >= pos.visit.end - TIME_EPS
      ? pos.block.originEnd
      : pos
        ? measureEndAt(map, pos.originTime)
        : 0;
  const nextPos = pos ? formNextAt(form, props.time, afterOriginTime) : null;
  const nextRow = nextPos ? chart.find((row) => row.block.id === nextPos.block.id) : undefined;
  const nextRun = nextRow?.runs.find(
    (run) => nextPos != null && nextPos.originTime >= run.start && nextPos.originTime < run.end
  );
  const visitIndex = pos ? form.visits.indexOf(pos.visit) : -1;
  const followingBlockId =
    visitIndex >= 0 ? form.visits[visitIndex + 1]?.blockId : undefined;
  const playTime = pos?.originTime ?? props.time;

  return (
    <article className="lyrics-song" data-drum-song={props.entryId}>
      <StageSongHead songId={props.song?.id} page="drums">
        <span className="nota-song-name">{songDisplayName(props.song)}</span>
        <SongTitleMeta song={props.song} entryId={props.entryId} />
      </StageSongHead>
      {chart.length === 0 ? (
        <div className="lyrics-empty meta">No Pattern Data</div>
      ) : (
        <div className="drum-section-list">
        {packSections(chart, props.song).map((pack) => {
          const written = pack as (SectionChart & { block: FormBlock })[];
          const wide = written.length === 1 && isWideSection(written[0], props.song);
          const packCurrent = written.some((row) => pos?.block.id === row.block.id);
          const packNext =
            !packCurrent && written.some((row) => nextPos?.block.id === row.block.id);
          const packScrollNext =
            !packCurrent && written.some((row) => row.block.id === followingBlockId);
          const showGrids = written.some((row) => !isCountSection(props.song, row.section));
          return (
            <div
              key={written.map((row) => row.block.id).join("+")}
              data-drum-pack={written.map((row) => row.block.id).join("+")}
              className={`drum-pack${wide ? " wide" : ""}${packCurrent ? " current" : ""}${
                packNext ? " next" : ""
              }${packScrollNext ? " scroll-next" : ""}`}
            >
              <div className="drum-pack-titles">
                {written.map((row) => (
                  <DrumSectionTitle
                    key={row.block.id}
                    row={row}
                    song={props.song}
                    block={row.block}
                    form={form}
                    visit={pos?.block.id === row.block.id ? pos.visit : null}
                    next={pos?.block.id !== row.block.id && nextPos?.block.id === row.block.id}
                    live={props.live}
                    time={props.time}
                  />
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
                        {row.runs.map((run, runIndex) => (
                          <DrumRunView
                            key={`${run.name}-${run.start}`}
                            run={run}
                            fullWidth={runTakesFullRow(row.runs, runIndex)}
                            current={currentRun === run && pos?.block.id === row.block.id}
                            next={
                              currentRun !== run &&
                              nextRun === run &&
                              nextPos?.block.id === row.block.id
                            }
                            time={playTime}
                            map={map}
                            live={props.live && pos?.block.id === row.block.id}
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
        </div>
      )}
    </article>
  );
}

function DrumSectionTitle(props: {
  row: SectionChart;
  song: Song | undefined;
  block: FormBlock;
  form: SongForm;
  visit: FormVisit | null;
  next: boolean;
  live: boolean;
  time: number;
}) {
  const isCount = isCountSection(props.song, props.row.section);
  const isCurrent = props.live && props.visit != null;
  const fill = props.visit
    ? sectionFill(props.live, props.time, props.visit.start, props.visit.end)
    : 0;
  if (!props.row.section.name) return <div />;
  const extra = isCount
    ? props.row.runs.map((run) => run.name).filter(Boolean).join("  ")
    : null;
  return (
    <div
      data-drum-section={props.block.id}
      className={`lyrics-section drum-section-name playhead-green${sectionBarClass(props.row.section.name)}${isCurrent ? " current" : ""}${
        props.next ? " next" : ""
      }${props.block.repeatStart ? " repeat-start" : ""}${props.block.repeatEnd ? " repeat-end" : ""}`}
      style={{ "--playhead": String(fill) } as CSSProperties}
    >
      <span className="lyrics-playhead" aria-hidden="true" />
      {props.block.repeatStart ? <ChordRepeatMark side="start" /> : null}
      <div className="lyrics-cue-body drum-section-bar">
        <FormSectionBar
          block={props.block}
          form={props.form}
          visit={props.visit}
          showRepeats={false}
          extra={extra}
          extraClass={isCount ? "drum-count-label" : undefined}
        />
      </div>
      {props.block.repeatEnd ? <ChordRepeatMark side="end" /> : null}
    </div>
  );
}

function DrumRunView(props: {
  run: PatternRun;
  fullWidth: boolean;
  current: boolean;
  next: boolean;
  time: number;
  map: TempoPoint[];
  live: boolean;
}) {
  const phase = props.run.cue ? cuePhase(props.run.cue, props.time, props.map, props.live) : "hidden";
  const cueLive = phase === "live";
  const elapsed = props.current ? Math.max(0, props.time - props.run.start) : 0;
  const inCycle = props.current ? elapsed % props.run.cycle : -1;
  const currentStep =
    inCycle >= 0
      ? Math.min(
          props.run.steps - 1,
          Math.floor((inCycle / props.run.cycle) * props.run.steps)
        )
      : -1;
  const currentBeat = currentStep >= 0 ? currentStep - (currentStep % 4) : -1;
  const currentRepeat = props.current
    ? Math.min(props.run.repeats, Math.floor(elapsed / props.run.cycle) + 1)
    : 1;
  return (
    <div
      className={`drum-run${props.fullWidth ? " wide" : ""}${props.current ? " current" : ""}${
        props.next ? " next" : ""
      }${cueLive ? " cue-live" : ""}`}
      data-drum-row={`${props.run.name}-${props.run.start}`}
      style={{ "--drum-steps": String(props.run.steps) } as CSSProperties}
    >
      <div className="drum-run-grid">
                      <div className="drum-measure-name">
          <span className="drum-pattern-name">{props.run.name}</span>
          {props.run.repeats > 1 ? (
            <span className="drum-repeat">
              <span>x{props.run.repeats}</span>
              <span className="drum-count">{currentRepeat}</span>
            </span>
          ) : null}
          {props.run.cue && phase !== "hidden" ? (
            <span className={`drum-run-cue${cueLive ? " current" : ""}`}>
              {props.run.cue.text}
            </span>
          ) : null}
        </div>
        <div className="drum-grid">
          {NOTE_LANES.map((lane) => {
            const steps = props.run.hits.get(lane.name);
            return (
              <div key={lane.name} className="drum-lane">
                {Array.from({ length: props.run.steps }, (_, step) => (
                  <span
                    key={step}
                    data-note={lane.name}
                    className={`drum-step${steps?.has(step) ? " hit" : ""}${
                      step % STEPS_PER_MEASURE === 0 ? " measure" : step % 4 === 0 ? " beat" : ""
                    }`}
                  />
                ))}
              </div>
            );
          })}
          {currentBeat >= 0 ? (
            <div
              className="drum-playhead"
              style={{ left: `${(currentBeat / props.run.steps) * 100}%` }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
