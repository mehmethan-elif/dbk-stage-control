import { useEffect, useRef, type CSSProperties } from "react";
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
  PlayMode,
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
  type FormVisit,
  type PatternEvent,
  type PatternNote,
  type Section,
  type Song,
  type SongForm,
  type TempoPoint
} from "@dbk/core";
import { useFollowPlayheadTime } from "../../store/follow-clock";
import { clientPracticeMode, currentGig, elifCanEditSetlist, elifLookingAhead, followsSharedPlayhead, panicBlocksFollow, selectAddedSetlistEntry, stageAutoScroll, stagePlayheadTime, useMasterStore } from "../../store/master-store";
import { findSongByRef, isSongLibraryGig, librarySongsNotOnSetlist, selectedLibraryEntries, withSelectedLibrarySong } from "../../store/song-library";
import { StageSetlist } from "./StageSetlist";
import { CONCERT_FINAL_LABEL, StageFinishRow, stageBodyEntries } from "./setlist-marker";
import { MetroDraftNotes } from "./metro-draft-notes";
import { StageSongHead } from "./StageSongHead";
import { SongTitleMeta } from "./stage-title-meta";
import {
  scrollStageToFullSections,
  scrollStageToNextSongTitleInUpperHalf,
  scrollStageToSongTitleWhenReady,
  stageLeadInNode
} from "./stage-scroll";
import { upcomingSongLeadIn } from "./next-song-section";
import { ChordRepeatMark, FormSectionBar } from "./form-marks";
import { isCountSection } from "./count-section";
import { sectionBarClass } from "./section-color";
import { firstTempoChangeMeasure, rallDrumTone, runShowsRallBar } from "./rall-alert";

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

function hasNotes(pattern: PatternEvent): boolean {
  return pattern.notes.length > 0;
}

function measureCount(map: TempoPoint[], start: number, end: number): number {
  if (end - start <= TIME_EPS) return 0;
  const first = timeToMusical(map, start + TIME_EPS).measure;
  const last = timeToMusical(map, end - TIME_EPS).measure;
  return Math.max(0, last - first + 1);
}

function isLastNamedChartRow(
  chart: readonly { section: Section }[],
  row: { section: Section }
): boolean {
  return chart.findLast((item) => item.section.name === row.section.name) === row;
}

function sectionFollowsPlayhead(
  song: Song | undefined,
  section: Section,
  time: number,
  follow: boolean
): boolean {
  if (!follow || !song) return false;
  return song.sections.some(
    (item) =>
      item.name === section.name &&
      time >= item.start &&
      time < item.end - TIME_EPS
  );
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
    barSteps: built.barSteps,
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

export function writtenChart(song: Song | undefined, form: SongForm): (SectionChart & { block: FormBlock })[] {
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
  const playback = useMasterStore((s) => s.playback);
  const storeTime = useMasterStore(stagePlayheadTime);
  const followTime = useFollowPlayheadTime(storeTime);
  const readOnly = useMasterStore((s) => s.deviceKind === "client");
  const elifEdits = useMasterStore(elifCanEditSetlist);
  const selectPracticeSong = useMasterStore((s) => s.selectPracticeSong);
  const setlistOpen = useMasterStore((s) => s.setlistOpen);
  const zoom = useMasterStore((s) => s.stageZooms.drums);
  const autoScroll = useMasterStore(stageAutoScroll);
  const panicFollow = useMasterStore(panicBlocksFollow);
  const detached = useMasterStore(followsSharedPlayhead);
  const lookingAhead = useMasterStore(elifLookingAhead);
  const metroFollow = useMasterStore((s) => s.metronomePlaying);
  const stageRef = useRef<HTMLElement>(null);
  const listEntries = gig
    ? isSongLibraryGig(gig)
      ? gig.setlist
      : withKeyChangeElifs(gig.setlist, songs)
    : [];
  const entries = listEntries.filter(isSongEntry);
  const library = librarySongsNotOnSetlist(songs, listEntries);
  const practice = useMasterStore(clientPracticeMode);
  const bodySource = isSongLibraryGig(gig)
    ? selectedLibraryEntries(listEntries, selectedEntryId)
    : practice
      ? withSelectedLibrarySong(listEntries, songs, selectedEntryId)
      : listEntries;
  const playing =
    playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
  const following = playing || panicFollow || metroFollow;
  const playingEntryId = lookingAhead
    ? undefined
    : detached && (playing || panicFollow)
      ? (playback.clock?.setlistEntryId ?? undefined)
      : !detached && following
        ? (selectedEntryId ?? playback.clock?.setlistEntryId ?? undefined)
        : undefined;
  const playingSong = findSongByRef(
    songs,
    detached
      ? playback.clock?.songId
      : (entries.find((entry) => entry.entryId === selectedEntryId)?.songId ??
        playback.clock?.songId)
  );
  const liveTime = followTime;
  const upcoming = playingEntryId
    ? upcomingSongLeadIn(bodySource, songs, playingEntryId, playingSong, liveTime)
    : undefined;
  const visible = (practice || isSongLibraryGig(gig) ? bodySource.filter(isSongEntry) : entries).filter(
    (entry) => !entry.skipped
  );
  const bodyEntries = stageBodyEntries(bodySource);
  useEffect(() => {
    if (panicFollow) return;
    if (autoScroll && playingEntryId) return;
    if (!selectedEntryId) return;
    scrollStageToSongTitleWhenReady(stageRef.current, `[data-drum-song="${selectedEntryId}"]`);
  }, [selectedEntryId, autoScroll, playingEntryId, panicFollow]);

  useEffect(() => {
    if (!autoScroll || !playingEntryId) return;
    const stage = stageRef.current;
    if (!stage) return;
    const row = stage.querySelector(".drum-run.current");
    const current =
      row?.closest(".drum-pack") ?? stage.querySelector(".drum-pack.current");
    const leadIn = stageLeadInNode(stage, "data-drum-song", upcoming?.entryId);
    if (leadIn instanceof HTMLElement && !(current instanceof HTMLElement)) {
      scrollStageToNextSongTitleInUpperHalf(stage, leadIn);
      return;
    }
    const next = leadIn ?? stage.querySelector(".drum-pack.scroll-next");
    const fallbackId = playingEntryId ?? selectedEntryId;
    const fallback = fallbackId ? stage.querySelector(`[data-drum-song="${fallbackId}"]`) : null;
    const node = current ?? fallback;
    if (!(node instanceof HTMLElement)) return;
    scrollStageToFullSections(
      stage,
      node,
      next instanceof HTMLElement ? next : null,
      Boolean(leadIn)
    );
  }, [autoScroll, followTime, playingEntryId, selectedEntryId, zoom, upcoming?.entryId]);

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
            hideTalkAdd
            onSelect={selectSetlistEntry}
            onRemove={removeSong}
            onAdd={addSong}
            onSelectLibrary={practice ? selectPracticeSong : undefined}
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
                    live={playingEntryId === entry.entryId}
                    preview={selectedEntryId === entry.entryId}
                    time={liveTime}
                    leadIn={upcoming?.entryId === entry.entryId}
                    chainNext={Boolean(upcoming) && playingEntryId === entry.entryId}
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

function SongPatterns(props: {
  entryId: string;
  song: Song | undefined;
  live: boolean;
  preview?: boolean;
  time: number;
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
        <SongTitleMeta song={props.song} entryId={props.entryId} />
      </StageSongHead>
      <DrumChartBody
        song={props.song}
        live={props.live}
        preview={props.preview}
        time={props.time}
        leadIn={props.leadIn}
        chainNext={props.chainNext}
      />
    </article>
  );
}

export function DrumChartBody(props: {
  song: Song | undefined;
  live?: boolean;
  preview?: boolean;
  time?: number;
  leadIn?: boolean;
  chainNext?: boolean;
}) {
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const files = props.song
    ? [...(fileIndex[props.song.id] ?? []), ...(props.song.folder ? (fileIndex[props.song.folder] ?? []) : [])]
    : undefined;
  const live = Boolean(props.live);
  const time = props.time ?? 0;
  const form = songForm(props.song, { identity: "drums" });
  const chart = hasPatternData(props.song) ? writtenChart(props.song, form) : [];
  const map = props.song?.tempoMap ?? [];
  const runs = chart.flatMap((section) => section.runs);
  const pos = live ? formAt(form, time) : null;
  const currentRun = pos
    ? runs.find((run) => pos.originTime >= run.start && pos.originTime < run.end)
    : undefined;
  const actualMeasureEnd = pos ? measureEndAt(map, time) : 0;
  const afterOriginTime =
    pos && actualMeasureEnd >= pos.visit.end - TIME_EPS
      ? pos.block.originEnd
      : pos
        ? measureEndAt(map, pos.originTime)
        : 0;
  const nextPos = props.chainNext
    ? null
    : pos
      ? formNextAt(form, time, afterOriginTime)
      : null;
  const nextRow = nextPos ? chart.find((row) => row.block.id === nextPos.block.id) : undefined;
  const nextRun = nextRow?.runs.find(
    (run) => nextPos != null && nextPos.originTime >= run.start && nextPos.originTime < run.end
  );
  const visitIndex = pos ? form.visits.indexOf(pos.visit) : -1;
  const followingBlockId =
    visitIndex >= 0 ? form.visits[visitIndex + 1]?.blockId : undefined;
  const playTime = pos?.originTime ?? time;

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
        <div className="drum-section-list">
        {packSections(chart, props.song).map((pack, packIndex) => {
          const written = pack as (SectionChart & { block: FormBlock })[];
          const packCurrent = written.some((row) => pos?.block.id === row.block.id);
          const packLeadIn = Boolean(props.leadIn && packIndex === 0);
          const packNext =
            packLeadIn ||
            (!packCurrent && written.some((row) => nextPos?.block.id === row.block.id));
          const packScrollNext =
            packLeadIn ||
            (!packCurrent && written.some((row) => row.block.id === followingBlockId));
          const showGrids = written.some((row) => !isCountSection(props.song, row.section));
          const spanRow = written.some(
            (row) => !isCountSection(props.song, row.section) && row.runs.length >= 2
          );
          const pair = written.length === 2;
          return (
            <div
              key={written.map((row) => row.block.id).join("+")}
              data-drum-pack={written.map((row) => row.block.id).join("+")}
              data-lead-in={packLeadIn ? "" : undefined}
              className={`drum-pack wide${pair ? " pair" : ""}${packCurrent ? " current" : ""}${
                packNext ? " next" : ""
              }${packScrollNext ? " scroll-next" : ""}`}
            >
              <div className={`drum-pack-titles${spanRow ? " span" : ""}`}>
                {written.map((row) => (
                  <DrumSectionTitle
                    key={row.block.id}
                    row={row}
                    song={props.song}
                    block={row.block}
                    form={form}
                    visit={pos?.block.id === row.block.id ? pos.visit : null}
                    next={
                      packLeadIn ||
                      (pos?.block.id !== row.block.id && nextPos?.block.id === row.block.id)
                    }
                    live={live}
                    time={time}
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
                        {row.runs.map((run, runIndex) => {
                          const showRall = Boolean(
                            props.song &&
                              runShowsRallBar(
                                run,
                                row,
                                props.song,
                                runIndex === row.runs.length - 1,
                                isLastNamedChartRow(chart, row)
                              )
                          );
                          const cols = pair ? 1 : 2;
                          const rallAlign =
                            !showRall &&
                            row.runs.some(
                              (other, otherIndex) =>
                                props.song &&
                                Math.floor(otherIndex / cols) === Math.floor(runIndex / cols) &&
                                runShowsRallBar(
                                  other,
                                  row,
                                  props.song,
                                  otherIndex === row.runs.length - 1,
                                  isLastNamedChartRow(chart, row)
                                )
                            );
                          return (
                            <DrumRunView
                              key={`${run.name}-${run.start}`}
                              run={run}
                              fullWidth={false}
                              current={currentRun === run && pos?.block.id === row.block.id}
                              next={
                                currentRun !== run &&
                                nextRun === run &&
                                nextPos?.block.id === row.block.id
                              }
                              time={playTime}
                              map={map}
                              live={live && pos?.block.id === row.block.id}
                              showRall={showRall}
                              rallAlign={rallAlign}
                              sectionCurrent={sectionFollowsPlayhead(
                                props.song,
                                row.section,
                                time,
                                live || Boolean(props.preview)
                              )}
                            />
                          );
                        })}
                      </div>
                    )
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
        </div>
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
    ? sectionFill(props.live, props.time, props.visit.start, props.visit.end, props.song?.tempoMap)
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
  showRall: boolean;
  rallAlign?: boolean;
  sectionCurrent: boolean;
}) {
  const rallMeasure = firstTempoChangeMeasure(props.map);
  const tone = rallDrumTone(
    props.sectionCurrent ? timeToMusical(props.map, props.time).measure : undefined,
    rallMeasure,
    props.sectionCurrent
  );
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
  const barSteps = Math.max(STEPS_PER_BEAT, props.run.barSteps);
  const currentBeat = currentStep >= 0 ? currentStep - (currentStep % barSteps) : -1;
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
      {props.showRall ? (
        <div className={`drum-rall-bar ${tone}`} data-drum-rall={tone} aria-label="RALL">
          RALL
        </div>
      ) : props.rallAlign ? (
        <div className="drum-rall-bar drum-rall-gap" aria-hidden="true" />
      ) : null}
      <div className="drum-run-grid">
                      <div className="drum-measure-name">
          <span className="drum-pattern-name">{props.run.name}</span>
          <span className="drum-repeat">
            <span>x{props.run.repeats}</span>
            <span className="drum-count">{currentRepeat}</span>
          </span>
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
                      step % barSteps === 0 ? " measure" : step % STEPS_PER_BEAT === 0 ? " beat" : ""
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
