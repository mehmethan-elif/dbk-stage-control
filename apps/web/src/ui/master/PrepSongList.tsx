import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  canInsertElifAfter,
  createId,
  insertElifAfterSelected,
  elifPlacementValid,
  hasBackingAudio,
  hasClickFlac,
  isElifKonusma,
  isLockedElif,
  isSongEntry,
  parseSongInfo,
  PlayMode,
  insertAfterSelected,
  keepSkippedSongsInPlace,
  songDisplayName,
  songPlaybackName,
  trimElifAfterLastSong,
  visibleSetlistEntries,
  withKeyChangeElifs,
  type SetlistEntry,
  type Song,
  type SongSetlistEntry
} from "@dbk/core";
import { currentGig, selectAddedSetlistEntry, setlistLocked, useMasterStore } from "../../store/master-store";
import {
  isSongLibraryGig,
  songLibraryEntryId
} from "../../store/song-library";
import { AddIcon, LockIcon } from "../shared/icons";
import { PlayModeMark } from "./play-mode-mark";
import {
  compareFacet,
  facetChipStyle,
  listedSongForColor,
  sameFacet,
  songRowStyle,
  type SongFacet
} from "../shared/key-color";
import { groupLibrarySongs } from "./library-groups";
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
      ".set-block:not(.is-locked):not(.is-final):not(.is-elif-add)"
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

export function PrepSongList(props: {
  libraryFocusId: string | null;
  onLibraryFocus: (songId: string | null) => void;
  onCreateSetlist: (songId: string) => void;
}) {
  const songs = useMasterStore((s) => s.songs);
  const updateGig = useMasterStore((s) => s.updateGig);
  const selectSetlistEntry = useMasterStore((s) => s.selectSetlistEntry);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const gig = useMasterStore(currentGig);
  const frozen = useMasterStore(setlistLocked);
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
  const songLibrary = isSongLibraryGig(gig);
  const playModes: Record<string, PlayMode> = {};
  for (const song of songs) {
    playModes[song.id] = parseSongInfo(song.info).playMode ?? PlayMode.View;
  }

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
  }, [gig?.id, gig?.setlist, selectedEntryId, selectSetlistEntry]);

  const songMap = new Map(songs.map((song) => [song.id, song]));
  const listEntries = gig && !songLibrary
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
  const canAddElif = Boolean(
    gig && !songLibrary && canInsertElifAfter(gig.setlist, selectedEntryId)
  );
  const unadded = songs.filter((song) => {
    if (addedSongIds.has(song.id)) return false;
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

  const selectSetlist = (entryId: string) => {
    props.onLibraryFocus(null);
    selectSetlistEntry(entryId);
  };

  const onPointerDown = (entryId: string, event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const onControl = target.closest("button, select, input");
    if (frozen) return;
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
        songId
      })
    })).then(() => {
      props.onLibraryFocus(null);
      selectAddedSetlistEntry(entryId);
    });
  };

  const addElif = () => {
    if (!gig || !selectedEntryId || !canInsertElifAfter(gig.setlist, selectedEntryId)) return;
    const entryId = createId("entry");
    void updateGig((current) => {
      const setlist = insertElifAfterSelected(current.setlist, selectedEntryId, entryId);
      if (setlist === current.setlist) return current;
      return { ...current, setlist };
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
                }${locked ? " is-locked" : ""}${frozen ? " is-frozen" : ""}`}
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
              className={`set-block${selected ? " active" : ""}${
                draggingId === entry.entryId ? " dragging" : ""
              }${frozen ? " is-frozen" : ""}`}
              onPointerDown={(event) => onPointerDown(entry.entryId, event)}
            >
              <SongItem
                added
                order={songNumber}
                song={song}
                files={song ? fileIndex[song.id] : undefined}
                entry={entry}
                selected={selected}
                playMode={song ? (playModes[song.id] ?? PlayMode.View) : PlayMode.View}
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
        {!songLibrary ? (
          <div className="set-block is-elif-add">
            <div className="prep-elif-row prep-elif-add-item">
              <div className="prep-cell num">—</div>
              <div className="prep-cell title">
                <span className="elif-label">ELIF KONUSMA EKLE</span>
              </div>
              <div className="prep-cell actions">
                <button
                  type="button"
                  className="add"
                  title="Add"
                  aria-label="Add ELIF KONUSMA"
                  disabled={!canAddElif}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (canAddElif) addElif();
                  }}
                >
                  <AddIcon />
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {groupLibrarySongs(unadded, playModes, fileIndex).map((group) => (
          <div key={group.id} className="prep-lib-group">
            <div className="prep-lib-group-title">{group.title}</div>
            {group.songs.map((song) => {
              const librarySelected =
                songLibrary && selectedEntryId === songLibraryEntryId(song.id);
              const selected = librarySelected || props.libraryFocusId === song.id;
              return (
                <div
                  key={song.id}
                  className={`prep-lib-wrap${selected ? " active" : ""}`}
                  onClick={() => {
                    if (songLibrary && frozen) return;
                    props.onLibraryFocus(song.id);
                    if (songLibrary) selectSetlistEntry(songLibraryEntryId(song.id));
                  }}
                >
                  <SongItem
                    added={false}
                    order={null}
                    song={song}
                    files={fileIndex[song.id]}
                    selected={selected}
                    playMode={playModes[song.id] ?? PlayMode.View}
                    onAdd={() =>
                      songLibrary ? props.onCreateSetlist(song.id) : addSong(song.id)
                    }
                  />
                </div>
              );
            })}
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
      <div className="prep-cell title">
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
  const gigMode = useMasterStore((s) => currentGig(s)?.performanceMode);
  const canBacking = hasBackingAudio(song, props.files);
  const canClick = Boolean(song && hasClickFlac(song, props.files));
  const requestedMode =
    props.playMode ??
    (props.entry?.playMode === PlayMode.Playback
      ? PlayMode.Playback
      : props.entry?.playMode === PlayMode.ClickOnly
        ? PlayMode.ClickOnly
        : PlayMode.View);
  const playMode =
    requestedMode === PlayMode.Playback
      ? canBacking
        ? requestedMode
        : canClick
          ? PlayMode.ClickOnly
          : PlayMode.View
      : requestedMode === PlayMode.ClickOnly && !canClick
        ? PlayMode.View
        : requestedMode;
  const tint = songRowStyle(
    listedSongForColor(song, playMode, props.files),
    props.selected
  );

  return (
    <div className={`prep-song-row${props.added ? " added" : " library"}`} style={tint}>
      <div className="prep-cell num">
        <span>{props.order ? String(props.order).padStart(2, "0") : "—"}</span>
        {song ? <PlayModeMark song={song} files={props.files} setlistMode={gigMode} /> : null}
      </div>
      <div className="prep-cell title">
        <span className="prep-song-name">
          {song
            ? playMode !== PlayMode.View
              ? songPlaybackName(song)
              : songDisplayName(song)
            : "—"}
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
