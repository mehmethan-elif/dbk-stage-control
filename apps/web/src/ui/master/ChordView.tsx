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
  type ChordEvent,
  type FormBlock,
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
import { ChordMeasureCue, ChordRepeatMark, FormSectionBar } from "./form-marks";
import { countLabel, isCountSection } from "./count-section";
import { sectionBarClass } from "./section-color";

const TIME_EPS = 0.02;
const MEASURES_PER_ROW = 4;
const CHORDS_PER_MEASURE = 4;
const STEPS_PER_MEASURE = 16;
const NOTE_LANES = [
  { name: "G", pc: 7 },
  { name: "F", pc: 5 },
  { name: "E", pc: 4 },
  { name: "D", pc: 2 },
  { name: "C", pc: 0 }
] as const;

function chunkMeasures(measures: MeasureCell[]): MeasureCell[][] {
  const rows: MeasureCell[][] = [];
  for (let i = 0; i < measures.length; i += MEASURES_PER_ROW) {
    rows.push(measures.slice(i, i + MEASURES_PER_ROW));
  }
  return rows;
}

interface ChordSlot {
  text: string;
  start: number;
  end: number;
}

interface ChordNoteHit {
  step: number;
  lane: string;
}

interface MeasureCell {
  measure: number;
  start: number;
  end: number;
  chords: ChordSlot[];
  notes: ChordNoteHit[];
}

interface SectionChart {
  section: Section;
  index: number;
  measures: MeasureCell[];
}

function measureSpan(map: TempoPoint[], measure: number): { start: number; end: number } {
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

function chordEnd(chords: ChordEvent[], index: number, fallback: number): number {
  const current = chords[index];
  if (current?.end != null) return current.end;
  return chords[index + 1]?.time ?? fallback;
}

function slotsInMeasure(chords: ChordEvent[], start: number, end: number, duration: number): ChordSlot[] {
  const starting = chords
    .map((chord, index) => ({ chord, index }))
    .filter(({ chord }) => chord.time >= start - TIME_EPS && chord.time < end - TIME_EPS)
    .slice(0, CHORDS_PER_MEASURE);
  if (starting.length > 0) {
    return starting.map(({ chord, index }, i) => {
      const nextStart = starting[i + 1]?.chord.time;
      const rawEnd = chordEnd(chords, index, duration);
      return {
        text: chord.text.trim() || "-",
        start: Math.max(chord.time, start),
        end: Math.min(nextStart ?? rawEnd, end)
      };
    });
  }
  for (let i = chords.length - 1; i >= 0; i--) {
    const chord = chords[i];
    if (!chord || chord.time > start + TIME_EPS) continue;
    if (chordEnd(chords, i, duration) > start + TIME_EPS) {
      return [{ text: chord.text.trim() || "-", start, end }];
    }
    break;
  }
  return [{ text: "-", start, end }];
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

function notesInMeasure(
  chords: ChordEvent[],
  measure: number,
  start: number,
  end: number,
  duration: number,
  map: TempoPoint[]
): ChordNoteHit[] {
  const origin = measureSpan(map, measure).start;
  const hits = new Map<number, string>();
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
      hits.set(stepOf(note, origin, STEPS_PER_MEASURE, map), lane);
    }
  }
  return [...hits.entries()].map(([step, lane]) => ({ step, lane }));
}

function hasChordData(song: Song | undefined): boolean {
  return (song?.chords?.length ?? 0) > 0;
}

function songHasChordNotes(song: Song | undefined): boolean {
  return (song?.chords ?? []).some((chord) => (chord.notes?.length ?? 0) > 0);
}

function sectionChart(song: Song | undefined): SectionChart[] {
  if (!song) return [];
  const sections = song.sections.length > 0 ? song.sections : [{ name: "", start: 0, end: song.duration }];
  const chords = [...(song.chords ?? [])].sort(
    (a, b) => a.time - b.time || (a.beat ?? 1) - (b.beat ?? 1)
  );
  return sections.map((section, index) => {
    const first = timeToMusical(song.tempoMap, section.start).measure;
    const last = timeToMusical(song.tempoMap, Math.max(section.start, section.end - TIME_EPS)).measure;
    const measures: MeasureCell[] = [];
    for (let measure = first; measure <= last; measure++) {
      const span = measureSpan(song.tempoMap, measure);
      const start = Math.max(span.start, section.start);
      const end = Math.min(span.end, section.end);
      if (end - start <= TIME_EPS) continue;
      measures.push({
        measure,
        start,
        end,
        chords: slotsInMeasure(chords, start, end, song.duration),
        notes: notesInMeasure(chords, measure, start, end, song.duration, song.tempoMap)
      });
    }
    return { section, index, measures };
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
        measures: row.measures.filter(
          (cell) => cell.start < block.originEnd - TIME_EPS && cell.end > block.originStart + TIME_EPS
        )
      }
    ];
  });
}

function cellAt(
  cells: (MeasureCell & { blockId: string })[],
  pos: { block: FormBlock; originTime: number } | null
): (MeasureCell & { blockId: string }) | undefined {
  if (!pos) return undefined;
  return (
    cells.find(
      (cell) =>
        cell.blockId === pos.block.id &&
        pos.originTime >= cell.start - TIME_EPS &&
        pos.originTime < cell.end - TIME_EPS
    ) ??
    cells.find(
      (cell) =>
        cell.blockId === pos.block.id &&
        pos.originTime >= cell.start - TIME_EPS &&
        pos.originTime <= cell.end + TIME_EPS
    )
  );
}

export function ChordView() {
  const songs = useMasterStore((s) => s.songs);
  const gig = useMasterStore(currentGig);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const selectSetlistEntry = useMasterStore((s) => s.selectSetlistEntry);
  const updateGig = useMasterStore((s) => s.updateGig);
  const previewTime = useMasterStore((s) => s.previewTime);
  const playback = useMasterStore((s) => s.playback);
  const readOnly = useMasterStore((s) => s.deviceKind === "client");
  const setlistOpen = useMasterStore((s) => s.setlistOpen);
  const zoom = useMasterStore((s) => s.stageZooms.chords);
  const autoScroll = useMasterStore((s) => s.autoScroll);
  const listEntries = gig ? withKeyChangeElifs(gig.setlist, songs) : [];
  const entries = listEntries.filter(isSongEntry);
  const addedIds = new Set(entries.map((entry) => entry.songId));
  const library = songs.filter((item) => !addedIds.has(item.id));
  const playing =
    playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
  const playingEntryId = playing ? playback.clock?.setlistEntryId : undefined;
  const liveTime = playing ? (playback.clock?.time ?? previewTime) : previewTime;
  const stageRef = useRef<HTMLElement>(null);
  const visible = entries.filter((entry) => !entry.skipped);
  const bodyEntries = stageBodyEntries(listEntries);

  useEffect(() => {
    if (autoScroll && playingEntryId) return;
    if (!selectedEntryId) return;
    scrollStageToSongTitle(stageRef.current, `[data-chord-song="${selectedEntryId}"]`);
  }, [selectedEntryId, autoScroll, playingEntryId]);

  useEffect(() => {
    if (!autoScroll || !playingEntryId) return;
    const stage = stageRef.current;
    if (!stage) return;
    const measure = stage.querySelector(".chord-measure.current");
    const current =
      (measure?.closest(".chord-section") as HTMLElement | null) ??
      (stage.querySelector(".chord-section.current") as HTMLElement | null);
    const next = stage.querySelector(".chord-section.scroll-next");
    const fallbackId = playingEntryId ?? selectedEntryId;
    const fallback = fallbackId ? stage.querySelector(`[data-chord-song="${fallbackId}"]`) : null;
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
            songAttr="data-chord-song"
          />
        ) : null}
        <section
          ref={stageRef}
          className="lyrics-stage"
          style={{ "--lyrics-zoom": String(zoom) } as CSSProperties}
        >
          {visible.length === 0 ? (
            <div className="lyrics-empty meta">No chords</div>
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
                      attr="data-chord-song"
                    />
                  );
                }
                if (!isSongEntry(entry)) return null;
                const item = songs.find((row) => row.id === entry.songId);
                return (
                  <SongChords
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

function SongChords(props: {
  entryId: string;
  song: Song | undefined;
  live: boolean;
  time: number;
}) {
  const form = songForm(props.song, {
    identity: "chords",
    foldInnerRepeats: true
  });
  const chart = hasChordData(props.song) ? writtenChart(props.song, form) : [];
  const showNotes = songHasChordNotes(props.song);
  const cells = chart.flatMap((section) =>
    section.measures.map((cell) => ({ ...cell, blockId: section.block.id }))
  );
  const pos = props.live ? formAt(form, props.time) : null;
  const currentCell = cellAt(cells, pos);
  const nextPos = currentCell ? formNextAt(form, props.time, currentCell.end) : null;
  const nextCell = cellAt(cells, nextPos);
  const visitIndex = pos ? form.visits.indexOf(pos.visit) : -1;
  const followingBlockId =
    visitIndex >= 0 ? form.visits[visitIndex + 1]?.blockId : undefined;
  const currentSlot = currentCell
    ? currentCell.chords.find(
        (slot) => pos != null && pos.originTime >= slot.start && pos.originTime < slot.end
      ) ?? currentCell.chords[currentCell.chords.length - 1]
    : undefined;

  return (
    <article className="lyrics-song" data-chord-song={props.entryId}>
      <StageSongHead songId={props.song?.id} page="chord">
        <span className="nota-song-name">{songDisplayName(props.song)}</span>
        <SongTitleMeta song={props.song} entryId={props.entryId} />
      </StageSongHead>
      {chart.length === 0 ? (
        <div className="lyrics-empty meta">No Chord Data</div>
      ) : (
        chart.map((row) => {
          const isCurrentSection = pos?.block.id === row.block.id;
          const isNextSection = !isCurrentSection && nextPos?.block.id === row.block.id;
          const isScrollNext =
            !isCurrentSection && row.block.id === followingBlockId;
          const isCount = isCountSection(props.song, row.section);
          const measureRows = isCount ? [] : chunkMeasures(row.measures);
          const sectionSpan = isCount
            ? MEASURES_PER_ROW
            : Math.max(1, ...measureRows.map((group) => group.length));
          return (
            <div
              key={row.block.id}
              data-chord-section={row.block.id}
              data-form-visit={isCurrentSection ? String(pos?.visit.start ?? "") : undefined}
              className={`chord-section${isCurrentSection ? " current" : ""}${
                isNextSection ? " next" : ""
              }${isScrollNext ? " scroll-next" : ""}${
                row.block.repeatStart ? " repeat-start" : ""
              }${
                row.block.repeatEnd ? " repeat-end" : ""
              }${isCount ? " count" : ""}`}
            >
            {row.section.name ? (
              <div className="chord-section-head">
                <span className="chord-repeat-col start" />
                <div
                  className={`lyrics-section chord-section-name${sectionBarClass(row.section.name)}`}
                  style={{ "--section-span": String(sectionSpan / MEASURES_PER_ROW) } as CSSProperties}
                >
                  <FormSectionBar
                    block={row.block}
                    form={form}
                    visit={isCurrentSection ? pos?.visit : null}
                    showRepeats={false}
                    toCodaInBar={false}
                    extra={isCount ? countLabel(props.song, row.section.start, row.section.end) : null}
                    extraClass={isCount ? "drum-count-label" : undefined}
                  />
                </div>
                <span className="chord-repeat-col end" />
              </div>
            ) : null}
            {measureRows.map((group, rowIndex, rows) => {
              const showStart = row.block.repeatStart && rowIndex === 0;
              const showEnd = row.block.repeatEnd && rowIndex === rows.length - 1;
              const firstRow = rowIndex === 0;
              const lastRow = rowIndex === rows.length - 1;
              return (
              <div
                key={`${group[0]?.measure}-${group[0]?.start}`}
                className="chord-row"
                data-chord-row={`${group[0]?.measure}-${group[0]?.start}`}
              >
                <span className="chord-repeat-col start">
                  {showStart ? <ChordRepeatMark side="start" /> : null}
                </span>
                <div
                  className={`chord-measures${showStart ? " repeat-start" : ""}${showEnd ? " repeat-end" : ""}`}
                  style={
                    {
                      "--repeat-after": String(group.length / MEASURES_PER_ROW)
                    } as CSSProperties
                  }
                >
                {group.map((cell, cellIndex) => {
                  const isCurrentMeasure =
                    currentCell?.blockId === row.block.id &&
                    currentCell.measure === cell.measure &&
                    currentCell.start === cell.start;
                  const isNext =
                    !isCurrentMeasure &&
                    nextCell?.blockId === row.block.id &&
                    nextCell.measure === cell.measure &&
                    nextCell.start === cell.start;
                  const lastMeasure = showEnd && cellIndex === group.length - 1;
                  const atToCoda =
                    row.block.toCoda &&
                    row.block.toCodaAt != null &&
                    row.block.toCodaAt > cell.start + TIME_EPS &&
                    row.block.toCodaAt <= cell.end + TIME_EPS;
                  return (
                    <div
                      key={`${cell.measure}-${cell.start}`}
                      data-form-visit={isCurrentMeasure ? String(pos?.visit.start ?? "") : undefined}
                      className={`chord-measure${isCurrentMeasure ? " current" : ""}${isNext ? " next" : ""}${
                        showNotes ? " has-notes" : ""
                      }${lastMeasure ? " repeat-end" : ""}`}
                    >
                      {showNotes ? (
                        <div className="chord-measure-notes" style={{ "--drum-steps": STEPS_PER_MEASURE } as CSSProperties}>
                          <div className="drum-lane chord-note-lane">
                            {Array.from({ length: STEPS_PER_MEASURE }, (_, step) => {
                              const hit = cell.notes.find((note) => note.step === step);
                              return (
                                <span
                                  key={step}
                                  data-note={hit?.lane}
                                  className={`drum-step${hit ? " hit" : ""}${
                                    step % STEPS_PER_MEASURE === 0
                                      ? " measure"
                                      : step % 4 === 0
                                        ? " beat"
                                        : ""
                                  }`}
                                />
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      <div className="chord-measure-body">
                        {cell.chords.map((slot, index) => {
                          const isCurrent =
                            isCurrentMeasure &&
                            currentSlot?.start === slot.start &&
                            currentSlot.text === slot.text;
                          return (
                            <span
                              key={`${slot.text}-${slot.start}-${index}`}
                              className={`chord-slot${isCurrent ? " current" : ""}`}
                            >
                              {slot.text}
                            </span>
                          );
                        })}
                        <ChordMeasureCue
                          block={row.block}
                          atSectionStart={firstRow && cellIndex === 0}
                          atSectionEnd={lastRow && cellIndex === group.length - 1}
                          atToCoda={atToCoda}
                        />
                      </div>
                    </div>
                  );
                })}
                {showEnd ? (
                  <span className="chord-repeat-after">
                    <ChordRepeatMark side="end" />
                  </span>
                ) : null}
                </div>
                <span className="chord-repeat-col end" />
              </div>
              );
            })}
          </div>
          );
        })
      )}
    </article>
  );
}
