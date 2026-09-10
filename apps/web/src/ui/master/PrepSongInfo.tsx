import { useEffect, useRef, useState } from "react";
import {
  ELIF_KONUSMA_LABEL,
  firstSectionNamed,
  hasBackingAudio,
  hasClickFlac,
  isElifKonusma,
  isSongEntry,
  parseSongInfo,
  PlayMode,
  songDisplayName,
  songPlaybackName,
  type Song
} from "@dbk/core";
import { currentGig, useMasterStore } from "../../store/master-store";
import { hasPackedSong } from "./song-settings";
import { SongInfoEditor } from "./SongInfoEditor";

function countEnabled(song: Song | undefined): boolean {
  return firstSectionNamed(song?.sections, "COUNT") && (song?.sections.length ?? 0) >= 2;
}

function countIsOn(song: Song | undefined, startAt: number): boolean {
  const second = song?.sections[1];
  if (!second) return true;
  return startAt < second.start - 0.02;
}

function countStartTime(song: Song | undefined, on: boolean): number {
  if (on) return 0;
  return song?.sections[1]?.start ?? 0;
}

function extraValues(songs: Song[], pick: (song: Song) => Array<string | undefined>): string[] {
  const values: string[] = [];
  for (const song of songs) {
    for (const raw of pick(song)) {
      const text = raw?.trim();
      if (!text || values.includes(text)) continue;
      values.push(text);
    }
  }
  return values;
}

export function PrepSongInfo(props: {
  libraryFocusId: string | null;
}) {
  const songs = useMasterStore((s) => s.songs);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const gig = useMasterStore(currentGig);
  const updateGig = useMasterStore((s) => s.updateGig);
  const seek = useMasterStore((s) => s.seek);
  const saveSongInfo = useMasterStore((s) => s.saveSongInfo);
  const readOnly = useMasterStore((s) => s.deviceKind === "client");

  const selected = selectedEntryId
    ? gig?.setlist.find((entry) => entry.entryId === selectedEntryId)
    : undefined;
  const librarySong = props.libraryFocusId
    ? songs.find((song) => song.id === props.libraryFocusId)
    : undefined;
  const setlistSong =
    selected && isSongEntry(selected) ? songs.find((song) => song.id === selected.songId) : undefined;
  const song = librarySong ?? setlistSong;
  const info = parseSongInfo(song?.info);
  const files = song ? fileIndex[song.id] : undefined;
  const packedSong = hasPackedSong(song, files);
  const canBacking = hasBackingAudio(song, files);
  const canClick = Boolean(song && hasClickFlac(song, files));
  const requestedMode = info.playMode ?? PlayMode.View;
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
  const metronome = playMode === PlayMode.View;
  const startsSerbest = firstSectionNamed(song?.sections, "SERBEST");
  const metronomeStartMode = song?.info?.startMode === "SERBEST" ? "SERBEST" : "COUNT";
  const countOn = countIsOn(song, info.startAt ?? 0);
  const canCount = Boolean(countEnabled(song));
  const scales = extraValues(songs, (item) => [item.scale, item.info?.scale]);
  const styles = extraValues(songs, (item) => [item.style, item.info?.style]);
  const elifSelected = Boolean(
    !librarySong &&
      ((selected && isElifKonusma(selected)) || selectedEntryId?.startsWith("elif_key_"))
  );
  const [elifNotes, setElifNotes] = useState(gig?.notes ?? "");
  const elifNotesDirty = useRef(false);

  useEffect(() => {
    elifNotesDirty.current = false;
    setElifNotes(gig?.notes ?? "");
  }, [gig?.id]);

  useEffect(() => {
    if (elifNotesDirty.current) return;
    setElifNotes(gig?.notes ?? "");
  }, [gig?.notes]);

  const persistElifNotes = async () => {
    if (readOnly || !gig || !elifNotesDirty.current) return;
    const next = elifNotes;
    elifNotesDirty.current = false;
    await updateGig((current) => ({
      ...current,
      notes: next.trim() ? next : undefined
    }));
  };

  const setPlayMode = (mode: PlayMode) => {
    if (mode === PlayMode.Playback && !canBacking) return;
    if (mode === PlayMode.ClickOnly && !canClick) return;
    if (!song) return;
    void saveSongInfo(song.id, { ...info, playMode: mode });
  };

  const setCount = (on: boolean) => {
    if (!song) return;
    const time = countStartTime(song, on);
    void saveSongInfo(song.id, { ...info, startAt: time });
    if (!metronome) seek(time);
  };

  const setMetronomeStartMode = (startMode: "COUNT" | "SERBEST") => {
    if (!song || readOnly) return;
    void saveSongInfo(song.id, { ...parseSongInfo(song.info), startMode });
  };

  const songName = song
    ? playMode !== PlayMode.View
      ? songPlaybackName(song)
      : songDisplayName(song)
    : "";

  const title = elifSelected ? ELIF_KONUSMA_LABEL : songName;

  return (
    <section className={`panel prep-side-panel${!song && !elifSelected ? " is-empty" : ""}`}>
      <div className="panel-head">
        <h2>
          <span className="prep-active-setlist">{title}</span>
        </h2>
      </div>
      <div className="panel-body prep-song-info-body">
        {elifSelected ? (
          readOnly ? (
            elifNotes.trim() ? (
              <p className="prep-elif-notes-read">{elifNotes}</p>
            ) : (
              <p className="meta">No notes</p>
            )
          ) : (
            <div className="prep-elif-notes">
              <textarea
                aria-label="ELIF KONUSMA notes"
                placeholder="Notes for ELIF KONUSMA…"
                value={elifNotes}
                onChange={(event) => {
                  elifNotesDirty.current = true;
                  setElifNotes(event.target.value);
                }}
                onBlur={() => {
                  void persistElifNotes();
                }}
              />
            </div>
          )
        ) : !song ? (
          <p className="meta">Select a song to edit its info.</p>
        ) : (
          <>
            <div className="song-info-toolbar">
              <div className="song-info-line song-info-play-mode">
                <span>Play Mode</span>
                <div className="song-info-modes play-mode-options" role="radiogroup" aria-label="Play Mode">
                  <button
                    type="button"
                    role="radio"
                    aria-label="Metronome"
                    aria-checked={playMode === PlayMode.View}
                    className={playMode === PlayMode.View ? "on" : ""}
                    disabled={readOnly}
                    onClick={() => setPlayMode(PlayMode.View)}
                  >
                    METRONOME
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-label="Backing Tracks"
                    aria-checked={playMode === PlayMode.Playback}
                    className={playMode === PlayMode.Playback ? "on" : ""}
                    disabled={readOnly || !canBacking}
                    onClick={() => setPlayMode(PlayMode.Playback)}
                  >
                    BACKING
                    <br />
                    TRACKS
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-label="Click Only"
                    aria-checked={playMode === PlayMode.ClickOnly}
                    className={playMode === PlayMode.ClickOnly ? "on" : ""}
                    disabled={readOnly || !canClick}
                    onClick={() => setPlayMode(PlayMode.ClickOnly)}
                  >
                    CLICK
                    <br />
                    ONLY
                  </button>
                </div>
              </div>
            </div>
            <div className="song-info-line song-info-start">
              <span>START</span>
              {metronome ? (
                <div className="song-info-modes" role="radiogroup" aria-label="Metronome start">
                  {(["COUNT", "SERBEST"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={metronomeStartMode === mode}
                      className={metronomeStartMode === mode ? "on" : ""}
                      disabled={readOnly}
                      onClick={() => setMetronomeStartMode(mode)}
                    >
                      {mode === "COUNT" ? "COUNT IN" : mode}
                    </button>
                  ))}
                </div>
              ) : canCount ? (
                <button
                  type="button"
                  className={`prep-count${countOn ? " on" : ""}`}
                  aria-pressed={countOn}
                  aria-label="Count In"
                  title={countOn ? "Start from the beginning" : "Start from the second section"}
                  disabled={readOnly}
                  onClick={() => setCount(!countOn)}
                >
                  COUNT IN
                </button>
              ) : startsSerbest ? (
                <span className="song-info-value">SERBEST</span>
              ) : null}
            </div>
            <SongInfoEditor
              key={`${gig?.id ?? "none"}-${song.id}-${packedSong ? "packed" : "edit"}`}
              song={song}
              scales={scales}
              styles={styles}
              readOnly={readOnly || packedSong}
              playbackValues={packedSong}
            />
          </>
        )}
      </div>
    </section>
  );
}
