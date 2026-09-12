import { useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from "react";
import {
  canInsertElifAfter,
  createId,
  elifPlacementValid,
  insertElifAfterSelected,
  isLockedElif,
  isStopMarker,
  isTalkEntry,
  isSongEntry,
  keepSkippedSongsInPlace,
  parseSongInfo,
  withKeyChangeElifs,
  PlaybackState,
  PlayMode,
  songDisplayName,
  type SetlistEntry,
  type Song
} from "@dbk/core";
import {
  clientPracticeMode,
  clientStageLive,
  currentGig,
  selectAddedSetlistEntry,
  setlistLocked,
  followsSharedPlayhead,
  stageConnectOn,
  useMasterStore
} from "../../store/master-store";
import { PlayModeMark } from "./play-mode-mark";
import { findSongByRef, SONG_LIBRARY_GIG_ID } from "../../store/song-library";
import { practiceEntryId } from "../../practice/gig";
import { listedSongForColor, songRowStyle } from "../shared/key-color";
import { AddIcon } from "../shared/icons";
import { ConcertFinalBlock, ElifNote, TalkLabel, TalkLeadIcon, setlistHasSongs } from "./setlist-marker";
import { groupLibrarySongs } from "./library-groups";
import { scrollStageToSongTitle } from "./stage-scroll";

const DRAG_THRESHOLD = 8;

let lastSetlistAction = 0;

function onSetlistAction(
  event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>,
  action?: () => void
) {
  event.stopPropagation();
  event.preventDefault();
  if ("button" in event && event.button > 0) return;
  const now = performance.now();
  if (now - lastSetlistAction < 400) return;
  lastSetlistAction = now;
  action?.();
}

function idsOf(entries: Array<{ entryId: string }>): string[] {
  return entries.map((entry) => entry.entryId);
}

function entriesOf(order: string[], lookup: Map<string, SetlistEntry>): SetlistEntry[] {
  return order.flatMap((id) => {
    const entry = lookup.get(id);
    return entry ? [entry] : [];
  });
}

function indexFromPointerY(list: HTMLElement, clientY: number): number {
  const rows = [
    ...list.querySelectorAll<HTMLElement>(
      ".lyrics-set-block:not(.is-locked):not(.is-final):not(.is-elif-add)"
    )
  ];
  if (rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const rect = row.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return rows.length - 1;
}

export function StageSetlist(props: {
  entries: SetlistEntry[];
  library: Song[];
  songs: Song[];
  selectedEntryId: string | null;
  readOnly?: boolean;
  hideTalkAdd?: boolean;
  stageRef?: RefObject<HTMLElement | null>;
  songAttr?: "data-lyric-song" | "data-chord-song" | "data-drum-song" | "data-nota-song";
  onSelect: (entryId: string) => void;
  onRemove: (entryId: string) => void;
  onAdd: (songId: string) => void;
  onSelectLibrary?: (songId: string) => void;
}) {
  const updateGig = useMasterStore((s) => s.updateGig);
  const gig = useMasterStore(currentGig);
  const playback = useMasterStore((s) => s.playback);
  const metronomePlaying = useMasterStore((s) => s.metronomePlaying);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const songLibrary = useMasterStore((s) => s.gigId === SONG_LIBRARY_GIG_ID);
  const frozen = useMasterStore(setlistLocked);
  const practice = useMasterStore(clientPracticeMode);
  const detached = useMasterStore(stageConnectOn);
  const followPlayhead = useMasterStore(followsSharedPlayhead);
  const liveClient = useMasterStore(clientStageLive);
  const readOnly = Boolean(props.readOnly || songLibrary);
  const showAddElif = Boolean(detached && !songLibrary && !readOnly && !props.hideTalkAdd);
  const canAddElif = Boolean(
    showAddElif && gig && canInsertElifAfter(gig.setlist, props.selectedEntryId)
  );
  const lockRows = frozen && (!readOnly || practice);
  const songPlaying =
    metronomePlaying ||
    playback.state === PlaybackState.Playing ||
    playback.state === PlaybackState.Transitioning;
  const playingEntryId = songPlaying
    ? followPlayhead || liveClient
      ? playback.clock?.setlistEntryId
      : props.selectedEntryId
    : undefined;
  const listRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startY: number;
    active: boolean;
    order: string[];
  } | null>(null);
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const movable = props.entries.filter((entry) => !isLockedElif(entry));
  const byId = new Map(movable.map((entry) => [entry.entryId, entry]));
  const moved = (liveOrder ?? idsOf(movable))
    .map((id) => byId.get(id))
    .filter((entry): entry is SetlistEntry => Boolean(entry));
  const displayed = draggingId ? moved : withKeyChangeElifs(moved, props.songs);
  const entryBySongId = new Map(
    moved.filter(isSongEntry).map((entry) => [entry.songId, entry] as const)
  );
  const playModes: Record<string, PlayMode> = {};
  for (const song of props.songs) {
    playModes[song.id] = parseSongInfo(song.info).playMode ?? PlayMode.View;
  }
  const groupedSetlistSongs = songLibrary
    ? groupLibrarySongs(
        props.songs.filter((song) => entryBySongId.has(song.id)),
        playModes,
        fileIndex
      )
    : [];
  const groupedLibrarySongs = groupLibrarySongs(props.library, playModes, fileIndex);

  const persistOrder = (order: string[]) => {
    void updateGig((current) => {
      const lookup = new Map(current.setlist.map((entry) => [entry.entryId, entry]));
      const nextItems = keepSkippedSongsInPlace(current.setlist, entriesOf(order, lookup));
      if (!elifPlacementValid(nextItems)) return current;
      const kept = new Set(nextItems.map((entry) => entry.entryId));
      const leftovers = current.setlist.filter((entry) => !kept.has(entry.entryId));
      return { ...current, setlist: [...nextItems, ...leftovers] };
    }).finally(() => {
      setLiveOrder(null);
      setDraggingId(null);
    });
  };

  const selectEntry = (entryId: string) => {
    props.onSelect(entryId);
    if (followPlayhead) return;
    if (!props.stageRef?.current || !props.songAttr) return;
    scrollStageToSongTitle(props.stageRef.current, `[${props.songAttr}="${entryId}"]`);
  };

  const onPointerDown = (entryId: string, event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".lyrics-skip")) {
      event.stopPropagation();
      return;
    }
    if (lockRows) return;
    if (readOnly) {
      selectEntry(entryId);
      return;
    }
    selectEntry(entryId);
    if (target.closest(".lyrics-set-block.is-locked")) return;
    dragRef.current = {
      id: entryId,
      pointerId: event.pointerId,
      startY: event.clientY,
      active: false,
      order: idsOf(moved)
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active && Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD) return;
    if (!drag.active) {
      drag.active = true;
      setDraggingId(drag.id);
      setLiveOrder(drag.order.slice());
      props.onSelect(drag.id);
      try {
        listRef.current?.setPointerCapture(event.pointerId);
      } catch {
        // pointer already captured or not active
      }
    }
    const list = listRef.current;
    if (!list) return;
    const from = drag.order.indexOf(drag.id);
    const to = indexFromPointerY(list, event.clientY);
    if (from < 0 || from === to) return;
    const next = drag.order.slice();
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    if (!elifPlacementValid(entriesOf(next, byId))) return;
    drag.order = next;
    setLiveOrder(next);
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    try {
      listRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
    if (!drag.active) return;
    persistOrder(drag.order);
  };

  const addElif = () => {
    if (!gig || !canAddElif) return;
    const entryId = createId("entry");
    void updateGig((current) => {
      const setlist = insertElifAfterSelected(current.setlist, props.selectedEntryId, entryId);
      if (setlist === current.setlist) return current;
      return { ...current, setlist };
    }).then(() => selectAddedSetlistEntry(entryId));
  };

  let songNumber = 0;

  const renderSongEntry = (entry: Extract<SetlistEntry, { type: "song" }>, item?: Song) => {
    const on = draggingId ? draggingId === entry.entryId : entry.entryId === props.selectedEntryId;
    songNumber += 1;
    return (
      <div
        key={entry.entryId}
        className={`lyrics-set-block${on ? " on" : ""}${
          draggingId === entry.entryId ? " dragging" : ""
        }${lockRows ? " is-frozen" : ""}`}
        onPointerDown={(event) => onPointerDown(entry.entryId, event)}
      >
        <StageSongRow
          song={item}
          files={item ? fileIndex[item.id] : undefined}
          playMode={parseSongInfo(item?.info).playMode ?? PlayMode.View}
          title={songDisplayName(item)}
          order={songNumber}
          added
          selected={on}
          playing={playingEntryId === entry.entryId}
          onName={lockRows ? undefined : () => selectEntry(entry.entryId)}
          onRemove={
            readOnly || (songPlaying && (detached ? playingEntryId === entry.entryId : on))
              ? undefined
              : () => props.onRemove(entry.entryId)
          }
        />
      </div>
    );
  };

  return (
    <aside
      ref={listRef}
      className={`lyrics-setlist${draggingId ? " is-reordering" : ""}${readOnly ? " is-readonly" : ""}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {songLibrary ? (
        groupedSetlistSongs.map((group) => (
          <div key={group.id} className="lyrics-library-group">
            <div className="lyrics-library-group-title">{group.title}</div>
            {group.songs.map((song) => {
              const entry = entryBySongId.get(song.id);
              return entry ? renderSongEntry(entry, song) : null;
            })}
          </div>
        ))
      ) : displayed.map((entry) => {
        const on = draggingId ? draggingId === entry.entryId : entry.entryId === props.selectedEntryId;
        if (isTalkEntry(entry)) {
          const locked = isLockedElif(entry);
          return (
            <div
              key={entry.entryId}
              className={`lyrics-set-block${on ? " on" : ""}${
                draggingId === entry.entryId ? " dragging" : ""
              }${locked ? " is-locked" : ""}${lockRows ? " is-frozen" : ""}`}
              onPointerDown={(event) => onPointerDown(entry.entryId, event)}
            >
              <div className={`lyrics-elif-item${on ? " on" : ""}${locked ? " is-locked" : ""}`}>
                <TalkLeadIcon locked={locked} stop={isStopMarker(entry)} />
                <span className="elif-copy">
                  <TalkLabel entry={entry} />
                  {locked ? <ElifNote /> : null}
                </span>
                {!readOnly && !locked ? (
                  <button
                    type="button"
                    className="lyrics-skip"
                    title="Delete"
                    aria-label="Delete"
                    onPointerDown={(event) =>
                      onSetlistAction(event, () => props.onRemove(entry.entryId))
                    }
                    onClick={(event) => onSetlistAction(event, () => props.onRemove(entry.entryId))}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>
          );
        }
        if (!isSongEntry(entry)) return null;
        const item = findSongByRef(props.songs, entry.songId);
        return renderSongEntry(entry, item);
      })}
      {!songLibrary && setlistHasSongs(moved) ? <ConcertFinalBlock variant="lyrics" /> : null}
      {showAddElif ? (
        <div className="lyrics-set-block is-elif-add">
          <div className="lyrics-elif-item lyrics-elif-add-item">
            <span className="elif-copy">
              <span className="elif-label">ELIF KONUSMA EKLE</span>
            </span>
            <button
              type="button"
              className="lyrics-skip"
              title="Add"
              aria-label="Add ELIF KONUSMA"
              disabled={!canAddElif}
              onPointerDown={(event) => onSetlistAction(event, canAddElif ? addElif : undefined)}
              onClick={(event) => onSetlistAction(event, canAddElif ? addElif : undefined)}
            >
              <AddIcon />
            </button>
          </div>
        </div>
      ) : null}
      {groupedLibrarySongs.map((group) => (
        <div key={group.id} className="lyrics-library-group">
          <div className="lyrics-library-group-title">{group.title}</div>
          {group.songs.map((item) => {
            const pickLibrary = () => {
              if (lockRows) return;
              props.onSelectLibrary?.(item.id);
              if (!props.stageRef?.current || !props.songAttr) return;
              scrollStageToSongTitle(
                props.stageRef.current,
                `[${props.songAttr}="${practiceEntryId(item.id)}"]`
              );
            };
            return (
              <div
                key={item.id}
                className={`lyrics-set-block${lockRows ? " is-frozen" : ""}`}
                onPointerDown={props.onSelectLibrary && !lockRows ? () => pickLibrary() : undefined}
              >
                <StageSongRow
                  song={item}
                  files={fileIndex[item.id]}
                  playMode={playModes[item.id] ?? PlayMode.View}
                  title={songDisplayName(item)}
                  added={false}
                  selected={props.selectedEntryId === practiceEntryId(item.id)}
                  onName={props.onSelectLibrary && !lockRows ? pickLibrary : undefined}
                  onAdd={readOnly ? undefined : () => props.onAdd(item.id)}
                />
              </div>
            );
          })}
        </div>
      ))}
      {props.entries.length === 0 && (readOnly || props.library.length === 0) ? (
        <div className="lyrics-empty meta">No songs</div>
      ) : null}
    </aside>
  );
}

function StageSongRow(props: {
  song: Song | undefined;
  files?: string[];
  playMode?: PlayMode;
  title: string;
  order?: number;
  added: boolean;
  selected: boolean;
  playing?: boolean;
  onName?: () => void;
  onRemove?: () => void;
  onAdd?: () => void;
}) {
  const gigMode = useMasterStore((s) => currentGig(s)?.performanceMode);
  const tint = songRowStyle(listedSongForColor(props.song, props.playMode, props.files), props.selected);
  return (
    <div
      className={`lyrics-set-item${props.added ? " added" : " library"}${props.selected ? " on" : ""}${props.playing ? " is-playing" : ""}`}
      style={tint}
    >
      <button type="button" className="lyrics-set-name" onClick={props.onName}>
        <span className="lyrics-set-index">
          <span className="lyrics-set-num">
            {props.added && props.order ? String(props.order).padStart(2, "0") : "—"}
          </span>
          {props.song ? (
            <PlayModeMark song={props.song} files={props.files} setlistMode={gigMode} />
          ) : null}
        </span>
        {props.title}
      </button>
      {props.added ? (
        props.onRemove ? (
          <button
            type="button"
            className="lyrics-skip"
            title="Delete"
            aria-label="Delete"
            onPointerDown={(event) => onSetlistAction(event, props.onRemove)}
            onClick={(event) => onSetlistAction(event, props.onRemove)}
          >
            ×
          </button>
        ) : null
      ) : (
        props.onAdd ? (
          <button
            type="button"
            className="lyrics-skip"
            title="Add"
            aria-label="Add"
            onPointerDown={(event) => onSetlistAction(event, props.onAdd)}
            onClick={(event) => onSetlistAction(event, props.onAdd)}
          >
            <AddIcon />
          </button>
        ) : null
      )}
    </div>
  );
}
