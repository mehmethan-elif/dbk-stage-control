import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  createId,
  currentLyricIndex,
  measureRangeFill,
  hasPlaybackAudio,
  isRealMetronomeTrack,
  isLockedElif,
  isTalkEntry,
  talkDisplayLabel,
  insertAfterSelected,
  trimElifAfterLastSong,
  isSongEntry,
  effectivePlayMode,
  parseSongInfo,
  withKeyChangeElifs,
  PlaybackState,
  PlayMode,
  songDisplayName,
  type Song,
  type TempoPoint,
  type SongSetlistEntry
} from "@dbk/core";
import { followClockPlaying, followClockTime, useFollowPlayheadTime } from "../../store/follow-clock";
import {
  clientPracticeMode,
  currentGig,
  elifCanEditSetlist,
  elifLookingAhead,
  panicBlocksFollow,
  selectAddedSetlistEntry,
  stageAutoScroll,
  followsSharedPlayhead,
  stagePlayheadTime,
  useMasterStore
} from "../../store/master-store";
import { findSongByRef, isSongLibraryGig, librarySongsNotOnSetlist, selectedLibraryEntries, withSelectedLibrarySong } from "../../store/song-library";
import { StageSetlist } from "./StageSetlist";
import { CONCERT_FINAL_LABEL, StageFinishRow, stageBodyEntries } from "./setlist-marker";
import { MetroDraftNotes } from "./metro-draft-notes";
import { StageSongHead } from "./StageSongHead";
import { SongTitleMeta } from "./stage-title-meta";
import {
  scrollStageToFullSectionsCentered,
  scrollStageToNextSongTitleInUpperHalf,
  scrollStageToSongTitleWhenReady,
  stageLeadInNode
} from "./stage-scroll";
import { upcomingSongLeadIn } from "./next-song-section";
import { lyricLineShowsRall } from "./rall-alert";
import { sectionBarClass } from "./section-color";
import { lyricBlocks, stageRows } from "./lyric-rows";

function cueFill(
  current: number,
  index: number,
  start: number,
  end: number,
  time: number,
  map?: TempoPoint[]
): number {
  if (current < 0) return 0;
  if (index < current) return 1;
  if (index > current) return 0;
  return measureRangeFill(map, start, end, time);
}

function songShowsSections(
  _entry: SongSetlistEntry | undefined,
  song: Song | undefined,
  files?: string[],
  client = false,
  setlistMode?: string
): boolean {
  if ((song?.sections.length ?? 0) === 0) return false;
  if (client) return true;
  const mode = effectivePlayMode(song, files, setlistMode);
  return (
    mode === PlayMode.Playback && hasPlaybackAudio(song, files)
  );
}

function sectionPlayheadClass(name: string): string {
  const key = name.trim().toUpperCase();
  return key === "BOS" || key === "FIN" ? " playhead-red" : " playhead-green";
}

export function LyricsView() {
  const songs = useMasterStore((s) => s.songs);
  const fileIndex = useMasterStore((s) => s.fileIndex);
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
  const zoom = useMasterStore((s) => s.stageZooms.lyrics);
  const autoScroll = useMasterStore(stageAutoScroll);
  const panicFollow = useMasterStore(panicBlocksFollow);
  const detached = useMasterStore(followsSharedPlayhead);
  const lookingAhead = useMasterStore(elifLookingAhead);
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
  const selected = selectedEntryId
    ? entries.find((entry) => entry.entryId === selectedEntryId)
    : undefined;
  const playing =
    playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
  const playingEntryId = lookingAhead
    ? undefined
    : detached && (playing || panicFollow)
      ? (playback.clock?.setlistEntryId ?? undefined)
      : !detached && (playing || panicFollow)
        ? (selectedEntryId ?? playback.clock?.setlistEntryId ?? undefined)
        : undefined;
  const liveSong = findSongByRef(
    songs,
    detached ? (playback.clock?.songId ?? selected?.songId) : selected?.songId
  );
  const liveTime =
    liveSong && liveSong.duration > 0 ? Math.min(liveSong.duration, followTime) : followTime;
  const playingSong = findSongByRef(
    songs,
    detached ? (playback.clock?.songId ?? selected?.songId) : selected?.songId
  );
  const playingEntry = playingEntryId
    ? entries.find((entry) => entry.entryId === playingEntryId)
    : undefined;
  const currentIdx = playingEntryId
    ? currentLyricIndex(
        stageRows(
          playingSong,
          songShowsSections(
            playingEntry,
            playingSong,
            playingSong ? fileIndex[playingSong.id] : undefined,
            readOnly,
            gig?.performanceMode
          )
        ),
        liveTime
      )
    : -1;
  const upcoming = playingEntryId
    ? upcomingSongLeadIn(bodySource, songs, playingEntryId, playingSong, liveTime)
    : undefined;
  useEffect(() => {
    if (panicFollow) return;
    if (autoScroll && currentIdx >= 0) return;
    if (!selectedEntryId) return;
    scrollStageToSongTitleWhenReady(stageRef.current, `[data-lyric-song="${selectedEntryId}"]`);
  }, [selectedEntryId, autoScroll, currentIdx, panicFollow]);

  useEffect(() => {
    if (!autoScroll || currentIdx < 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    const current = stage.querySelector(".lyrics-cue.current");
    const leadIn = stageLeadInNode(stage, "data-lyric-song", upcoming?.entryId);
    if (leadIn instanceof HTMLElement && !(current instanceof HTMLElement)) {
      scrollStageToNextSongTitleInUpperHalf(stage, leadIn);
      return;
    }
    const next = leadIn ?? stage.querySelector(".lyrics-cue.next");
    const fallbackId = playingEntryId ?? selectedEntryId;
    const fallback = fallbackId ? stage.querySelector(`[data-lyric-song="${fallbackId}"]`) : null;
    const node = current ?? fallback;
    if (!(node instanceof HTMLElement)) return;
    scrollStageToFullSectionsCentered(
      stage,
      node,
      next instanceof HTMLElement ? next : null,
      Boolean(leadIn)
    );
  }, [autoScroll, currentIdx, playingEntryId, selectedEntryId, zoom, upcoming?.entryId]);

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

  const visible = (practice || isSongLibraryGig(gig) ? bodySource.filter(isSongEntry) : entries).filter(
    (entry) => !entry.skipped
  );
  const bodyEntries = stageBodyEntries(bodySource);
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
            onSelectLibrary={practice ? selectPracticeSong : undefined}
            stageRef={stageRef}
            songAttr="data-lyric-song"
          />
        ) : null}
        <section
          ref={stageRef}
          className="lyrics-stage"
          style={{ "--lyrics-zoom": String(zoom) } as CSSProperties}
        >
          {visible.length === 0 ? (
            <div className="lyrics-empty meta">No lyrics</div>
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
                      showNotes
                      notes={entry.notes}
                      attr="data-lyric-song"
                    />
                  );
                }
                if (!isSongEntry(entry)) return null;
                const item = findSongByRef(songs, entry.songId);
                const live = playingEntryId === entry.entryId;
                return (
                  <SongLyrics
                    key={entry.entryId}
                    entryId={entry.entryId}
                    song={item}
                    files={
                      item
                        ? [...(fileIndex[item.id] ?? []), ...(item.folder ? (fileIndex[item.folder] ?? []) : [])]
                        : undefined
                    }
                    live={live}
                    followRall={live || (!playing && selectedEntryId === entry.entryId)}
                    time={liveTime}
                    smooth={readOnly && playing && live}
                    leadIn={upcoming?.entryId === entry.entryId}
                    chainNext={Boolean(upcoming) && live}
                    showSections={songShowsSections(
                      entry,
                      item,
                      item ? fileIndex[item.id] : undefined,
                      readOnly,
                      gig?.performanceMode
                    )}
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

function SongLyrics(props: {
  entryId: string;
  song: Song | undefined;
  files?: string[];
  live: boolean;
  followRall?: boolean;
  time: number;
  showSections: boolean;
  smooth?: boolean;
  leadIn?: boolean;
  chainNext?: boolean;
}) {
  const rows = stageRows(props.song, props.showSections);
  const current = props.live ? currentLyricIndex(rows, props.time) : -1;
  const rootRef = useRef<HTMLElement>(null);
  const rowsRef = useRef(rows);
  const origin = useRef({ time: props.time, wall: performance.now() });
  rowsRef.current = rows;
  useEffect(() => {
    origin.current = { time: props.time, wall: performance.now() };
  }, [props.time]);
  useEffect(() => {
    if (!props.live || !props.smooth) return;
    let handle = 0;
    const loop = () => {
      const t = followClockPlaying()
        ? followClockTime()
        : origin.current.time + Math.max(0, performance.now() - origin.current.wall) / 1000;
      const list = rowsRef.current;
      const at = currentLyricIndex(list, t);
      const root = rootRef.current;
      if (root) {
        for (const el of root.querySelectorAll<HTMLElement>("[data-cue-index]")) {
          const index = Number(el.dataset.cueIndex);
          const row = list[index];
          if (!row) continue;
          el.style.setProperty(
            "--playhead",
            String(cueFill(at, index, row.time, row.end, t, props.song?.tempoMap))
          );
          applyCueClasses(el, at, index, Boolean(props.chainNext));
        }
      }
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, [props.live, props.smooth, props.chainNext, props.song?.id]);
  return (
    <article
      ref={rootRef}
      className="lyrics-song"
      data-lyric-song={props.entryId}
      data-lead-in={props.leadIn && rows.length === 0 ? "" : undefined}
    >
      <StageSongHead songId={props.song?.id} entryId={props.entryId} page="lyrics">
        <span className="nota-song-name">{songDisplayName(props.song)}</span>
        <SongTitleMeta song={props.song} entryId={props.entryId} />
      </StageSongHead>
      {rows.length === 0 ? (
        isRealMetronomeTrack(props.song, props.files) ? (
          <MetroDraftNotes
            song={props.song}
            files={props.files}
            page="lyrics"
            label="Paste lyrics"
            emptyLabel="No lyrics"
          />
        ) : (
          <div className="lyrics-empty meta">No lyrics</div>
        )
      ) : (
        rows.map((row, index) => {
          const lead = Boolean(props.leadIn && index === 0);
          const state = lead ? " next future" : cueClass(current, index, props.chainNext);
          const rall =
            Boolean(props.followRall) &&
            row.kind === "lyric" &&
            lyricLineShowsRall(props.song, row.line, props.time);
          return row.kind === "section" ? (
            <CueRow
              key={`section-${row.time}-${row.name}-${index}`}
              index={index}
              className={`lyrics-section lyrics-section-name lyrics-cue${sectionBarClass(row.name)}${sectionPlayheadClass(row.name)}${state}`}
              fill={cueFill(current, index, row.time, row.end, props.time, props.song?.tempoMap)}
              leadIn={lead}
            >
              {row.name}
            </CueRow>
          ) : (
            <CueRow
              key={`${row.line.time}-${row.lyricIndex}`}
              index={index}
              className={`lyrics-line lyrics-cue${state}${rall ? " is-rall" : ""}`}
              fill={cueFill(current, index, row.time, row.end, props.time, props.song?.tempoMap)}
              leadIn={lead}
            >
              {rall ? (
                <>
                  <div className="lyrics-rall-text">
                    {lyricBlocks(row.line).map((block, blockIndex) => (
                      <div key={`${row.line.time}-${row.lyricIndex}-${blockIndex}`}>{block}</div>
                    ))}
                  </div>
                  <span className="lyrics-rall-mark">RALL</span>
                </>
              ) : (
                lyricBlocks(row.line).map((block, blockIndex) => (
                  <div key={`${row.line.time}-${row.lyricIndex}-${blockIndex}`}>{block}</div>
                ))
              )}
            </CueRow>
          );
        })
      )}
    </article>
  );
}

function cueClass(current: number, index: number, chainNext = false): string {
  if (current < 0) return "";
  if (index === current) return " current";
  if (index === current + 1 && !chainNext) return " next future";
  return index < current ? " past" : " future";
}

function applyCueClasses(
  el: HTMLElement,
  current: number,
  index: number,
  chainNext: boolean
): void {
  const isCurrent = current >= 0 && index === current;
  const isNext = current >= 0 && index === current + 1 && !chainNext;
  const isPast = current >= 0 && index < current;
  const isFuture = current >= 0 && index > current && !isNext;
  el.classList.toggle("current", isCurrent);
  el.classList.toggle("next", isNext);
  el.classList.toggle("future", isNext || isFuture);
  el.classList.toggle("past", isPast);
}

function CueRow(props: {
  className: string;
  fill: number;
  index: number;
  leadIn?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={props.className}
      data-cue-index={props.index}
      data-lead-in={props.leadIn ? "" : undefined}
      style={{ "--playhead": String(props.fill) } as CSSProperties}
    >
      <span className="lyrics-playhead" aria-hidden="true" />
      <div className="lyrics-cue-body">{props.children}</div>
    </div>
  );
}
