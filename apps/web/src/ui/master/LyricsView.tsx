import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  createId,
  currentLyricIndex,
  measureRangeFill,
  hasBackingAudio,
  hasClickFlac,
  ELIF_KONUSMA_LABEL,
  isElifKonusma,
  isLockedElif,
  insertAfterSelected,
  trimElifAfterLastSong,
  isSongEntry,
  effectivePlayMode,
  parseSongInfo,
  withKeyChangeElifs,
  PlaybackState,
  PlayMode,
  songDisplayName,
  type LyricLine,
  type Song,
  type TempoPoint,
  type SongSetlistEntry
} from "@dbk/core";
import {
  clientPracticeMode,
  currentGig,
  elifCanEditSetlist,
  panicBlocksFollow,
  selectAddedSetlistEntry,
  stageAutoScroll,
  followsSharedPlayhead,
  stagePlayheadTime,
  useMasterStore,
  usesFreeMetroTransport
} from "../../store/master-store";
import { findSongByRef, isSongLibraryGig, librarySongsNotOnSetlist, selectedLibraryEntries, withSelectedLibrarySong } from "../../store/song-library";
import { StageSetlist } from "./StageSetlist";
import { CONCERT_FINAL_LABEL, StageFinishRow, stageBodyEntries } from "./setlist-marker";
import { StageSongHead } from "./StageSongHead";
import { SongTitleMeta } from "./stage-title-meta";
import { useFreeStageScrollSelection } from "./free-stage-scroll";
import { scrollStageToFullSectionsCentered, scrollStageToSongTitle } from "./stage-scroll";
import { upcomingSongLeadIn } from "./next-song-section";
import { sectionBarClass } from "./section-color";

const TIME_EPS = 0.05;

type StageRow =
  | { kind: "section"; time: number; end: number; name: string }
  | { kind: "lyric"; time: number; end: number; line: LyricLine; lyricIndex: number };

function lyricBlocks(line: LyricLine): string[] {
  return line.text.split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
}

function lyricCovers(lyrics: LyricLine[], time: number): boolean {
  return lyrics.some((line) => {
    if (Math.abs(line.time - time) <= TIME_EPS) return true;
    if (line.end == null) return false;
    return line.time < time + TIME_EPS && time + TIME_EPS < line.end;
  });
}

function stageRows(song: Song | undefined, showSections = true): StageRow[] {
  const lyrics = song?.lyrics ?? [];
  const rows: StageRow[] = [];
  if (showSections) {
    for (const section of song?.sections ?? []) {
      if (!lyricCovers(lyrics, section.start)) {
        rows.push({ kind: "section", time: section.start, end: section.end, name: section.name });
      }
    }
  }
  lyrics.forEach((line, lyricIndex) => {
    rows.push({
      kind: "lyric",
      time: line.time,
      end: line.end ?? line.time,
      line,
      lyricIndex
    });
  });
  rows.sort((a, b) => a.time - b.time || (a.kind === "section" ? -1 : 1));
  const duration = song?.duration ?? 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.end > row.time) continue;
    row.end = rows[i + 1]?.time ?? duration;
  }
  return rows;
}

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
    (mode === PlayMode.Playback && hasBackingAudio(song, files)) ||
    (mode === PlayMode.ClickOnly && Boolean(song && hasClickFlac(song, files)))
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
  const followTime = useMasterStore(stagePlayheadTime);
  const readOnly = useMasterStore((s) => s.deviceKind === "client");
  const elifEdits = useMasterStore(elifCanEditSetlist);
  const selectPracticeSong = useMasterStore((s) => s.selectPracticeSong);
  const setlistOpen = useMasterStore((s) => s.setlistOpen);
  const zoom = useMasterStore((s) => s.stageZooms.lyrics);
  const autoScroll = useMasterStore(stageAutoScroll);
  const panicFollow = useMasterStore(panicBlocksFollow);
  const detached = useMasterStore(followsSharedPlayhead);
  const freeMode = useMasterStore(usesFreeMetroTransport);
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
  const playingEntryId =
    detached && (playing || panicFollow)
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
  useFreeStageScrollSelection(
    stageRef,
    "data-lyric-song",
    listEntries.map((entry) => entry.entryId).join("\0")
  );

  useEffect(() => {
    if (freeMode) return;
    if (detached) return;
    if (panicFollow) return;
    if (autoScroll && currentIdx >= 0) return;
    if (!selectedEntryId) return;
    scrollStageToSongTitle(stageRef.current, `[data-lyric-song="${selectedEntryId}"]`);
  }, [selectedEntryId, autoScroll, currentIdx, panicFollow, detached, freeMode]);

  useEffect(() => {
    if (!autoScroll || currentIdx < 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    const current = stage.querySelector(".lyrics-cue.current");
    const leadIn = stage.querySelector("[data-lead-in]");
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
                if (isElifKonusma(entry)) {
                  return (
                    <StageFinishRow
                      key={entry.entryId}
                      label={ELIF_KONUSMA_LABEL}
                      entryId={entry.entryId}
                      locked={isLockedElif(entry)}
                      showNotes
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
                    live={live}
                    time={liveTime}
                    smooth={readOnly && !practice && playing && live}
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
  live: boolean;
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
      const t = origin.current.time + Math.max(0, performance.now() - origin.current.wall) / 1000;
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
        }
      }
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, [props.live, props.smooth]);
  return (
    <article ref={rootRef} className="lyrics-song" data-lyric-song={props.entryId}>
      <StageSongHead songId={props.song?.id} page="lyrics">
        <span className="nota-song-name">{songDisplayName(props.song)}</span>
        <SongTitleMeta song={props.song} entryId={props.entryId} />
      </StageSongHead>
      {rows.length === 0 ? (
        <div className="lyrics-empty meta">No lyrics</div>
      ) : (
        rows.map((row, index) => {
          const lead = Boolean(props.leadIn && index === 0);
          const state = lead ? " next future" : cueClass(current, index, props.chainNext);
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
              className={`lyrics-line lyrics-cue${state}`}
              fill={cueFill(current, index, row.time, row.end, props.time, props.song?.tempoMap)}
              leadIn={lead}
            >
              {lyricBlocks(row.line).map((block, blockIndex) => (
                <div key={`${row.line.time}-${row.lyricIndex}-${blockIndex}`}>{block}</div>
              ))}
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
