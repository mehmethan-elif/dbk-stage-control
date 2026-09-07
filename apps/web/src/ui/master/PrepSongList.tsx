import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  canInsertElifAfter,
  createId,
  ELIF_KONUSMA_LABEL,
  elifPlacementValid,
  FinishMode,
  hasBackingAudio,
  hasOnlyClickAudio,
  isElifKonusma,
  isLockedElif,
  isSongEntry,
  PlayMode,
  insertAfterSelected,
  songDisplayName,
  songPlaybackName,
  trimElifAfterLastSong,
  visibleSetlistEntries,
  withKeyChangeElifs,
  type SetlistEntry,
  type Song,
  type SongSetlistEntry
} from "@dbk/core";
import { currentGig, useMasterStore } from "../../store/master-store";
import { AddIcon, EighthNoteIcon, LockIcon, NotationIcon, ViewIcon } from "../shared/icons";
import {
  compareFacet,
  facetChipStyle,
  listedSongForColor,
  sameFacet,
  songRowStyle,
  type SongFacet
} from "../shared/key-color";
import { ConcertFinalBlock, ElifLabel, ElifNote, setlistHasSongs } from "./setlist-marker";

const DRAG_THRESHOLD = 8;

function uniqueFacet(songs: Song[], facet: SongFacet): string[] {
  const values: string[] = [];
  for (const song of songs) {
    for (const raw of facetValues(song, facet)) {
      if (values.some((value) => sameFacet(facet, value, raw))) continue;
      values.push(raw);
    }
  }
  return values.sort((a, b) => compareFacet(facet, a, b));
}

function toggleFacet(selected: string[], value: string, facet: SongFacet): string[] {
  const on = selected.some((item) => sameFacet(facet, item, value));
  return on ? selected.filter((item) => !sameFacet(facet, item, value)) : [...selected, value];
}

function matchesSelected(song: Song, selected: string[], facet: SongFacet): boolean {
  if (selected.length === 0) return true;
  return facetValues(song, facet).some((value) => selected.some((item) => sameFacet(facet, item, value)));
}

function facetValues(song: Song, facet: SongFacet): string[] {
  const fromSong = facet === "key" ? song.key : facet === "scale" ? song.scale : song.style;
  const fromInfo = facet === "key" ? song.info?.key : facet === "scale" ? song.info?.scale : song.info?.style;
  const values: string[] = [];
  for (const raw of [fromInfo, fromSong]) {
    const text = raw?.trim();
    if (!text) continue;
    if (values.some((value) => sameFacet(facet, value, text))) continue;
    values.push(text);
  }
  return values;
}

function songFacet(song: Song, facet: SongFacet, playMode?: PlayMode, files?: string[]): string {
  const viewed = listedSongForColor(song, playMode, files) ?? song;
  const value =
    facet === "key" ? viewed.key : facet === "scale" ? viewed.scale : viewed.style;
  return value?.trim() || facetValues(song, facet)[0] || "";
}

function groupLibrarySongs(
  songs: Song[],
  libModes: Record<string, PlayMode>,
  fileIndex: Record<string, string[]>
): Array<{ id: string; title: string; songs: Song[] }> {
  const groups: Array<{ key: string; scale: string; songs: Song[] }> = [];
  for (const song of songs) {
    const playMode = libModes[song.id] ?? PlayMode.View;
    const files = fileIndex[song.id];
    const key = songFacet(song, "key", playMode, files);
    const scale = songFacet(song, "scale", playMode, files);
    const existing = groups.find(
      (group) =>
        (key ? sameFacet("key", group.key, key) : !group.key) &&
        (scale ? sameFacet("scale", group.scale, scale) : !group.scale)
    );
    if (existing) existing.songs.push(song);
    else groups.push({ key, scale, songs: [song] });
  }
  groups.sort((left, right) => {
    if (!left.key && right.key) return 1;
    if (left.key && !right.key) return -1;
    const byKey = left.key && right.key ? compareFacet("key", left.key, right.key) : 0;
    if (byKey !== 0) return byKey;
    if (!left.scale && right.scale) return 1;
    if (left.scale && !right.scale) return -1;
    if (left.scale && right.scale) return compareFacet("scale", left.scale, right.scale);
    return 0;
  });
  for (const group of groups) {
    group.songs.sort((left, right) => {
      const leftMode = libModes[left.id] ?? PlayMode.View;
      const rightMode = libModes[right.id] ?? PlayMode.View;
      const leftStyle = songFacet(left, "style", leftMode, fileIndex[left.id]);
      const rightStyle = songFacet(right, "style", rightMode, fileIndex[right.id]);
      const byStyle =
        leftStyle && rightStyle
          ? compareFacet("style", leftStyle, rightStyle)
          : leftStyle
            ? -1
            : rightStyle
              ? 1
              : 0;
      if (byStyle !== 0) return byStyle;
      return songDisplayName(left).localeCompare(songDisplayName(right), "tr");
    });
  }
  return groups.map((group) => ({
    id: `${group.key || "none"}:${group.scale || "none"}`,
    title: [group.key || "—", group.scale || "—"].join(" "),
    songs: group.songs
  }));
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
  const rows = [...list.querySelectorAll<HTMLElement>(".set-block:not(.is-locked):not(.is-final)")];
  if (rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const rect = row.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return rows.length - 1;
}

export function PrepSongList(props: {
  libraryFocusId: string | null;
  onLibraryFocus: (songId: string | null) => void;
  libModes: Record<string, PlayMode>;
}) {
  const songs = useMasterStore((s) => s.songs);
  const query = useMasterStore((s) => s.songQuery);
  const updateGig = useMasterStore((s) => s.updateGig);
  const selectSetlistEntry = useMasterStore((s) => s.selectSetlistEntry);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const gig = useMasterStore(currentGig);
  const [keys, setKeys] = useState<string[]>([]);
  const [scales, setScales] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startY: number;
    active: boolean;
    order: string[];
  } | null>(null);
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    if (!gig) return;
    const first = gig.setlist.find(isSongEntry);
    if (!first) return;
    if (
      selectedEntryId &&
      (gig.setlist.some((entry) => entry.entryId === selectedEntryId) ||
        selectedEntryId.startsWith("elif_key_"))
    ) {
      return;
    }
    selectSetlistEntry(first.entryId);
  }, [gig, selectedEntryId, selectSetlistEntry]);

  const songMap = new Map(songs.map((song) => [song.id, song]));
  const listEntries = gig
    ? visibleSetlistEntries(gig.setlist).filter((entry) => !isLockedElif(entry))
    : [];
  const byId = new Map(listEntries.map((entry) => [entry.entryId, entry] as const));
  const added: SetlistEntry[] = [];
  for (const id of liveOrder ?? idsOf(listEntries)) {
    const entry = byId.get(id);
    if (entry) added.push(entry);
  }
  const displayed = draggingId ? added : withKeyChangeElifs(added, songMap);
  const addedSongIds = new Set(added.filter(isSongEntry).map((entry) => entry.songId));
  const canAddElif = Boolean(gig && canInsertElifAfter(gig.setlist, selectedEntryId));
  const q = query.trim().toLowerCase();
  const unadded = songs.filter((song) => {
    if (addedSongIds.has(song.id)) return false;
    const haystack = `${songDisplayName(song)} ${song.title}`.toLowerCase();
    if (q && !haystack.includes(q)) return false;
    if (!matchesSelected(song, keys, "key")) return false;
    if (!matchesSelected(song, scales, "scale")) return false;
    if (!matchesSelected(song, styles, "style")) return false;
    return true;
  });

  const keyOptions = uniqueFacet(songs, "key");
  const scaleOptions = uniqueFacet(songs, "scale");
  const styleOptions = uniqueFacet(songs, "style");

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

  const selectSetlist = (entryId: string) => {
    props.onLibraryFocus(null);
    selectSetlistEntry(entryId);
  };

  const onPointerDown = (entryId: string, event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const onControl = target.closest("button, select, input");
    if (!target.closest(".prep-cell.actions")) selectSetlist(entryId);
    if (onControl) return;
    if (target.closest(".set-block.is-locked")) return;
    dragRef.current = {
      id: entryId,
      pointerId: event.pointerId,
      startY: event.clientY,
      active: false,
      order: idsOf(added)
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active && Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD) return;
    if (!drag.active) {
      drag.active = true;
      setDraggingId(drag.id);
      setLiveOrder(drag.order.slice());
      selectSetlist(drag.id);
      listRef.current?.setPointerCapture(event.pointerId);
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

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
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

  const addSong = (songId: string) => {
    if (!gig) return;
    const entryId = createId("entry");
    void updateGig((current) => ({
      ...current,
      setlist: insertAfterSelected(current.setlist, selectedEntryId, {
        type: "song",
        entryId,
        songId,
        finishMode: FinishMode.Stop,
        playMode: hasBackingAudio(
          songs.find((item) => item.id === songId),
          fileIndex[songId]
        )
          ? (props.libModes[songId] ?? PlayMode.View)
          : PlayMode.View
      })
    })).then(() => {
      props.onLibraryFocus(null);
      selectSetlistEntry(entryId);
    });
  };

  const addElif = () => {
    if (!gig || !selectedEntryId || !canInsertElifAfter(gig.setlist, selectedEntryId)) return;
    const entryId = createId("entry");
    void updateGig((current) => {
      if (!canInsertElifAfter(current.setlist, selectedEntryId)) return current;
      const index = current.setlist.findIndex((entry) => entry.entryId === selectedEntryId);
      if (index < 0) return current;
      const next = current.setlist.slice();
      next.splice(index + 1, 0, { type: "talk", entryId, label: ELIF_KONUSMA_LABEL });
      return { ...current, setlist: next };
    }).then(() => selectSetlist(entryId));
  };

  let songNumber = 0;

  return (
    <>
      <div className="lib-filters">
        <div className="lib-filter-chips">
          <FilterChips
            facet="key"
            options={keyOptions}
            selected={keys}
            onToggle={(value) => setKeys((current) => toggleFacet(current, value, "key"))}
          />
          <FilterChips
            facet="scale"
            options={scaleOptions}
            selected={scales}
            onToggle={(value) => setScales((current) => toggleFacet(current, value, "scale"))}
          />
          <FilterChips
            facet="style"
            options={styleOptions}
            selected={styles}
            onToggle={(value) => setStyles((current) => toggleFacet(current, value, "style"))}
          />
        </div>
        <button
          type="button"
          className="lib-elif-btn"
          disabled={!canAddElif}
          onClick={addElif}
        >
          {ELIF_KONUSMA_LABEL}
        </button>
      </div>
      <div
        ref={listRef}
        className={`panel-body prep-list${draggingId ? " is-reordering" : ""}`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="prep-cols" aria-hidden="true">
          <span>#</span>
          <span className="title">Song</span>
          <span />
        </div>
        {displayed.map((entry) => {
          const selected =
            !props.libraryFocusId &&
            (draggingId ? draggingId === entry.entryId : selectedEntryId === entry.entryId);
          if (isElifKonusma(entry)) {
            const locked = isLockedElif(entry);
            const elifId = entry.entryId;
            return (
              <div
                key={elifId}
                className={`set-block${selected ? " active" : ""}${
                  draggingId === elifId ? " dragging" : ""
                }${locked ? " is-locked" : ""}`}
                onPointerDown={(event) => onPointerDown(elifId, event)}
              >
                <ElifItem
                  locked={locked}
                  onRemove={
                    locked
                      ? undefined
                      : () => {
                          void updateGig((current) => ({
                            ...current,
                            setlist: current.setlist.filter((item) => item.entryId !== elifId)
                          }));
                        }
                  }
                />
              </div>
            );
          }
          if (!isSongEntry(entry)) return null;
          songNumber += 1;
          const song = songMap.get(entry.songId);
          return (
            <div
              key={entry.entryId}
              className={`set-block${selected ? " active" : ""}${draggingId === entry.entryId ? " dragging" : ""}`}
              onPointerDown={(event) => onPointerDown(entry.entryId, event)}
            >
              <SongItem
                added
                order={songNumber}
                song={song}
                files={song ? fileIndex[song.id] : undefined}
                entry={entry}
                selected={selected}
                onRemove={() => {
                  void updateGig((current) => ({
                    ...current,
                    setlist: trimElifAfterLastSong(
                      current.setlist.filter((item) => item.entryId !== entry.entryId)
                    )
                  }));
                }}
              />
            </div>
          );
        })}
        {setlistHasSongs(added) ? <ConcertFinalBlock variant="prep" /> : null}
        {groupLibrarySongs(unadded, props.libModes, fileIndex).map((group) => (
          <div key={group.id} className="prep-lib-group">
            <div className="prep-lib-group-title">{group.title}</div>
            {group.songs.map((song) => (
              <div
                key={song.id}
                className={`prep-lib-wrap${props.libraryFocusId === song.id ? " active" : ""}`}
                onClick={() => props.onLibraryFocus(song.id)}
              >
                <SongItem
                  added={false}
                  order={null}
                  song={song}
                  files={fileIndex[song.id]}
                  selected={props.libraryFocusId === song.id}
                  playMode={props.libModes[song.id] ?? PlayMode.View}
                  onAdd={() => addSong(song.id)}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function FilterChips(props: {
  facet: SongFacet;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <>
      {props.options.map((value) => {
        const on = props.selected.some((item) => sameFacet(props.facet, item, value));
        return (
          <button
            key={`${props.facet}-${value}`}
            type="button"
            className={`lib-filter-btn${on ? " on" : ""}`}
            style={facetChipStyle(props.facet, value, on)}
            aria-pressed={on}
            onClick={() => props.onToggle(value)}
          >
            {value}
          </button>
        );
      })}
    </>
  );
}

function ElifItem(props: { locked?: boolean; onRemove?: () => void }) {
  return (
    <div className={`prep-elif-row${props.locked ? " is-locked" : ""}`}>
      <div className="prep-cell num">{props.locked ? <LockIcon /> : "—"}</div>
      <div className="prep-elif-title">
        <ElifLabel />
        {props.locked ? <ElifNote /> : null}
      </div>
      <div className="prep-cell actions">
        {props.onRemove ? (
          <button
            type="button"
            className="icon-btn"
            title="Delete"
            aria-label="Delete"
            onClick={props.onRemove}
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SongItem(props: {
  added: boolean;
  order: number | null;
  song: Song | undefined;
  files?: string[];
  entry?: SongSetlistEntry;
  selected: boolean;
  playMode?: PlayMode;
  onAdd?: () => void;
  onRemove?: () => void;
}) {
  const song = props.song;
  const canBacking = hasBackingAudio(song, props.files);
  const requestedMode =
    props.playMode ??
    (props.entry?.playMode === PlayMode.Playback ? PlayMode.Playback : PlayMode.View);
  const playMode = canBacking ? requestedMode : PlayMode.View;
  const tint = props.added ? songRowStyle(listedSongForColor(song, requestedMode, props.files), props.selected) : undefined;
  const playback = playMode === PlayMode.Playback;

  return (
    <div className={`prep-song-row${props.added ? " added" : " library"}`} style={tint}>
      <div className="prep-cell num">{props.order ? String(props.order).padStart(2, "0") : "—"}</div>
      <div className="prep-cell title">
        {song ? (
          <span className="prep-song-mode" aria-hidden="true">
            {playback ? (
              hasOnlyClickAudio(song, props.files) ? <EighthNoteIcon /> : <NotationIcon />
            ) : (
              <ViewIcon />
            )}
          </span>
        ) : null}
        <span className="prep-song-name">
          {song ? (playback ? songPlaybackName(song) : songDisplayName(song)) : "—"}
        </span>
      </div>
      <div className="prep-cell actions">
        {props.added ? (
          <button
            type="button"
            className="icon-btn"
            title="Delete"
            aria-label="Delete"
            onClick={props.onRemove}
          >
            ×
          </button>
        ) : (
          <button
            type="button"
            className="add"
            title="Add"
            aria-label="Add"
            onClick={(event) => {
              event.stopPropagation();
              props.onAdd?.();
            }}
          >
            <AddIcon />
          </button>
        )}
      </div>
    </div>
  );
}
