import {
  Fragment,
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
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
  songDisplayName,
  timeToMusical,
  formAt,
  songForm,
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
import { StageSongHead } from "./StageSongHead";
import { SongTitleMeta } from "./stage-title-meta";
import { scrollStageToFollowedRows, stageLeadInNode } from "./stage-scroll";
import { usePinSelectedSong } from "./stage-pin";
import { upcomingSongLeadIn } from "./next-song-section";
import { ChordRepeatMark, FormSectionBar } from "./form-marks";
import { hidesCountSection, isCountSection } from "./count-section";
import { sectionBarClass } from "./section-color";
import { ChordDrumLanes, ChordNoteLane, displayChordText, drumNotesForMeasure } from "./chord-notes";
import {
  BARS_PER_LINE,
  chordChart,
  chordPlayhead,
  hasChordData,
  slotGridPlacement,
  type ChordBar,
  type ChordChart,
  type ChordHead,
  type ChordRow,
  type ChordSpan
} from "./chord-chart";
import { paintSongCueBars, SongCueBars } from "./song-cue-bar";

type ChordGridKind = "notes" | "drums";

const ChordGridContext = createContext<{
  grid: ChordGridKind;
  song: Song | undefined;
}>({ grid: "notes", song: undefined });

/** The count sits on the section bar, and one count held over two bars is still one count. */
function countLabel(row: ChordRow): string {
  const spoken: string[] = [];
  for (const span of row.spans) {
    for (const bar of span.lines.flat()) {
      for (const slot of bar.slots) {
        if (slot.text !== spoken[spoken.length - 1]) spoken.push(slot.text);
      }
    }
  }
  return spoken.join("  ");
}

/**
 * Which line the playhead sits on. `paintChordLive` marks it every frame, so reading the mark
 * back aims the scroll at the line the band sees lit rather than working the bars out again.
 */
function chordLineKey(stage: HTMLElement | null): string {
  return stage?.querySelector<HTMLElement>("[data-chord-line].current")?.dataset.chordLine ?? "";
}

/**
 * Played line (or the section when a count leaves no line), plus the whole next section —
 * including the next song's first section when that is already marked.
 */
export function chordFollowTargets(opts: {
  currentLine: Element | null;
  currentSection: Element | null;
  nextSection: Element | null;
  song: Element | null;
}): { current: Element | null; next: Element | null; pack: Element | null } {
  const pack = opts.currentLine?.closest(".chord-section") ?? opts.currentSection;
  const current = opts.currentLine ?? pack ?? opts.song;
  return { current, next: opts.nextSection, pack };
}

type ChordPaintMarks = {
  currentBar: string;
  nextBar: string;
  playingId: string;
  nextPlaying: string | null;
  followingId: string | undefined;
  rallTone: string;
  finalTone: string;
};

const lastChordPaint = new WeakMap<HTMLElement, ChordPaintMarks>();

function barKey(blockId: string, measure: number): string {
  return `${blockId}#${measure}`;
}

function clearChordLiveMarks(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>(
    "[data-chord-section].current, [data-chord-section].next, [data-chord-bar].current, [data-chord-bar].next, [data-chord-line].current, [data-chord-line].next, .chord-section.current, .chord-section.next, .chord-section.scroll-next, .chord-slot.current"
  )) {
    el.classList.remove("current", "next", "scroll-next");
    if (el.hasAttribute("data-chord-section")) el.style.setProperty("--playhead", "0");
  }
  paintSongCueBars(root, undefined, 0, false, "chord");
}

function paintChordBar(
  el: HTMLElement,
  isCurrent: boolean,
  isNext: boolean,
  phase: number
): void {
  el.classList.toggle("current", isCurrent);
  el.classList.toggle("next", !isCurrent && isNext);
  const slots = el.querySelectorAll<HTMLElement>(".chord-slot");
  if (slots.length > 1) {
    slots.forEach((slot) => {
      const from = Number(slot.dataset.slotFrom);
      const to = Number(slot.dataset.slotTo);
      slot.classList.toggle("current", isCurrent && phase >= from && phase < to);
    });
  }
}

function paintChordLineAndSection(bar: HTMLElement | null): void {
  const line = bar?.closest<HTMLElement>("[data-chord-line]");
  if (line) {
    line.classList.toggle("current", Boolean(line.querySelector(".chord-measure.current")));
    line.classList.toggle("next", Boolean(line.querySelector(".chord-measure.next")));
  }
  const section = bar?.closest<HTMLElement>(".chord-section");
  if (!section) return;
  const isCurrent = Boolean(
    section.querySelector("[data-chord-section].current, .chord-measure.current")
  );
  const isNext = Boolean(section.querySelector("[data-chord-section].next, .chord-measure.next"));
  section.classList.toggle("current", isCurrent);
  section.classList.toggle("next", !isCurrent && isNext);
}

function paintChordLive(
  root: HTMLElement,
  chart: ChordChart,
  form: SongForm,
  time: number,
  map: TempoPoint[],
  live: boolean,
  chainNext: boolean,
  song?: Song,
  preview = false
): void {
  if (!live) {
    clearChordLiveMarks(root);
    if (preview) paintSongCueBars(root, song, time, true, "chord");
    lastChordPaint.delete(root);
    return;
  }
  const pos = formAt(form, time);
  const head = chordPlayhead(chart, form, time, map, chainNext);
  const visit = pos?.visit;
  const visitIndex = visit ? form.visits.indexOf(visit) : -1;
  const followingId = visitIndex >= 0 ? form.visits[visitIndex + 1]?.blockId : undefined;
  const followingNamed = followingId ? (chart.named.get(followingId) ?? followingId) : undefined;
  const playingId = head?.playing ?? pos?.block.id ?? "";
  const nextPlaying = head?.nextPlaying ?? followingNamed ?? null;
  const currentBar = head ? barKey(head.blockId, head.measure) : "";
  const nextBar = head?.next ? barKey(head.next.blockId, head.next.measure) : "";
  paintSongCueBars(root, song, time, true, "chord");
  const rallTone = root.querySelector<HTMLElement>("[data-chord-rall]")?.dataset.chordRall ?? "idle";
  const finalTone = root.querySelector<HTMLElement>("[data-chord-final]")?.dataset.chordFinal ?? "idle";
  const prev = lastChordPaint.get(root);
  const barsChanged =
    !prev || prev.currentBar !== currentBar || prev.nextBar !== nextBar;
  const namesChanged =
    !prev ||
    prev.playingId !== playingId ||
    prev.nextPlaying !== nextPlaying ||
    prev.followingId !== followingId;

  // Names are lit one at a time even where several share a set of bars, so the band sees which
  // pass they are on: Biz lights SAN 1 the first time through those bars and SAN 2 the second.
  if (namesChanged || playingId) {
    for (const row of chart.rows) {
      for (const item of row.heads) {
        const here = playingId === item.block.id ? visit : undefined;
        if (
          !namesChanged &&
          !here &&
          prev?.playingId !== item.block.id &&
          prev?.nextPlaying !== item.block.id
        ) {
          continue;
        }
        const fill = here ? measureRangeFill(map, here.start, here.end, time) : 0;
        for (const el of root.querySelectorAll<HTMLElement>(
          `[data-chord-section="${item.block.id}"]`
        )) {
          const leadIn = Boolean(el.closest("[data-lead-in]"));
          el.classList.toggle("current", Boolean(here));
          el.classList.toggle("next", leadIn || (!here && nextPlaying === item.block.id));
          el.style.setProperty("--playhead", String(fill));
        }
      }
    }
  }

  if (barsChanged) {
    const touched = new Set<HTMLElement>();
    const mark = (key: string, isCurrent: boolean, isNext: boolean, phase: number) => {
      if (!key) return;
      const el = root.querySelector<HTMLElement>(`[data-chord-bar="${key}"]`);
      if (!el) return;
      paintChordBar(el, isCurrent, isNext, phase);
      touched.add(el);
    };
    if (prev?.currentBar) mark(prev.currentBar, false, prev.currentBar === nextBar, 0);
    if (prev?.nextBar && prev.nextBar !== prev.currentBar) {
      mark(prev.nextBar, prev.nextBar === currentBar, false, head?.phase ?? 0);
    }
    mark(currentBar, true, false, head?.phase ?? 0);
    if (nextBar && nextBar !== currentBar) mark(nextBar, false, true, 0);
    for (const el of touched) paintChordLineAndSection(el);
  } else if (currentBar && head && (head.phase ?? 0) >= 0) {
    const el = root.querySelector<HTMLElement>(`[data-chord-bar="${currentBar}"]`);
    if (el) paintChordBar(el, true, false, head.phase);
  }

  if (namesChanged) {
    for (const el of root.querySelectorAll<HTMLElement>(".chord-section")) {
      const isCurrent = Boolean(
        el.querySelector("[data-chord-section].current, .chord-measure.current")
      );
      const isNext = Boolean(el.querySelector("[data-chord-section].next, .chord-measure.next"));
      const isFollow = Boolean(
        followingId && el.querySelector(`[data-chord-section="${followingId}"]`)
      );
      el.classList.toggle("current", isCurrent);
      el.classList.toggle("next", !isCurrent && isNext);
      el.classList.toggle(
        "scroll-next",
        el.hasAttribute("data-lead-in") || (!isCurrent && isFollow)
      );
    }
  }

  lastChordPaint.set(root, {
    currentBar,
    nextBar,
    playingId,
    nextPlaying,
    followingId,
    rallTone,
    finalTone
  });
}

export function ChordView() {
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
  const masterPage = useMasterStore((s) => s.masterPage);
  const zoom = useMasterStore((s) => s.stageZooms[masterPage === "bass" ? "bass" : "chords"]);
  const grid: ChordGridKind = masterPage === "bass" ? "drums" : "notes";
  const autoScroll = useMasterStore(stageAutoScroll);
  const reading = useMasterStore(readingOffShow);
  const panicFollow = useMasterStore(panicBlocksFollow) && !reading;
  const detached = useMasterStore(followsSharedPlayhead);
  const showEntry = useMasterStore(pageEntrySongId);
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
  const playingEntryId =
    detached && (playing || panicFollow)
      ? (playback.clock?.setlistEntryId ?? undefined)
      : !detached && following
        ? (showEntry ?? playback.clock?.setlistEntryId ?? undefined)
        : undefined;
  const visible = (
    readOnly || isSongLibraryGig(gig) ? bodySource.filter(isSongEntry) : entries
  ).filter((entry) => !entry.skipped);
  const bodyEntries = stageBodyEntries(bodySource);
  const onLeadIn = useCallback((entryId: string | undefined, chain: boolean) => {
    setLeadInId((current) => (current === entryId ? current : entryId));
    setChainNext((current) => (current === chain ? current : chain));
  }, []);

  usePinSelectedSong(stageRef, "data-chord-song", {
    page: masterPage,
    scrollEntry,
    skip: panicFollow || Boolean(autoScroll && playingEntryId)
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
                if (isTalkEntry(entry)) {
                  return (
                    <StageFinishRow
                      key={entry.entryId}
                      label={talkDisplayLabel(entry)}
                      entryId={entry.entryId}
                      locked={isLockedElif(entry)}
                      notes={entry.notes}
                      attr="data-chord-song"
                    />
                  );
                }
                if (!isSongEntry(entry)) return null;
                const item = findSongByRef(songs, entry.songId);
                return (
                  <SongChords
                    key={entry.entryId}
                    entryId={entry.entryId}
                    song={item}
                    live={playingEntryId === entry.entryId}
                    preview={showEntry === entry.entryId}
                    leadIn={leadInId === entry.entryId}
                    chainNext={chainNext && playingEntryId === entry.entryId}
                    grid={grid}
                  />
                );
              })}
              {entries.length > 0 ? <StageFinishRow label={CONCERT_FINAL_LABEL} /> : null}
              <ChordFollow
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

function ChordFollow(props: {
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
    props.detached
      ? playback.clock?.songId
      : (entries.find((entry) => entry.entryId === props.selectedEntryId)?.songId ??
          playback.clock?.songId)
  );
  const form = useMemo(() => songForm(playingSong, { identity: "chords" }), [playingSong]);
  const propsRef = useRef(props);
  const songRef = useRef(playingSong);
  const formRef = useRef(form);
  propsRef.current = props;
  songRef.current = playingSong;
  formRef.current = form;

  useEffect(() => {
    if (!props.playingEntryId) {
      setScrollKey("");
      setLeadInId(undefined);
      props.onLeadIn(undefined, false);
      return;
    }
    let handle = 0;
    let lastKey = "";
    let lastLead: string | undefined;
    const loop = () => {
      const current = propsRef.current;
      const song = songRef.current;
      const raw = followClockPlaying()
        ? followClockTime()
        : stagePlayheadTime(useMasterStore.getState());
      const time = song && song.duration > 0 ? Math.min(song.duration, raw) : raw;
      const block =
        current.playingEntryId && song ? (formAt(formRef.current, time)?.block.id ?? "") : "";
      // Re-aim every bar, like the score page: a line holds for four bars, and until the key
      // changes a hand scroll away from the playhead is never corrected.
      const line = block ? chordLineKey(current.stageRef.current) || block : "";
      const key = line && song ? `${line}#${timeToMusical(song.tempoMap, time).measure}` : line;
      const upcoming = current.playingEntryId
        ? upcomingSongLeadIn(current.bodySource, current.songs, current.playingEntryId, song, time)
        : undefined;
      if (key !== lastKey) {
        lastKey = key;
        setScrollKey(key);
      }
      if (upcoming?.entryId !== lastLead) {
        lastLead = upcoming?.entryId;
        setLeadInId(upcoming?.entryId);
        current.onLeadIn(upcoming?.entryId, Boolean(upcoming));
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
    const line = stage.querySelector("[data-chord-line].current");
    const section = stage.querySelector(".chord-section.current");
    const fallbackId = props.playingEntryId ?? props.selectedEntryId;
    const fallback = fallbackId ? stage.querySelector(`[data-chord-song="${fallbackId}"]`) : null;
    const { current, next } = chordFollowTargets({
      currentLine: line,
      currentSection: section,
      nextSection: stage.querySelector(".chord-section.scroll-next"),
      song: fallback
    });
    const leadIn = stageLeadInNode(stage, "data-chord-song", leadInId);
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
    leadInId
  ]);

  return null;
}

const SongChords = memo(function SongChords(props: {
  entryId: string;
  song: Song | undefined;
  live: boolean;
  preview?: boolean;
  leadIn?: boolean;
  chainNext?: boolean;
  grid: ChordGridKind;
}) {
  return (
    <article
      className="lyrics-song"
      data-chord-song={props.entryId}
      data-lead-in={props.leadIn && !hasChordData(props.song) ? "" : undefined}
    >
      <StageSongHead songId={props.song?.id} entryId={props.entryId} page="chord">
        <span className="nota-song-name">{songDisplayName(props.song)}</span>
        <SongTitleMeta song={props.song} entryId={props.entryId} page="chord" />
      </StageSongHead>
      <ChordChartBody
        song={props.song}
        live={props.live}
        preview={props.preview}
        leadIn={props.leadIn}
        chainNext={props.chainNext}
        grid={props.grid}
      />
    </article>
  );
});

export const ChordChartBody = memo(function ChordChartBody(props: {
  song: Song | undefined;
  live?: boolean;
  preview?: boolean;
  leadIn?: boolean;
  chainNext?: boolean;
  grid?: ChordGridKind;
}) {
  const live = Boolean(props.live);
  const form = useMemo(() => songForm(props.song, { identity: "chords" }), [props.song]);
  const chart = useMemo(
    () => chordChart(hasChordData(props.song) ? props.song : undefined, form),
    [props.song, form]
  );
  const map = props.song?.tempoMap ?? [];
  const rootRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef(chart);
  const formRef = useRef(form);
  const mapRef = useRef(map);
  const songRef = useRef(props.song);
  chartRef.current = chart;
  formRef.current = form;
  mapRef.current = map;
  songRef.current = props.song;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const paint = (time: number) =>
      paintChordLive(
        root,
        chartRef.current,
        formRef.current,
        time,
        mapRef.current,
        live,
        Boolean(props.chainNext),
        songRef.current,
        Boolean(props.preview)
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
    paint(followClockPlaying() ? followClockTime() : stagePlayheadTime(useMasterStore.getState()));
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, [live, props.preview, props.chainNext, props.song?.id]);

  if (chart.rows.length === 0) {
    return <div className="lyrics-empty meta">No Chords</div>;
  }
  return (
    <ChordGridContext.Provider value={{ grid: props.grid ?? "notes", song: props.song }}>
      <div
        ref={rootRef}
        className="drum-section-list chord-section-list"
        data-chord-grid={props.grid ?? "notes"}
      >
        {chart.rows.filter((row) => !hidesCountSection(props.song, row.heads[0]?.section)).map((row, rowIndex) => (
          <div
            key={row.heads[0]?.block.id}
            className="chord-section"
            data-lead-in={props.leadIn && rowIndex === 0 ? "" : undefined}
          >
            {row.heads.map((item) => (
              <ChordSectionTitle key={item.block.id} row={row} head={item} song={props.song} />
            ))}
            {isCountSection(props.song, row.heads[0]?.section)
              ? null
              : row.spans.map((span) => (
                  <ChordSpanView
                    key={span.id}
                    span={span}
                    blockId={row.heads[0]?.block.id ?? ""}
                  />
                ))}
          </div>
        ))}
        <SongCueBars
          song={props.song}
          time={0}
          active={false}
          attrPrefix="chord"
          wrap={(bar) => (
            <div className="chord-section-head">
              <div className="chord-repeat-col" />
              {bar}
              <div className="chord-repeat-col" />
            </div>
          )}
        />
      </div>
    </ChordGridContext.Provider>
  );
});

function ChordSectionTitle(props: { row: ChordRow; head: ChordHead; song: Song | undefined }) {
  const isCount = isCountSection(props.song, props.head.section);
  const block = props.head.block;
  if (!props.head.section.name) return null;
  return (
    <div className="chord-section-head">
      <div className="chord-repeat-col" />
      <div
        data-chord-section={block.id}
        className={`lyrics-section drum-section-name chord-section-name playhead-green${sectionBarClass(
          props.head.section.name
        )}`}
        style={
          {
            "--section-span": String(isCount ? 1 : props.row.width)
          } as CSSProperties
        }
      >
        <span className="lyrics-playhead" aria-hidden="true" />
        <div className="lyrics-cue-body drum-section-bar">
          <FormSectionBar
            block={block}
            showRepeats={false}
            extra={isCount ? countLabel(props.row) : null}
            extraClass={isCount ? "drum-count-label" : undefined}
          />
        </div>
      </div>
      <div className="chord-repeat-col" />
    </div>
  );
}

/**
 * The bars of one span, four to a line, with the repeat signs in the margins either side so they
 * never crowd a bar. A repeat that ends on a part line is closed straight after its last bar,
 * out in the empty space, rather than away at the edge of the page.
 *
 * A span is played more than once either on its own account, as bars that come round again, or
 * because the whole row is read again under another name stacked on it.
 */
function ChordSpanView(props: {
  span: ChordSpan;
  blockId: string;
}) {
  const span = props.span;
  const opens = span.opens || span.plays > 1;
  const plays = span.closes ?? (span.plays > 1 ? span.plays : 0);
  const last = span.lines.length - 1;
  return (
    <>
      {span.lines.map((bars, lineIndex) => {
        const closes = plays > 1 && lineIndex === last;
        const part = bars.length < BARS_PER_LINE;
        return (
          <Fragment key={`${span.id}#${lineIndex}`}>
            <div className={`chord-row${closes && plays >= 3 ? " has-plays" : ""}`}>
              <div className="chord-repeat-col">
                {opens && lineIndex === 0 ? <ChordRepeatMark side="start" /> : null}
              </div>
              <div
                data-chord-line={`${span.id}#${lineIndex}`}
                className={`chord-measures${opens && lineIndex === 0 ? " repeat-start" : ""}`}
              >
                {bars.map((bar, barIndex) => (
                  <ChordBarView
                    key={bar.measure}
                    bar={bar}
                    blockId={props.blockId}
                    closesRepeat={closes && barIndex === bars.length - 1}
                    ending={
                      span.ending && span.ending.at === lineIndex * BARS_PER_LINE + barIndex
                        ? span.ending.pass
                        : undefined
                    }
                  />
                ))}
                {closes && part ? (
                  <span
                    className="chord-repeat-after"
                    style={
                      {
                        "--repeat-after": bars.length / BARS_PER_LINE
                      } as CSSProperties
                    }
                  >
                    <ChordRepeatClose plays={plays} />
                  </span>
                ) : null}
              </div>
              <div className="chord-repeat-col">
                {closes && !part ? <ChordRepeatClose plays={plays} /> : null}
              </div>
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

/** Closing bar, with the play count under it when the sign alone is not enough. */
function ChordRepeatClose(props: { plays: number }) {
  return (
    <span className="chord-repeat-end">
      <ChordRepeatMark side="end" />
      <ChordPlays plays={props.plays} />
    </span>
  );
}

/** Twice needs no saying: the sign says that. More than twice has to be counted. */
function ChordPlays(props: { plays: number }) {
  if (props.plays < 3) return null;
  return <span className="chord-repeat-plays">{`\u00d7${props.plays}`}</span>;
}

function ChordBarView(props: {
  bar: ChordBar;
  blockId: string;
  closesRepeat?: boolean;
  /** 1 or 2, on the bar where a pass that ends differently starts. */
  ending?: number;
}) {
  const { grid, song } = useContext(ChordGridContext);
  const notes =
    grid === "drums" && song ? drumNotesForMeasure(song, props.bar.measure) : props.bar.notes;
  const steps = Math.max(1, Math.round(props.bar.steps));
  return (
    <div
      className={`chord-measure${props.closesRepeat ? " repeat-end" : ""}`}
      data-chord-bar={`${props.blockId}#${props.bar.measure}`}
      data-block-id={props.blockId}
      data-measure={String(props.bar.measure)}
      style={{ "--drum-steps": steps, "--drum-bar-steps": steps } as CSSProperties}
    >
      {props.bar.slots
        .filter((slot) => slot.step > 0)
        .map((slot) => (
          <span
            key={`rule-${slot.step}-${slot.text}`}
            className="chord-slot-rule"
            style={{ "--slot-step": slot.step } as CSSProperties}
          />
        ))}
      {grid === "drums" ? (
        <ChordDrumLanes notes={notes} steps={steps} />
      ) : (
        <ChordNoteLane notes={notes} steps={steps} />
      )}
      <div className="chord-measure-body">
        {props.ending ? <span className="chord-ending">{`${props.ending}.`}</span> : null}
        {props.bar.slots.length === 0 ? (
          <span className="chord-slot" style={{ "--slot-col": 1, "--slot-span-steps": steps } as CSSProperties} />
        ) : (
          props.bar.slots.map((slot) => {
            const place = slotGridPlacement(slot, steps);
            return (
              <span
                key={`${slot.step}-${slot.text}`}
                className="chord-slot"
                data-slot-from={String(slot.from)}
                data-slot-to={String(slot.to)}
                style={
                  {
                    "--slot-col": place.column,
                    "--slot-span-steps": place.span
                  } as CSSProperties
                }
              >
                {displayChordText(slot.text)}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

export { paintChordLive };
