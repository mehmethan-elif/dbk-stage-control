import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnnotationMode, getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
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
  secondsPerMeasure,
  sectionIndexAt,
  tempoAt,
  timeToMusical,
  hidesLeftoverNotaRects,
  isMetronomeSetlistMode,
  songDisplayName,
  type Song
} from "@dbk/core";
import { useFollowPlayheadTime } from "../../store/follow-clock";
import { clientPracticeMode, currentGig, elifCanEditSetlist, elifLookingAhead, followsSharedPlayhead, panicBlocksFollow, selectAddedSetlistEntry, stageAutoScroll, stagePlayheadTime, useMasterStore } from "../../store/master-store";
import { findSongByRef, isSongLibraryGig, librarySongsNotOnSetlist, selectedLibraryEntries, withSelectedLibrarySong } from "../../store/song-library";
import { libraryApi } from "../../library/api";
import { ChainIcon, DeleteIcon } from "../shared/icons";
import { StageSetlist } from "./StageSetlist";
import { CONCERT_FINAL_LABEL, StageFinishRow, stageBodyEntries } from "./setlist-marker";
import { StageSongHead } from "./StageSongHead";
import { SongTitleMeta } from "./stage-title-meta";
import {
  scrollStageToNotaSectionMeasures,
  scrollStageToSongTitle,
  scrollStageToSongTitleWhenReady,
  stageLeadInNode
} from "./stage-scroll";
import { upcomingSongLeadIn } from "./next-song-section";
import { countLabel, countSection, isCountSection } from "./count-section";
import { sectionBarClass } from "./section-color";
import {
  ChordNoteLane,
  displayChordText,
  uniqueChordLabelBoxes,
  nextNoteGridIfDifferent,
  notesForBox,
  rectChordLane,
  stepsForBox,
  type ChordNoteHit
} from "./chord-notes";
import { NOTE_GRID_GAP } from "./nota-rect-notes";
import { rallOverlayBoxes } from "./rall-alert";
import { SCORE_LYRIC_GAP_PX, activeScoreLyric, scoreLyricPlacements } from "./score-lyrics";
import {
  addNotaBox,
  ensureSectionLabels,
  shouldPersistNotaLayout,
  isSectionLabel,
  sectionLabelText,
  applyChainedRectGeometry,
  boxForOccurrence,
  breakMeasureChain,
  canChainMeasure,
  clampNotaBox,
  clampNotaPage,
  editableNotaSections,
  effectiveBrokenChains,
  isMeasureChained,
  linkMeasureChain,
  loadNotaLayout,
  losesMeasureLayout,
  mergeNotaRects,
  rememberNotaLayout,
  nextEmptySectionMeasure,
  nextNotaHit,
  notaHitAt,
  nowLooksAheadHit,
  notaSectionScrollTargets,
  rectsForHit,
  rectsForLiveSections,
  rectsForSectionOccurrence,
  saveNotaSections,
  sectionMeasureNumbers,
  touchedNotaNames,
  upsertNotaBox,
  type BrokenMeasureChain,
  type NotaSectionBox
} from "./nota-sections";

GlobalWorkerOptions.workerSrc = pdfWorker;

type RectHandle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

function applyRectHandle(
  handle: RectHandle,
  start: NotaSectionBox,
  nx: number,
  ny: number
): NotaSectionBox {
  if (handle === "move") {
    return clampNotaBox({ ...start, x: nx, y: ny });
  }
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;
  if (handle === "n" || handle === "nw" || handle === "ne") {
    y = ny;
    h = bottom - ny;
  }
  if (handle === "s" || handle === "sw" || handle === "se") h = ny - start.y;
  if (handle === "w" || handle === "nw" || handle === "sw") {
    x = nx;
    w = right - nx;
  }
  if (handle === "e" || handle === "ne" || handle === "se") w = nx - start.x;
  return clampNotaBox({ ...start, x, y, w, h });
}

function notaFile(files: string[] | undefined): string | undefined {
  return files?.find((name) => /(^|\/)nota\.pdf$/i.test(name));
}

function visiblePageSize(root: HTMLElement | null): { width: number; height: number } | undefined {
  if (!root) return undefined;
  const wraps = [...root.querySelectorAll<HTMLElement>(".nota-page-wrap")];
  const wrap = wraps[visiblePageIndex(root)] ?? wraps[0];
  const box = wrap?.getBoundingClientRect();
  if (!box || box.width < 8 || box.height < 8) return undefined;
  return { width: box.width, height: box.height };
}

function visiblePageIndex(root: HTMLElement | null): number {
  if (!root) return 0;
  const wraps = [...root.querySelectorAll<HTMLElement>(".nota-page-wrap")];
  const stage = root.closest(".nota-stage");
  if (!stage || wraps.length === 0) return 0;
  const view = stage.getBoundingClientRect();
  let best = 0;
  let bestArea = -1;
  wraps.forEach((wrap, index) => {
    const box = wrap.getBoundingClientRect();
    const area = Math.max(0, Math.min(box.bottom, view.bottom) - Math.max(box.top, view.top));
    if (area > bestArea) {
      bestArea = area;
      best = index;
    }
  });
  return best;
}

export type NotaLayer = "score" | "chord";

export function NotaView({ layer = "score" }: { layer?: NotaLayer }) {
  const songs = useMasterStore((s) => s.songs);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const gig = useMasterStore(currentGig);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const selectSetlistEntry = useMasterStore((s) => s.selectSetlistEntry);
  const updateGig = useMasterStore((s) => s.updateGig);
  const playback = useMasterStore((s) => s.playback);
  const readOnly = useMasterStore((s) => s.deviceKind === "client");
  const elifEdits = useMasterStore(elifCanEditSetlist);
  const selectPracticeSong = useMasterStore((s) => s.selectPracticeSong);
  const setlistOpen = useMasterStore((s) => s.setlistOpen);
  const editOpen = useMasterStore((s) => s.editOpen);
  const sectionEditing = Boolean(!readOnly && editOpen);
  const zoom = useMasterStore((s) => s.stageZooms[layer === "chord" ? "chords" : "nota"]);
  const autoScroll = useMasterStore(stageAutoScroll);
  const panicFollow = useMasterStore(panicBlocksFollow);
  const detached = useMasterStore(followsSharedPlayhead);
  const lookingAhead = useMasterStore(elifLookingAhead);
  const stageRef = useRef<HTMLElement>(null);
  const [editSlot, setEditSlot] = useState<HTMLDivElement | null>(null);
  const [pagesTick, setPagesTick] = useState(0);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [rectsBySong, setRectsBySong] = useState<Record<string, NotaSectionBox[]>>({});
  const [brokenBySong, setBrokenBySong] = useState<Record<string, BrokenMeasureChain[]>>({});
  const loadedSongIds = useRef(new Set<string>());
  const dirtySongIds = useRef(new Set<string>());
  const rectsBySongRef = useRef(rectsBySong);
  rectsBySongRef.current = rectsBySong;
  const brokenBySongRef = useRef(brokenBySong);
  brokenBySongRef.current = brokenBySong;
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
  const playingEntryId = lookingAhead
    ? undefined
    : playing && detached
      ? playback.clock?.setlistEntryId
      : playing && !detached
        ? (selectedEntryId ?? playback.clock?.setlistEntryId)
        : undefined;
  const followTime = useMasterStore(stagePlayheadTime);
  const playingSong = findSongByRef(
    songs,
    detached
      ? playback.clock?.songId
      : (entries.find((entry) => entry.entryId === selectedEntryId)?.songId ??
        playback.clock?.songId)
  );
  const upcoming = playingEntryId
    ? upcomingSongLeadIn(bodySource, songs, playingEntryId, playingSong, followTime)
    : undefined;
  const visible = (practice || isSongLibraryGig(gig) ? bodySource.filter(isSongEntry) : entries).filter(
    (entry) => !entry.skipped
  );
  const bodyEntries = stageBodyEntries(bodySource);
  const selected =
    visible.find((entry) => entry.entryId === selectedEntryId) ?? visible[0];
  const selectedSong = findSongByRef(songs, selected?.songId);

  const pinToSelected = !panicFollow && (!detached || !autoScroll || !playingEntryId);
  const selectedSongId = selected?.entryId ?? null;

  useEffect(() => {
    if (!pinToSelected || !selectedSongId) return;
    scrollStageToSongTitleWhenReady(stageRef.current, `[data-nota-song="${selectedSongId}"]`);
  }, [selectedSongId, pinToSelected, sectionEditing]);

  const onPagesLayout = () => {
    setPagesTick((tick) => tick + 1);
    if (!pinToSelected || !selectedSongId) return;
    scrollStageToSongTitle(stageRef.current, `[data-nota-song="${selectedSongId}"]`);
  };

  useEffect(() => {
    if (!autoScroll || sectionEditing || playingEntryId || !selectedSongId) return;
    scrollStageToSongTitle(stageRef.current, `[data-nota-song="${selectedSongId}"]`);
  }, [autoScroll, sectionEditing, playingEntryId, selectedSongId, zoom]);

  useEffect(() => {
    if (!autoScroll || sectionEditing || !playingEntryId) return;
    const stage = stageRef.current;
    if (!stage) return;
    const songRoot = stage.querySelector(`[data-nota-song="${playingEntryId}"]`);
    if (!(songRoot instanceof HTMLElement) || !playingSong) return;
    if (hidesLeftoverNotaRects(playingSong, gig?.performanceMode)) {
      scrollStageToSongTitle(stage, `[data-nota-song="${playingEntryId}"]`);
      return;
    }
    const rects = rectsBySong[playingSong.id] ?? [];
    const broken = brokenBySong[playingSong.id] ?? [];
    const targets = notaSectionScrollTargets(playingSong, followTime, rects, broken);
    const leadIn = stageLeadInNode(stage, "data-nota-song", upcoming?.entryId);
    scrollStageToNotaSectionMeasures(
      stage,
      songRoot,
      targets.current,
      targets.next,
      targets.focus,
      leadIn
    );
  }, [
    autoScroll,
    brokenBySong,
    fileIndex,
    gig?.performanceMode,
    sectionEditing,
    followTime,
    playingEntryId,
    playingSong,
    rectsBySong,
    upcoming?.entryId,
    pagesTick,
    zoom
  ]);

  useEffect(() => {
    setSectionIndex(editableNotaSections(selectedSong?.sections ?? [])[0]?.index ?? 0);
  }, [selectedSong?.id]);

  const visibleSongIds = visible.map((entry) => entry.songId).join("\0");
  useEffect(() => {
    const ids = [...new Set(visibleSongIds ? visibleSongIds.split("\0") : [])];
    if (ids.length === 0) {
      loadedSongIds.current.clear();
      dirtySongIds.current.clear();
      setRectsBySong({});
      setBrokenBySong({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      ids.map(async (id) => {
        try {
          const song = songs.find((item) => item.id === id);
          return [id, await loadNotaLayout(id, song?.sections ?? [])] as const;
        } catch {
          return [id, { rects: [], brokenChains: [] }] as const;
        }
      })
    ).then((rows) => {
      if (cancelled) return;
      setRectsBySong((current) => {
        const next = { ...current };
        for (const [id, layout] of rows) {
          loadedSongIds.current.add(id);
          if (dirtySongIds.current.has(id) && current[id]) {
            const names = new Set(current[id].map((box) => box.name));
            next[id] = mergeNotaRects(layout.rects, current[id], names);
            continue;
          }
          next[id] = layout.rects;
        }
        return next;
      });
      setBrokenBySong((current) => {
        const next = { ...current };
        for (const [id, layout] of rows) {
          if (dirtySongIds.current.has(id) && current[id]) continue;
          next[id] = layout.brokenChains;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [visibleSongIds]);

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

  const commitLayout = (
    songId: string,
    next: NotaSectionBox[],
    persist: boolean,
    broken = brokenBySongRef.current[songId] ?? []
  ) => {
    const previous = rectsBySongRef.current[songId] ?? [];
    if (losesMeasureLayout(previous, next)) return;
    const touched = touchedNotaNames(previous, next);
    const chains = effectiveBrokenChains(next, broken);
    dirtySongIds.current.add(songId);
    rememberNotaLayout(songId, next, chains);
    setRectsBySong((current) => ({ ...current, [songId]: next }));
    setBrokenBySong((current) => ({ ...current, [songId]: chains }));
    if (persist && loadedSongIds.current.has(songId)) {
      void saveNotaSections(songId, next, touched, chains);
    }
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
            songAttr="data-nota-song"
          />
        ) : null}
        <div className="nota-main">
        {sectionEditing ? <div ref={setEditSlot} className="nota-edit-slot" /> : null}
        <section
          ref={stageRef}
          className="lyrics-stage nota-stage"
          style={{ "--lyrics-zoom": String(zoom) } as CSSProperties}
        >
          {visible.length === 0 ? (
            <div className="lyrics-empty meta">No nota</div>
          ) : (
            <>
              {(sectionEditing && selected
                ? bodyEntries.filter((entry) => entry.entryId === selected.entryId)
                : bodyEntries
              ).map((entry) => {
                if (isTalkEntry(entry)) {
                  return (
                    <StageFinishRow
                      key={entry.entryId}
                      label={talkDisplayLabel(entry)}
                      entryId={entry.entryId}
                      locked={isLockedElif(entry)}
                      attr="data-nota-song"
                    />
                  );
                }
                if (!isSongEntry(entry)) return null;
                const item = findSongByRef(songs, entry.songId);
                const editing = Boolean(sectionEditing && selected && entry.entryId === selected.entryId);
                return (
                  <SongNota
                    key={entry.entryId}
                    layer={layer}
                    entryId={entry.entryId}
                    song={item}
                    file={notaFile(item ? fileIndex[item.id] : undefined)}
                    zoom={zoom}
                    editing={editing}
                    editSlot={editSlot}
                    autoScroll={autoScroll && !sectionEditing}
                    leadIn={upcoming?.entryId === entry.entryId}
                    sectionIndex={sectionIndex}
                    onSectionIndex={setSectionIndex}
                    onPagesLayout={onPagesLayout}
                    rects={item ? (rectsBySong[item.id] ?? []) : []}
                    layoutReady={Boolean(item && item.id in rectsBySong)}
                    brokenChains={item ? (brokenBySong[item.id] ?? []) : []}
                    onRects={(next, persist, broken) => {
                      if (item) commitLayout(item.id, next, persist, broken);
                    }}
                  />
                );
              })}
              {!sectionEditing && entries.length > 0 ? (
                <StageFinishRow label={CONCERT_FINAL_LABEL} />
              ) : null}
            </>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}

function SongNota(props: {
  layer: NotaLayer;
  entryId: string;
  song: Song | undefined;
  file: string | undefined;
  zoom: number;
  editing: boolean;
  editSlot?: HTMLDivElement | null;
  autoScroll: boolean;
  leadIn?: boolean;
  sectionIndex: number;
  onSectionIndex: (index: number) => void;
  onPagesLayout: () => void;
  rects: NotaSectionBox[];
  layoutReady: boolean;
  brokenChains: BrokenMeasureChain[];
  onRects: (rects: NotaSectionBox[], persist: boolean, broken?: BrokenMeasureChain[]) => void;
}) {
  const song = props.song;
  const file = props.file;
  const title = songDisplayName(song);
  const leftoverHidden = useMasterStore((s) =>
    hidesLeftoverNotaRects(song, currentGig(s)?.performanceMode)
  );
  const hideRects = !props.editing && leftoverHidden;
  const liveRects = hideRects ? [] : rectsForLiveSections(props.rects, song?.sections ?? []);
  const choices = editableNotaSections(song?.sections ?? []);
  const articleRef = useRef<HTMLElement>(null);
  const [measurePick, setMeasurePick] = useState<number | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const selectedChoice =
    choices.find((item) => item.index === props.sectionIndex) ?? choices[0];
  const sectionIndex = selectedChoice?.index ?? -1;
  const name = selectedChoice?.name ?? "";
  const selectedSection = sectionIndex >= 0 ? song?.sections[sectionIndex] : undefined;
  const canChain = canChainMeasure(song?.sections ?? [], name);
  const measures = selectedSection
    ? sectionMeasureNumbers([selectedSection], song?.tempoMap, selectedSection.name)
    : [];
  const measure =
    measurePick != null && measures.includes(measurePick) ? measurePick : (measures[0] ?? 0);
  const broken = effectiveBrokenChains(liveRects, props.brokenChains);
  const chained = measure > 0 && isMeasureChained(broken, name, measure);
  const canEdit = sectionIndex >= 0;
  const sectionRects = rectsForSectionOccurrence(liveRects, name, sectionIndex, broken);
  const measureRects = sectionRects.filter((box) => !isSectionLabel(box));
  const sectionLabels = liveRects.filter(isSectionLabel);
  const selectedLabel =
    canEdit && selectedLabelId
      ? sectionLabels.find((box) => box.id === selectedLabelId)
      : undefined;
  const activeRect = canEdit
    ? boxForOccurrence(liveRects, name, measure, sectionIndex, chained)
    : undefined;
  const emptyMeasure = canEdit
    ? nextEmptySectionMeasure(measures, liveRects, name, measure, {
        sectionIndex,
        broken
      })
    : undefined;

  const liveRectKey = liveRects.map((box) => box.id).join("\0");
  const storedRectKey = props.rects.map((box) => box.id).join("\0");
  useEffect(() => {
    if (hideRects || !props.layoutReady || !song?.sections.length) return;
    const next = ensureSectionLabels(
      props.rects,
      song.sections,
      visiblePageIndex(articleRef.current)
    );
    if (!next) return;
    if (shouldPersistNotaLayout(props.rects, next) && props.rects.some((box) => !isSectionLabel(box))) {
      const added = next.filter((box) => !props.rects.some((row) => row.id === box.id));
      props.onRects([...props.rects, ...added], true);
      return;
    }
    if (liveRectKey !== storedRectKey) props.onRects(next, false);
  }, [hideRects, props.layoutReady, song?.id, liveRectKey, storedRectKey]);

  const selectBox = (box: NotaSectionBox) => {
    if (isSectionLabel(box)) {
      setSelectedLabelId(box.id);
      if (box.sectionIndex != null) {
        props.onSectionIndex(box.sectionIndex);
        return;
      }
      const first = choices.find((item) => item.name === box.name);
      if (first) props.onSectionIndex(first.index);
      return;
    }
    setSelectedLabelId(null);
    if (box.sectionIndex != null) props.onSectionIndex(box.sectionIndex);
    setMeasurePick(box.measure);
  };

  const addRect = () => {
    if (!name || emptyMeasure == null) return;
    const pages = articleRef.current?.querySelectorAll(".nota-page-wrap").length ?? 1;
    const added = addNotaBox(
      liveRects,
      name,
      emptyMeasure,
      visiblePageIndex(articleRef.current),
      Math.max(0, pages - 1),
      sectionIndex,
      broken,
      visiblePageSize(articleRef.current)
    );
    if (!added) return;
    setSelectedLabelId(null);
    setMeasurePick(emptyMeasure);
    props.onRects(added.rects, true, broken);
  };

  const toggleChain = () => {
    if (!song || !canChain || measure < 1) return;
    if (chained) {
      props.onRects(breakMeasureChain(liveRects, song.sections, name, measure), true, [
        ...broken,
        { name, measure }
      ]);
      return;
    }
    props.onRects(
      linkMeasureChain(liveRects, song.sections, name, measure, sectionIndex),
      true,
      broken.filter((item) => !(item.name === name && item.measure === measure))
    );
  };
  const removeRect = () => {
    if (canEdit && selectedLabel) {
      setSelectedLabelId(null);
      props.onRects(
        liveRects.filter((item) => item.id !== selectedLabel.id),
        true
      );
      return;
    }
    if (!canEdit || !activeRect) return;
    const next = chained
      ? liveRects.filter(
          (item) =>
            isSectionLabel(item) ||
            !(item.name === activeRect.name && item.measure === activeRect.measure)
        )
      : liveRects.filter((item) => item.id !== activeRect.id);
    const remaining = next.filter((item) => item.name === name && !isSectionLabel(item));
    const previous = remaining
      .filter((item) => item.measure > 0)
      .sort((a, b) => a.measure - b.measure)
      .at(-1);
    setMeasurePick(previous?.measure ?? null);
    props.onRects(next, true);
  };
  const removeAllRects = () => {
    setMeasurePick(null);
    props.onRects([], true, []);
  };

  const sectionlessLeadIn = Boolean(props.leadIn && !(song?.sections.length));
  const songHead = (
      <StageSongHead
        songId={song?.id}
        entryId={props.entryId}
        page={props.layer === "chord" ? "chord" : "score"}
      >
        <span
          className="nota-song-name"
          data-lead-in={
            props.leadIn &&
            !sectionlessLeadIn &&
            !liveRects.some((box) => box.name === song?.sections[0]?.name)
              ? ""
              : undefined
          }
        >
          {title}
        </span>
        <SongTitleMeta song={song} entryId={props.entryId} />
      </StageSongHead>
  );
  const editDock = props.editing ? (
      <div className="nota-edit-dock">
      {songHead}
        <div className="nota-edit-bar">
          <select
            className="prop-select nota-section-select"
            aria-label="Section"
            value={sectionIndex >= 0 ? String(sectionIndex) : ""}
            disabled={choices.length === 0}
            onChange={(event) => {
              const nextIndex = Number(event.target.value);
              props.onSectionIndex(nextIndex);
              setMeasurePick(null);
            }}
          >
            {choices.map((item) => (
              <option key={`${item.index}:${item.name}`} value={item.index}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            className="prop-select nota-measure-select"
            aria-label="Measure"
            value={measure > 0 ? String(measure) : ""}
            disabled={measures.length === 0}
            onChange={(event) => {
              const nextMeasure = Number(event.target.value);
              setMeasurePick(nextMeasure);
            }}
          >
            {measures.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`icon-btn${chained && canChain ? " on" : ""}`}
            title="Measure chain"
            aria-label="Measure chain"
            aria-pressed={chained}
            disabled={!canChain || measure < 1}
            onClick={toggleChain}
          >
            <ChainIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Add section rectangle"
            aria-label="Add section rectangle"
            disabled={emptyMeasure == null || !canEdit}
            onClick={addRect}
          >
            +
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Delete section rectangle"
            aria-label="Delete section rectangle"
            disabled={!canEdit || (!activeRect && !selectedLabel)}
            onClick={removeRect}
          >
            −
          </button>
          <button
            type="button"
            className="icon-btn danger"
            title="Delete all section rectangles"
            aria-label="Delete all section rectangles"
            disabled={liveRects.length === 0}
            onClick={removeAllRects}
          >
            <DeleteIcon />
          </button>
        </div>
      </div>
  ) : null;

  return (
    <article
      ref={articleRef}
      className={`lyrics-song nota-song${props.editing ? " chord-editing" : ""}`}
      data-nota-song={props.entryId}
      data-lead-in={sectionlessLeadIn ? "" : undefined}
    >
      {props.editing && props.editSlot
        ? createPortal(editDock, props.editSlot)
        : props.editing
          ? editDock
          : songHead}
      {song && file ? <NotaProgressBar entryId={props.entryId} song={song} /> : null}
      {song && file ? (
        <NotaPages
          songId={song.id}
          file={file}
          zoom={props.zoom}
          onLayout={props.onPagesLayout}
          overlay={(page, pageCount) =>
            props.editing ? (
              <>
                {props.layer === "chord" ? (
                  <RectChordLabels
                    song={song}
                    rects={measureRects}
                    page={page}
                    lastPage={pageCount - 1}
                    sectionIndex={sectionIndex}
                    editing
                  />
                ) : null}
                {sectionLabels
                  .filter((box) => clampNotaPage(box.page, pageCount - 1) === page)
                  .map((box) => (
                    <SectionLabelRect
                      key={box.id}
                      box={box}
                      selected={selectedLabel?.id === box.id}
                      onSelect={selectBox}
                      onChange={(next, persist) =>
                        props.onRects(upsertNotaBox(liveRects, next), persist)
                      }
                    />
                  ))}
                {measureRects
                  .filter(
                    (box) =>
                      clampNotaPage(box.page, pageCount - 1) === page &&
                      box.id !== activeRect?.id
                  )
                  .map((box) => (
                    <SectionRect key={box.id} box={box} previous onSelect={selectBox} />
                  ))}
                {canEdit &&
                activeRect &&
                clampNotaPage(activeRect.page, pageCount - 1) === page ? (
                  <>
                    <SectionRect
                      key={activeRect.id}
                      box={activeRect}
                      selected
                      onChange={(next, persist) =>
                        props.onRects(
                          chained
                            ? applyChainedRectGeometry(liveRects, next)
                            : upsertNotaBox(liveRects, next),
                          persist
                        )
                      }
                    />
                    {props.layer === "chord" ? (
                      <RectNoteGrid
                        box={activeRect}
                        notes={notesForBox(song, activeRect)}
                        steps={stepsForBox(song, activeRect)}
                        play="current"
                      />
                    ) : null}
                  </>
                ) : null}
                <RallMarks
                  song={song}
                  rects={liveRects}
                  page={page}
                  lastPage={pageCount - 1}
                  entryId={props.entryId}
                  brokenChains={broken}
                />
              </>
            ) : (
              <>
                {props.layer === "chord" ? (
                  <RectChordLabels
                    song={song}
                    rects={liveRects.filter((box) => !isSectionLabel(box))}
                    page={page}
                    lastPage={pageCount - 1}
                  />
                ) : null}
                {props.layer === "score" ? (
                  <ScoreLyrics
                    song={song}
                    rects={liveRects}
                    page={page}
                    lastPage={pageCount - 1}
                    brokenChains={broken}
                    entryId={props.entryId}
                  />
                ) : null}
                {liveRects
                  .filter(
                    (box) =>
                      isSectionLabel(box) && clampNotaPage(box.page, pageCount - 1) === page
                  )
                  .map((box) => (
                    <SectionLabelRect key={box.id} box={box} />
                  ))}
                {hideRects ? null : (
                  <PlayRects
                    page={page}
                    lastPage={pageCount - 1}
                    entryId={props.entryId}
                    song={song}
                    rects={liveRects}
                    brokenChains={broken}
                    autoScroll={props.autoScroll}
                    leadIn={props.leadIn}
                    showNoteGrids={props.layer === "chord"}
                  />
                )}
                <RallMarks
                  song={song}
                  rects={liveRects}
                  page={page}
                  lastPage={pageCount - 1}
                  entryId={props.entryId}
                  brokenChains={broken}
                />
              </>
            )
          }
        />
      ) : (
        <div className="lyrics-empty meta">No nota</div>
      )}
    </article>
  );
}

function NotaProgressBar(props: { entryId: string; song: Song }) {
  const count = countSection(props.song);
  const playback = useMasterStore((state) => state.playback);
  const storeTime = useMasterStore(stagePlayheadTime);
  const followTime = useFollowPlayheadTime(storeTime);
  const panicFollow = useMasterStore(panicBlocksFollow);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  if (!count) return null;

  const playing =
    ((playback.state === PlaybackState.Playing ||
      playback.state === PlaybackState.Transitioning) ||
      panicFollow) &&
    (playback.clock?.setlistEntryId === props.entryId ||
      (panicFollow && selectedEntryId === props.entryId));
  const time = playing ? followTime : 0;
  const sectionIndex = playing ? sectionIndexAt(props.song.sections, time) : -1;
  const section = sectionIndex >= 0 ? props.song.sections[sectionIndex] : undefined;
  const showingCount = !section || isCountSection(props.song, section);

  let name = count.name;
  let label = countLabel(props.song, count.start, count.end);
  let fill = playing
    ? Math.min(1, Math.max(0, (time - count.start) / Math.max(0.02, count.end - count.start)))
    : 0;

  if (!showingCount && section) {
    const startMeasure = timeToMusical(props.song.tempoMap, section.start).measure;
    const endMeasure = timeToMusical(
      props.song.tempoMap,
      Math.max(section.start, section.end - 0.02)
    ).measure;
    const currentMeasure = timeToMusical(
      props.song.tempoMap,
      Math.min(Math.max(time, section.start), Math.max(section.start, section.end - 0.02))
    ).measure;
    const totalMeasures = Math.max(1, endMeasure - startMeasure + 1);
    const measureNumber = Math.min(
      totalMeasures,
      Math.max(1, currentMeasure - startMeasure + 1)
    );
    name = section.name;
    label = null;
    fill = measureNumber / totalMeasures;
  }

  return (
    <div className="nota-count-stack">
      <div
        className={`lyrics-section chord-section-name nota-count-bar playhead-green${sectionBarClass(name)}`}
        style={{ "--playhead": String(fill) } as CSSProperties}
      >
        <span className="lyrics-playhead" aria-hidden="true" />
        <div className="lyrics-cue-body form-section-bar">
          <span className="form-section-lead">{name}</span>
          {label ? (
            <span className="form-section-tail">
              <span className="drum-count-label">{label}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RectChordLabels(props: {
  song: Song;
  rects: NotaSectionBox[];
  page: number;
  lastPage: number;
  sectionIndex?: number;
  editing?: boolean;
}) {
  const shown = displayChordText;
  const musicBox = (box: NotaSectionBox): NotaSectionBox =>
    props.sectionIndex != null ? { ...box, sectionIndex: props.sectionIndex } : box;
  return (
    <>
      {uniqueChordLabelBoxes(props.rects)
        .filter((box) => clampNotaPage(box.page, props.lastPage) === props.page)
        .map((box) => {
          const lane = rectChordLane(props.song, musicBox(box));
          const marks = lane?.marks ?? [];
          const beats = lane?.beats ?? 4;
          if (!props.editing && marks.length === 0) return null;
          return (
            <div
              key={`chord-${box.id}`}
              className={`nota-rect-chords${props.editing ? " editing" : ""}`}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`
              }}
            >
              {marks.map((mark) => (
                <span
                  key={`beat-${mark.beat}`}
                  className="nota-rect-beat"
                  style={{ left: `${(mark.beat / beats) * 100}%` }}
                />
              ))}
              {marks.map((mark, index) => (
                <span
                  key={`${mark.text}-${mark.beat}-${index}`}
                  className="nota-rect-chord"
                  style={{ left: `${(mark.beat / beats) * 100}%` }}
                >
                  {shown(mark.text)}
                </span>
              ))}
            </div>
          );
        })}
    </>
  );
}

function ScoreLyrics(props: {
  song: Song;
  rects: NotaSectionBox[];
  page: number;
  lastPage: number;
  brokenChains: BrokenMeasureChain[];
  entryId: string;
}) {
  const storeTime = useMasterStore((s) => {
    const live =
      s.playback.clock?.setlistEntryId === props.entryId ||
      (panicBlocksFollow(s) && s.selectedEntryId === props.entryId);
    const idlePreview =
      s.playback.state !== PlaybackState.Playing &&
      s.playback.state !== PlaybackState.Transitioning &&
      !panicBlocksFollow(s) &&
      s.selectedEntryId === props.entryId;
    return live || idlePreview ? stagePlayheadTime(s) : undefined;
  });
  const line = activeScoreLyric(
    scoreLyricPlacements(props.song, props.rects, props.brokenChains).filter(
      (placement) => clampNotaPage(placement.page, props.lastPage) === props.page
    ),
    storeTime
  );
  if (!line) return null;
  return (
    <div
      className="nota-score-lyric current"
      data-score-lyric={line.id}
      style={{
        left: `${line.x * 100}%`,
        top: `calc(${line.y * 100}% + ${SCORE_LYRIC_GAP_PX}px)`,
        width: `${line.w * 100}%`
      }}
    >
      {line.text}
    </div>
  );
}

function RallMarks(props: {
  song: Song;
  rects: readonly NotaSectionBox[];
  page: number;
  lastPage: number;
  entryId: string;
  brokenChains?: BrokenMeasureChain[];
}) {
  const storeTime = useMasterStore((s) => {
    if (isMetronomeSetlistMode(currentGig(s)?.performanceMode)) return undefined;
    const live =
      s.playback.clock?.setlistEntryId === props.entryId ||
      (panicBlocksFollow(s) && s.selectedEntryId === props.entryId);
    const idlePreview =
      s.playback.state !== PlaybackState.Playing &&
      s.playback.state !== PlaybackState.Transitioning &&
      !panicBlocksFollow(s) &&
      s.selectedEntryId === props.entryId;
    return live || idlePreview ? stagePlayheadTime(s) : undefined;
  });
  return (
    <>
      {rallOverlayBoxes(props.song, props.rects, storeTime, props.brokenChains)
        .filter((box) => clampNotaPage(box.page, props.lastPage) === props.page)
        .map((box) => (
          <div
            key={`rall-${box.id}`}
            className="nota-rall-mark"
            data-rall-mark={box.id}
            style={{
              left: `${box.x * 100}%`,
              top: `calc(${(box.y + box.h) * 100}% + 3px)`
            }}
          >
            RALL
          </div>
        ))}
    </>
  );
}

function PlayRects(props: {
  page: number;
  lastPage: number;
  entryId: string;
  song: Song;
  rects: NotaSectionBox[];
  brokenChains: BrokenMeasureChain[];
  autoScroll: boolean;
  leadIn?: boolean;
  showNoteGrids?: boolean;
}) {
  const hidePlayRects = useMasterStore((s) =>
    hidesLeftoverNotaRects(props.song, currentGig(s)?.performanceMode)
  );
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const anyPlaying = useMasterStore(
    (s) =>
      s.playback.state === PlaybackState.Playing ||
      s.playback.state === PlaybackState.Transitioning ||
      panicBlocksFollow(s)
  );
  const playing = useMasterStore(
    (s) =>
      ((s.playback.state === PlaybackState.Playing ||
        s.playback.state === PlaybackState.Transitioning) ||
        panicBlocksFollow(s)) &&
      (s.playback.clock?.setlistEntryId === props.entryId ||
        (panicBlocksFollow(s) && s.selectedEntryId === props.entryId))
  );
  const preview = !anyPlaying && selectedEntryId === props.entryId;
  const active = playing || Boolean(props.leadIn) || preview;
  const storeTime = useMasterStore((s) => {
    const live =
      s.playback.clock?.setlistEntryId === props.entryId ||
      (panicBlocksFollow(s) && s.selectedEntryId === props.entryId);
    const idlePreview =
      s.playback.state !== PlaybackState.Playing &&
      s.playback.state !== PlaybackState.Transitioning &&
      !panicBlocksFollow(s) &&
      s.selectedEntryId === props.entryId;
    return live || idlePreview ? stagePlayheadTime(s) : 0;
  });
  const time = useFollowPlayheadTime(storeTime);
  if (hidePlayRects) return null;
  const onPage = (box: NotaSectionBox) => clampNotaPage(box.page, props.lastPage) === props.page;
  const currentHit = notaHitAt(props.song, time);
  const followingHit = nowLooksAheadHit(props.song, time, props.brokenChains);
  const nextMeasureHit = nextNotaHit(props.song, time);
  const currentBoxes = rectsForHit(props.rects, currentHit, props.brokenChains).filter(onPage);
  const currentIds = new Set(currentBoxes.map((box) => box.id));
  const nextBoxes = rectsForHit(props.rects, followingHit, props.brokenChains)
    .filter(onPage)
    .filter((box) => !currentIds.has(box.id));
  const nowNotes = notesForBox(props.song, currentHit);
  const previewHit = currentHit ? nextMeasureHit : followingHit;
  const nextNotes = nextNoteGridIfDifferent(nowNotes, notesForBox(props.song, previewHit));
  const nextGridBoxes =
    props.showNoteGrids && nextNotes
      ? rectsForHit(props.rects, previewHit, props.brokenChains)
          .filter(onPage)
          .filter((box) => !currentIds.has(box.id))
      : [];
  if (!active) return null;
  if (!playing && currentBoxes.length === 0 && nextBoxes.length === 0 && nextGridBoxes.length === 0) {
    return null;
  }
  return (
    <>
      {currentBoxes.map((box) => (
        <Fragment key={box.id}>
          <SectionRect box={box} play="current" />
          {props.showNoteGrids ? (
            <RectNoteGrid
              box={box}
              notes={nowNotes}
              steps={stepsForBox(props.song, box)}
              play="current"
            />
          ) : null}
        </Fragment>
      ))}
      {nextBoxes.map((box) => (
        <SectionRect key={box.id} box={box} play="next" />
      ))}
      {nextGridBoxes.map((box) => (
        <RectNoteGrid
          key={`next-grid-${box.id}`}
          box={box}
          notes={nextNotes ?? []}
          steps={stepsForBox(props.song, box)}
          play="next"
        />
      ))}
    </>
  );
}

function RectNoteGrid(props: {
  box: NotaSectionBox;
  notes: ChordNoteHit[];
  steps?: number;
  play: "current" | "next";
}) {
  return (
    <div
      className={`nota-rect-notes ${props.play}`}
      style={{
        left: `${props.box.x * 100}%`,
        top: `${props.box.y * 100}%`,
        width: `${props.box.w * 100}%`,
        transform: `translateY(calc(-100% - ${NOTE_GRID_GAP}px))`
      }}
    >
      <ChordNoteLane notes={props.notes} steps={props.steps} />
    </div>
  );
}

function SectionLabelRect(props: {
  box: NotaSectionBox;
  selected?: boolean;
  onSelect?: (box: NotaSectionBox) => void;
  onChange?: (box: NotaSectionBox, persist: boolean) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ start: NotaSectionBox; grabX: number; grabY: number } | null>(null);
  const latestRef = useRef(props.box);
  latestRef.current = props.box;
  const text = sectionLabelText(props.box);

  const pointerPos = (event: PointerEvent<HTMLElement>) => {
    const page = wrapRef.current?.parentElement;
    const bounds = page?.getBoundingClientRect();
    if (!bounds || bounds.width < 1 || bounds.height < 1) return null;
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height
    };
  };

  const fitSize = (persist: boolean) => {
    const node = wrapRef.current;
    const page = node?.parentElement;
    if (!node || !page || !props.onChange) return;
    const pageBox = page.getBoundingClientRect();
    if (pageBox.width < 1 || pageBox.height < 1) return;
    const nextW = Math.min(1, Math.max(0.02, node.offsetWidth / pageBox.width));
    const nextH = Math.min(1, Math.max(0.018, node.offsetHeight / pageBox.height));
    if (Math.abs(nextW - props.box.w) < 0.003 && Math.abs(nextH - props.box.h) < 0.003) return;
    const next = clampNotaBox({ ...props.box, w: nextW, h: nextH });
    latestRef.current = next;
    props.onChange(next, persist);
  };

  useLayoutEffect(() => {
    fitSize(false);
  }, [text, props.box.label, props.box.name]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!props.onChange) {
      props.onSelect?.(props.box);
      return;
    }
    props.onSelect?.(props.box);
    const pos = pointerPos(event);
    if (!pos) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { start: props.box, grabX: pos.x - props.box.x, grabY: pos.y - props.box.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !props.onChange) return;
    const pos = pointerPos(event);
    if (!pos) return;
    const next = clampNotaBox({ ...drag.start, x: pos.x - drag.grabX, y: pos.y - drag.grabY });
    latestRef.current = next;
    props.onChange(next, false);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !props.onChange) return;
    dragRef.current = null;
    props.onChange(latestRef.current, true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`nota-section-label${sectionBarClass(props.box.name)}${
        props.selected ? " selected" : ""
      }${props.onChange ? " editing" : ""}${props.onSelect ? " selectable" : ""}`}
      role="button"
      aria-label="Section name"
      aria-pressed={props.selected ? true : undefined}
      tabIndex={props.onSelect || props.onChange ? 0 : undefined}
      data-nota-kind="label"
      data-nota-section={props.box.name}
      data-nota-rect={props.box.id}
      style={{ left: `${props.box.x * 100}%`, top: `${props.box.y * 100}%` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span className="nota-section-label-text">{text}</span>
    </div>
  );
}

function SectionRect(props: {
  box: NotaSectionBox;
  dim?: boolean;
  previous?: boolean;
  selected?: boolean;
  play?: "current" | "next";
  leadIn?: boolean;
  onSelect?: (box: NotaSectionBox) => void;
  onChange?: (box: NotaSectionBox, persist: boolean) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    handle: RectHandle;
    start: NotaSectionBox;
    grabX: number;
    grabY: number;
  } | null>(null);
  const latestRef = useRef(props.box);
  latestRef.current = props.box;

  const pointerPos = (event: PointerEvent<HTMLElement>) => {
    const page = wrapRef.current?.parentElement;
    const bounds = page?.getBoundingClientRect();
    if (!bounds || bounds.width < 1 || bounds.height < 1) return null;
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!props.onChange) {
      if (!props.onSelect) return;
      event.preventDefault();
      event.stopPropagation();
      props.onSelect(props.box);
      return;
    }
    props.onSelect?.(props.box);
    const handle = ((event.target as HTMLElement).dataset.handle as RectHandle | undefined) ?? "move";
    event.preventDefault();
    event.stopPropagation();
    const pos = pointerPos(event);
    if (!pos) return;
    dragRef.current = {
      handle,
      start: props.box,
      grabX: pos.x - props.box.x,
      grabY: pos.y - props.box.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !props.onChange) return;
    const pos = pointerPos(event);
    if (!pos) return;
    const nx = drag.handle === "move" ? pos.x - drag.grabX : pos.x;
    const ny = drag.handle === "move" ? pos.y - drag.grabY : pos.y;
    const next = applyRectHandle(drag.handle, drag.start, nx, ny);
    latestRef.current = next;
    props.onChange(next, false);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !props.onChange) return;
    dragRef.current = null;
    props.onChange(latestRef.current, true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`nota-section-rect${props.dim ? " dim" : ""}${props.previous ? " previous" : ""}${props.selected ? " selected" : ""}${props.play ? ` play ${props.play}` : ""}${
        props.previous && props.onSelect ? " selectable" : ""
      }`}
      role={props.onChange ? "slider" : undefined}
      aria-label="Section rectangle"
      tabIndex={props.onChange ? 0 : undefined}
      data-lead-in={props.leadIn ? "" : undefined}
      data-nota-section={props.box.name}
      data-nota-measure={props.box.measure}
      data-nota-rect={props.box.id}
      style={{
        left: `${props.box.x * 100}%`,
        top: `${props.box.y * 100}%`,
        width: `${props.box.w * 100}%`,
        height: `${props.box.h * 100}%`
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {props.onChange
        ? (["n", "s", "e", "w", "nw", "ne", "sw", "se"] as RectHandle[]).map((handle) => (
            <span key={handle} data-handle={handle} className={`nota-section-handle ${handle}`} />
          ))
        : null}
    </div>
  );
}

function NotaPages(props: {
  songId: string;
  file: string;
  zoom: number;
  overlay?: (pageIndex: number, pageCount: number) => ReactNode;
  onLayout?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onLayoutRef = useRef(props.onLayout);
  onLayoutRef.current = props.onLayout;
  const canvases = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const docRef = useRef<PDFDocumentProxy | undefined>(undefined);
  const [pageCount, setPageCount] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const pageWidth = width > 0 ? Math.max(1, Math.round(width * props.zoom)) : 0;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let doc: PDFDocumentProxy | undefined;
    setPageCount(0);
    setFailed(null);
    const load = async () => {
      try {
        const buffer = await libraryApi.readBytes(props.songId, props.file);
        if (cancelled) return;
        doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
      } catch (error) {
        if (!cancelled) {
          setFailed(error instanceof Error ? error.message : String(error));
          onLayoutRef.current?.();
        }
      }
    };
    const observer = new ResizeObserver(() => {
      setWidth(Math.round(host.clientWidth));
    });
    observer.observe(host);
    setWidth(Math.round(host.clientWidth));
    void load();
    return () => {
      cancelled = true;
      observer.disconnect();
      docRef.current = undefined;
      void doc?.destroy();
    };
  }, [props.songId, props.file]);

  useLayoutEffect(() => {
    const doc = docRef.current;
    if (!doc || pageCount === 0 || pageWidth < 8) return;
    let cancelled = false;
    const paint = async () => {
      const dpr = window.devicePixelRatio || 1;
      for (let number = 1; number <= pageCount; number++) {
        const canvas = canvases.current.get(number - 1);
        const context = canvas?.getContext("2d");
        if (!canvas || !context) continue;
        const page = await doc.getPage(number);
        if (cancelled) return;
        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (pageWidth / unscaled.width) * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({
          canvasContext: context,
          viewport,
          annotationMode: AnnotationMode.DISABLE
        }).promise;
        if (cancelled) return;
      }
      if (!cancelled) onLayoutRef.current?.();
    };
    void paint();
    return () => {
      cancelled = true;
    };
  }, [pageCount, pageWidth]);

  return (
    <>
      {failed ? <div className="lyrics-empty meta">No nota</div> : null}
      <div className="nota-pages" hidden={Boolean(failed)}>
        <div ref={hostRef} className="nota-pages-measure" aria-hidden="true" />
        {Array.from({ length: pageCount }, (_, index) => (
          <div
            key={index}
            className="nota-page-wrap"
            data-nota-page={index}
            style={pageWidth > 0 ? { width: pageWidth } : undefined}
          >
            <canvas
              className="nota-page"
              ref={(node) => {
                if (node) canvases.current.set(index, node);
                else canvases.current.delete(index);
              }}
            />
            {props.overlay?.(index, pageCount)}
          </div>
        ))}
      </div>
    </>
  );
}
