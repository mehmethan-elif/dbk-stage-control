import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { AnnotationMode, getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
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
  sectionIndexAt,
  tempoAt,
  timeToMusical,
  songDisplayName,
  type Song
} from "@dbk/core";
import { currentGig, useMasterStore } from "../../store/master-store";
import { readSongFile } from "../../native/library";
import { DeleteIcon } from "../shared/icons";
import { StageSetlist } from "./StageSetlist";
import { CONCERT_FINAL_LABEL, StageFinishRow, stageBodyEntries } from "./setlist-marker";
import { StageSongHead } from "./StageSongHead";
import { SongTitleMeta } from "./stage-title-meta";
import { scrollStageToSongTitle, stageNodeFullyInView } from "./stage-scroll";
import { countLabel, countSection, isCountSection } from "./count-section";
import { sectionBarClass } from "./section-color";
import {
  clampNotaBox,
  defaultNotaBox,
  loadNotaSections,
  saveNotaSections,
  uniqueSectionNames,
  upsertNotaBox,
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

export function NotaView() {
  const songs = useMasterStore((s) => s.songs);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const gig = useMasterStore(currentGig);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const selectSetlistEntry = useMasterStore((s) => s.selectSetlistEntry);
  const updateGig = useMasterStore((s) => s.updateGig);
  const playback = useMasterStore((s) => s.playback);
  const readOnly = useMasterStore((s) => s.deviceKind === "client");
  const setlistOpen = useMasterStore((s) => s.setlistOpen);
  const editOpen = useMasterStore((s) => s.editOpen);
  const zoom = useMasterStore((s) => s.stageZooms.nota);
  const autoScroll = useMasterStore((s) => s.autoScroll);
  const [sectionName, setSectionName] = useState("");
  const [rectsBySong, setRectsBySong] = useState<Record<string, NotaSectionBox[]>>({});
  const listEntries = gig ? withKeyChangeElifs(gig.setlist, songs) : [];
  const entries = listEntries.filter(isSongEntry);
  const addedIds = new Set(entries.map((entry) => entry.songId));
  const library = songs.filter((item) => !addedIds.has(item.id));
  const playing =
    playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
  const playingEntryId = playing ? playback.clock?.setlistEntryId : undefined;
  const stageRef = useRef<HTMLElement>(null);
  const visible = entries.filter((entry) => !entry.skipped);
  const bodyEntries = stageBodyEntries(listEntries);
  const selected =
    visible.find((entry) => entry.entryId === selectedEntryId) ?? visible[0];
  const selectedSong = songs.find((item) => item.id === selected?.songId);

  const pinToSelected = !autoScroll || !playingEntryId;
  const selectedSongId = selected?.entryId ?? null;

  useEffect(() => {
    if (!pinToSelected || !selectedSongId) return;
    scrollStageToSongTitle(stageRef.current, `[data-nota-song="${selectedSongId}"]`);
  }, [selectedSongId, pinToSelected, editOpen]);

  const onPagesLayout = () => {
    if (!pinToSelected || !selectedSongId) return;
    scrollStageToSongTitle(stageRef.current, `[data-nota-song="${selectedSongId}"]`);
  };

  useEffect(() => {
    if (!autoScroll || editOpen || playingEntryId || !selectedSongId) return;
    scrollStageToSongTitle(stageRef.current, `[data-nota-song="${selectedSongId}"]`);
  }, [autoScroll, editOpen, playingEntryId, selectedSongId, zoom]);

  useEffect(() => {
    setSectionName(
      uniqueSectionNames(selectedSong?.sections.slice(1) ?? [])[0] ?? ""
    );
  }, [selectedSong?.id]);

  const visibleSongIds = visible.map((entry) => entry.songId).join("\0");
  useEffect(() => {
    const ids = [...new Set(visibleSongIds ? visibleSongIds.split("\0") : [])];
    if (ids.length === 0) {
      setRectsBySong({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      ids.map(async (id) => {
        try {
          const song = songs.find((item) => item.id === id);
          return [id, await loadNotaSections(id, song?.sections ?? [])] as const;
        } catch {
          return [id, []] as const;
        }
      })
    ).then((rows) => {
      if (!cancelled) setRectsBySong(Object.fromEntries(rows));
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

  const commitRects = (songId: string, next: NotaSectionBox[], persist: boolean) => {
    setRectsBySong((current) => ({ ...current, [songId]: next }));
    if (persist) void saveNotaSections(songId, next);
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
            songAttr="data-nota-song"
          />
        ) : null}
        <section
          ref={stageRef}
          className="lyrics-stage nota-stage"
          style={{ "--lyrics-zoom": String(zoom) } as CSSProperties}
        >
          {visible.length === 0 ? (
            <div className="lyrics-empty meta">No nota</div>
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
                      attr="data-nota-song"
                    />
                  );
                }
                if (!isSongEntry(entry)) return null;
                const item = songs.find((row) => row.id === entry.songId);
                const editing = Boolean(!readOnly && editOpen && selected && entry.entryId === selected.entryId);
                return (
                  <SongNota
                    key={entry.entryId}
                    entryId={entry.entryId}
                    song={item}
                    file={notaFile(item ? fileIndex[item.id] : undefined)}
                    zoom={zoom}
                    editing={editing}
                    autoScroll={autoScroll && !editOpen}
                    sectionName={sectionName}
                    onSectionName={setSectionName}
                    onPagesLayout={onPagesLayout}
                    rects={item ? (rectsBySong[item.id] ?? []) : []}
                    onRects={(next, persist) => {
                      if (item) commitRects(item.id, next, persist);
                    }}
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

function SongNota(props: {
  entryId: string;
  song: Song | undefined;
  file: string | undefined;
  zoom: number;
  editing: boolean;
  autoScroll: boolean;
  sectionName: string;
  onSectionName: (name: string) => void;
  onPagesLayout: () => void;
  rects: NotaSectionBox[];
  onRects: (rects: NotaSectionBox[], persist: boolean) => void;
}) {
  const song = props.song;
  const file = props.file;
  const title = songDisplayName(song);
  const names = uniqueSectionNames(song?.sections.slice(1) ?? []);
  const articleRef = useRef<HTMLElement>(null);
  const [selectedRectId, setSelectedRectId] = useState<string | null>(null);
  const name = names.includes(props.sectionName) ? props.sectionName : (names[0] ?? "");
  const named = props.rects.filter((item) => item.name === name);
  const selectedRect =
    named.find((item) => item.id === selectedRectId) ?? named[named.length - 1];

  const addRect = () => {
    if (!name) return;
    const page = visiblePageIndex(articleRef.current);
    const box = defaultNotaBox(name, page, named.length);
    setSelectedRectId(box.id);
    props.onRects([...props.rects, box], true);
  };
  const removeRect = () => {
    if (!selectedRect) return;
    const next = props.rects.filter((item) => item.id !== selectedRect.id);
    const remaining = next.filter((item) => item.name === name);
    setSelectedRectId(remaining[remaining.length - 1]?.id ?? null);
    props.onRects(next, true);
  };
  const removeAllRects = () => {
    setSelectedRectId(null);
    props.onRects([], true);
  };

  return (
    <article ref={articleRef} className="lyrics-song nota-song" data-nota-song={props.entryId}>
      <StageSongHead songId={song?.id} page="score">
        <span className="nota-song-name">{title}</span>
        <SongTitleMeta song={song} entryId={props.entryId} />
      </StageSongHead>
      {props.editing ? (
        <div className="nota-edit-bar">
          <select
            className="prop-select nota-section-select"
            aria-label="Section"
            value={name}
            disabled={names.length === 0}
            onChange={(event) => {
              const nextName = event.target.value;
              props.onSectionName(nextName);
              const last = props.rects.filter((item) => item.name === nextName).at(-1);
              setSelectedRectId(last?.id ?? null);
            }}
          >
            {names.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-btn"
            title="Add section rectangle"
            aria-label="Add section rectangle"
            disabled={!name}
            onClick={addRect}
          >
            +
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Delete section rectangle"
            aria-label="Delete section rectangle"
            disabled={!selectedRect}
            onClick={removeRect}
          >
            −
          </button>
          <button
            type="button"
            className="icon-btn danger"
            title="Delete all section rectangles"
            aria-label="Delete all section rectangles"
            disabled={props.rects.length === 0}
            onClick={removeAllRects}
          >
            <DeleteIcon />
          </button>
        </div>
      ) : null}
      {song && file ? <NotaProgressBar entryId={props.entryId} song={song} /> : null}
      {song && file ? (
        <NotaPages
          songId={song.id}
          file={file}
          zoom={props.zoom}
          onLayout={props.onPagesLayout}
          overlay={(page) =>
            props.editing ? (
              <>
                {props.rects
                  .filter((box) => box.page === page && box.name !== name)
                  .map((box) => (
                    <SectionRect key={box.id} box={box} dim />
                  ))}
                {named
                  .filter((box) => box.page === page)
                  .map((box) => (
                    <SectionRect
                      key={box.id}
                      box={box}
                      selected={box.id === selectedRect?.id}
                      onSelect={setSelectedRectId}
                      onChange={(next, persist) =>
                        props.onRects(upsertNotaBox(props.rects, next), persist)
                      }
                    />
                  ))}
              </>
            ) : (
              <PlayRects
                page={page}
                entryId={props.entryId}
                song={song}
                rects={props.rects}
                autoScroll={props.autoScroll}
              />
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
  if (!count) return null;

  const playing =
    (playback.state === PlaybackState.Playing ||
      playback.state === PlaybackState.Transitioning) &&
    playback.clock?.setlistEntryId === props.entryId;
  const time = playing ? (playback.clock?.time ?? 0) : 0;
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
  );
}

function PlayRects(props: {
  page: number;
  entryId: string;
  song: Song;
  rects: NotaSectionBox[];
  autoScroll: boolean;
}) {
  const playing = useMasterStore(
    (s) =>
      (s.playback.state === PlaybackState.Playing || s.playback.state === PlaybackState.Transitioning) &&
      s.playback.clock?.setlistEntryId === props.entryId
  );
  const time = useMasterStore((s) =>
    s.playback.clock?.setlistEntryId === props.entryId ? (s.playback.clock.time ?? 0) : 0
  );
  const current = playing ? sectionIndexAt(props.song.sections, time) : -1;
  const next = current >= 0 ? current + 1 : -1;
  const nextName = next >= 0 ? props.song.sections[next]?.name : undefined;
  const nextBoxes = nextName
    ? props.rects.filter((box) => box.name === nextName && box.page === props.page)
    : [];
  const section = current >= 0 ? props.song.sections[current] : undefined;
  const measureLen = secondsPerMeasure(tempoAt(props.song.tempoMap, time));
  const lastMeasure = Boolean(section && measureLen > 0 && time >= section.end - measureLen);

  useEffect(() => {
    if (!props.autoScroll || !lastMeasure || nextBoxes.length === 0) return;
    const node = document.querySelector(
      `[data-nota-song="${props.entryId}"] .nota-section-rect.next`
    );
    if (!(node instanceof HTMLElement)) return;
    const stage = node.closest(".nota-stage");
    if (stage instanceof HTMLElement && stageNodeFullyInView(stage, node)) return;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [lastMeasure, nextName, props.autoScroll, props.entryId, nextBoxes.length]);

  if (!playing) return null;
  return (
    <>
      {lastMeasure
        ? nextBoxes.map((box) => <SectionRect key={box.id} box={box} play="next" />)
        : null}
    </>
  );
}

function SectionRect(props: {
  box: NotaSectionBox;
  dim?: boolean;
  selected?: boolean;
  play?: "current" | "next";
  onSelect?: (id: string) => void;
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
    if (!props.onChange) return;
    props.onSelect?.(props.box.id);
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
      className={`nota-section-rect${props.dim ? " dim" : ""}${props.selected ? " selected" : ""}${props.play ? ` play ${props.play}` : ""}`}
      role={props.onChange ? "slider" : undefined}
      aria-label="Section rectangle"
      tabIndex={props.onChange ? 0 : undefined}
      data-nota-section={props.box.name}
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
  overlay?: (pageIndex: number) => ReactNode;
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
        const buffer = await readSongFile(props.songId, props.file);
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
            {props.overlay?.(index)}
          </div>
        ))}
      </div>
    </>
  );
}
