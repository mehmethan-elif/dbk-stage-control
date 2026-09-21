import { DirectPassMark } from "./DirectPassMark";
import { useLayoutEffect, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";
import {
  canInsertElifAfter,
  createId,
  insertElifAfterSelected,
  isLockedElif,
  isStopMarker,
  isTalkEntry,
  isSongEntry,
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
  currentGig,
  followsSharedPlayhead,
  pageEntryId,
  playingMarkEntryId,
  selectAddedSetlistEntry,
  setlistLocked,
  stageConnectOn,
  useMasterStore
} from "../../store/master-store";
import { PlayModeMark } from "./play-mode-mark";
import { findSongByRef, SONG_LIBRARY_GIG_ID } from "../../store/song-library";
import { practiceEntryId } from "../../practice/gig";
import { listedSongForColor, songRowStyle } from "../shared/key-color";
import { AddIcon } from "../shared/icons";
import { ConcertFinalBlock, ElifNote, StopLabel, StopNote, TalkLabel, TalkLeadIcon, setlistHasSongs } from "./setlist-marker";
import { groupLibrarySongs } from "./library-groups";
import { scrollStageToSongTitle } from "./stage-scroll";

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

export function StageSetlist(props: {
  entries: SetlistEntry[];
  library: Song[];
  songs: Song[];
  selectedEntryId: string | null;
  readOnly?: boolean;
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
  const readOnly = Boolean(props.readOnly || songLibrary);
  // Offered on every page the setlist appears on, the same as the preparation list. It used to
  // wait for the stage to be connected, which hid it from the desk right up until show time.
  const showAddElif = Boolean(!songLibrary && !readOnly);
  const canAddElif = Boolean(
    showAddElif && !frozen && gig && canInsertElifAfter(gig.setlist, props.selectedEntryId)
  );
  const lockRows = frozen && (!readOnly || practice);
  const songPlaying =
    metronomePlaying ||
    playback.state === PlaybackState.Playing ||
    playback.state === PlaybackState.Transitioning;
  // Where this device is looking, which is the show's row unless something is being read out of
  // the library. That marks the row being read without moving the red mark off the show.
  const pageEntry = useMasterStore(pageEntryId);
  const playingEntryId = useMasterStore(playingMarkEntryId) ?? undefined;
  const listRef = useRef<HTMLElement>(null);

  // Each top-row page (Nota, Chords, Drums, Lyrics, ...) renders its own StageSetlist, so
  // switching pages unmounts and remounts this list — this always fires on that first render.
  // It also re-fires whenever the selection changes, such as tapping a song title on the page
  // itself (StageSongHead's openSong), so the sidebar follows without jumping when it's already
  // in view: scrollIntoView("nearest") only moves the list when the row is actually offscreen.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(".lyrics-set-block.on, .lyrics-set-item.on");
    active?.scrollIntoView({ block: "nearest" });
  }, [props.selectedEntryId]);

  // Annotated because dropping the locked ELIF KONUSMA rows leaves the spoken ones, and an
  // inferred predicate reads the filter as keeping songs only.
  const movable: SetlistEntry[] = props.entries.filter((entry) => !isLockedElif(entry));
  const displayed = withKeyChangeElifs(movable, props.songs);
  const entryBySongId = new Map(
    movable.filter(isSongEntry).map((entry) => [entry.songId, entry] as const)
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
    selectEntry(entryId);
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
    const on = entry.entryId === props.selectedEntryId;
    songNumber += 1;
    return (
      <div
        key={entry.entryId}
        className={`lyrics-set-block${on ? " on" : ""}${lockRows ? " is-frozen" : ""}`}
        onPointerDown={(event) => onPointerDown(entry.entryId, event)}
      >
        {!songLibrary && songNumber > 1 ? <DirectPassMark song={item} setlist /> : null}
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
      className={`lyrics-setlist${readOnly ? " is-readonly" : ""}`}
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
        const on = entry.entryId === props.selectedEntryId;
        if (isTalkEntry(entry)) {
          const locked = isLockedElif(entry);
          return (
            <div
              key={entry.entryId}
              className={`lyrics-set-block${on ? " on" : ""}${locked ? " is-locked" : ""}${lockRows ? " is-frozen" : ""}`}
              onPointerDown={(event) => onPointerDown(entry.entryId, event)}
            >
              <div
                className={`lyrics-elif-item${on ? " on" : ""}${locked ? " is-locked" : ""}${
                  playingEntryId === entry.entryId ? " is-playing" : ""
                }`}
              >
                <TalkLeadIcon locked={locked} stop={isStopMarker(entry)} />
                <span className="elif-copy">
                  <TalkLabel entry={entry} />
                  {locked ? <ElifNote /> : null}
                </span>
                {isStopMarker(entry) ? <StopNote notes={entry.notes} /> : null}
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
      {!songLibrary && setlistHasSongs(movable) ? <ConcertFinalBlock variant="lyrics" /> : null}
      {showAddElif ? (
        <div className="lyrics-set-block is-elif-add">
          <div className="lyrics-elif-item lyrics-elif-add-item">
            <TalkLeadIcon stop />
            <span className="elif-copy">
              <StopLabel />
            </span>
            <button
              type="button"
              className="lyrics-skip"
              title="Add"
              aria-label="Add STOP"
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
                  selected={pageEntry === practiceEntryId(item.id)}
                  onName={props.onSelectLibrary && !lockRows ? pickLibrary : undefined}
                  onAdd={readOnly ? undefined : () => props.onAdd(item.id)}
                />
              </div>
            );
          })}
        </div>
      ))}
      {props.entries.length === 0 && props.library.length === 0 ? (
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
