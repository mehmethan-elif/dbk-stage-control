import { useRef, useState, type PointerEvent, type RefObject } from "react";
import {
  elifPlacementValid,
  entryPlayMode,
  isElifKonusma,
  isLockedElif,
  isSongEntry,
  withKeyChangeElifs,
  PlaybackState,
  PlayMode,
  songDisplayName,
  type SetlistEntry,
  type Song
} from "@dbk/core";
import { useMasterStore } from "../../store/master-store";
import { listedSongForColor, songRowStyle } from "../shared/key-color";
import { AddIcon, LockIcon, SkipIcon } from "../shared/icons";
import { ConcertFinalBlock, ElifLabel, ElifNote, setlistHasSongs } from "./setlist-marker";
import { scrollStageToSongTitle } from "./stage-scroll";

const DRAG_THRESHOLD = 8;

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
  const rows = [...list.querySelectorAll<HTMLElement>(".lyrics-set-block:not(.is-locked):not(.is-final)")];
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
  stageRef?: RefObject<HTMLElement | null>;
  songAttr?: "data-lyric-song" | "data-chord-song" | "data-drum-song" | "data-nota-song";
  onSelect: (entryId: string) => void;
  onSkip: (entryId: string) => void;
  onAdd: (songId: string) => void;
}) {
  const updateGig = useMasterStore((s) => s.updateGig);
  const playback = useMasterStore((s) => s.playback);
  const metronomePlaying = useMasterStore((s) => s.metronomePlaying);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const songPlaying =
    metronomePlaying ||
    playback.state === PlaybackState.Playing ||
    playback.state === PlaybackState.Transitioning;
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

  const persistOrder = (order: string[]) => {
    void updateGig((current) => {
      const lookup = new Map(current.setlist.map((entry) => [entry.entryId, entry]));
      const nextItems = entriesOf(order, lookup);
      if (!elifPlacementValid(nextItems)) return current;
      const leftovers = current.setlist.filter((entry) => !order.includes(entry.entryId));
      return { ...current, setlist: [...nextItems, ...leftovers] };
    }).finally(() => {
      setLiveOrder(null);
      setDraggingId(null);
    });
  };

  const selectEntry = (entryId: string) => {
    props.onSelect(entryId);
    if (!props.stageRef?.current || !props.songAttr) return;
    scrollStageToSongTitle(props.stageRef.current, `[${props.songAttr}="${entryId}"]`);
  };

  const onPointerDown = (entryId: string, event: PointerEvent<HTMLDivElement>) => {
    if (props.readOnly) {
      selectEntry(entryId);
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest(".lyrics-skip")) return;
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

  let songNumber = 0;

  return (
    <aside
      ref={listRef}
      className={`lyrics-setlist${draggingId ? " is-reordering" : ""}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {displayed.map((entry) => {
        const on = draggingId ? draggingId === entry.entryId : entry.entryId === props.selectedEntryId;
        if (isElifKonusma(entry)) {
          const locked = isLockedElif(entry);
          return (
            <div
              key={entry.entryId}
              className={`lyrics-set-block${on ? " on" : ""}${
                draggingId === entry.entryId ? " dragging" : ""
              }${locked ? " is-locked" : ""}`}
              onPointerDown={(event) => onPointerDown(entry.entryId, event)}
            >
              <div className={`lyrics-elif-item${on ? " on" : ""}${locked ? " is-locked" : ""}`}>
                {locked ? (
                  <span className="elif-lock">
                    <LockIcon />
                  </span>
                ) : null}
                <span className="elif-copy">
                  <ElifLabel />
                  {locked ? <ElifNote /> : null}
                </span>
              </div>
            </div>
          );
        }
        if (!isSongEntry(entry)) return null;
        songNumber += 1;
        const item = props.songs.find((row) => row.id === entry.songId);
        return (
          <div
            key={entry.entryId}
            className={`lyrics-set-block${on ? " on" : ""}${entry.skipped ? " skipped" : ""}${
              draggingId === entry.entryId ? " dragging" : ""
            }`}
            onPointerDown={(event) => onPointerDown(entry.entryId, event)}
          >
            <StageSongRow
              song={item}
              files={item ? fileIndex[item.id] : undefined}
              playMode={entryPlayMode(entry)}
              title={songDisplayName(item)}
              order={songNumber}
              added
              skipped={Boolean(entry.skipped)}
              selected={on}
              onName={() => selectEntry(entry.entryId)}
              onSkip={
                props.readOnly || (songPlaying && on)
                  ? undefined
                  : () => props.onSkip(entry.entryId)
              }
            />
          </div>
        );
      })}
      {setlistHasSongs(moved) ? <ConcertFinalBlock variant="lyrics" /> : null}
      {props.readOnly
        ? null
        : props.library.map((item) => (
            <StageSongRow
              key={item.id}
              song={item}
              title={songDisplayName(item)}
              added={false}
              selected={false}
              onName={() => undefined}
              onAdd={() => props.onAdd(item.id)}
            />
          ))}
      {props.entries.length === 0 && (props.readOnly || props.library.length === 0) ? (
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
  skipped?: boolean;
  selected: boolean;
  onName?: () => void;
  onSkip?: () => void;
  onAdd?: () => void;
}) {
  const tint =
    props.added && !props.skipped
      ? songRowStyle(listedSongForColor(props.song, props.playMode, props.files), props.selected)
      : undefined;
  return (
    <div
      className={`lyrics-set-item${props.added ? " added" : " library"}${props.selected ? " on" : ""}${
        props.skipped ? " skipped" : ""
      }`}
      style={tint}
    >
      <button type="button" className="lyrics-set-name" onClick={props.onName}>
        {props.added && props.order ? (
          <span className="lyrics-set-num">{String(props.order).padStart(2, "0")}</span>
        ) : null}
        {props.title}
      </button>
      {props.added ? (
        props.onSkip ? (
          <button
            type="button"
            className={`lyrics-skip${props.skipped ? " on" : ""}`}
            title="Skip"
            aria-label="Skip"
            aria-pressed={props.skipped}
            onClick={props.onSkip}
          >
            <SkipIcon />
          </button>
        ) : null
      ) : (
        <button type="button" className="lyrics-skip" title="Add" aria-label="Add" onClick={props.onAdd}>
          <AddIcon />
        </button>
      )}
    </div>
  );
}
