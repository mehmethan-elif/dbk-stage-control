import { useEffect, useRef, useState, type ReactNode } from "react";
import { parseSongInfo, withKeyChangeElifs } from "@dbk/core";
import {
  currentGig,
  followsFreeMasterClicks,
  nextUnskippedSongEntryId,
  panicBlocksFollow,
  showsTitlePositionSlider,
  songPlaying,
  songShowsPositionSlider,
  useMasterStore,
  usesFreeMetroTransport
} from "../../store/master-store";
import { PlayModeMark } from "./play-mode-mark";
import { nextTransportSongEntry } from "./next-song-section";
import { type StageNotesPage } from "./stage-page-notes";
import { freePageMetroTone, MetroPulse } from "./song-metro-beats";
import { SongPositionTrack } from "./SongPositionTrack";

const PAGE_LABELS: Record<StageNotesPage, string> = {
  lyrics: "Lyrics",
  score: "Score",
  chord: "Chord",
  drums: "Drums"
};

export function StageSongHead(props: {
  songId: string | undefined;
  entryId?: string;
  page: StageNotesPage;
  children: ReactNode;
}) {
  const readOnly = useMasterStore((s) => s.deviceKind === "client");
  const freeMode = useMasterStore(usesFreeMetroTransport);
  const followSound = useMasterStore(followsFreeMasterClicks);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const nextSongEntryId = useMasterStore((s) => {
    const gig = currentGig(s);
    const displayed = gig ? withKeyChangeElifs(gig.setlist, s.songs) : [];
    return (
      nextTransportSongEntry(displayed, s.selectedEntryId ?? undefined)?.entryId ??
      nextUnskippedSongEntryId(gig, s.selectedEntryId)
    );
  });
  const playing = useMasterStore(songPlaying);
  const metronomePlaying = useMasterStore((s) => s.metronomePlaying);
  const song = useMasterStore((s) => s.songs.find((item) => item.id === props.songId));
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const gigMode = useMasterStore((s) => currentGig(s)?.performanceMode);
  const files = song
    ? [...(fileIndex[song.id] ?? []), ...(song.folder ? (fileIndex[song.folder] ?? []) : [])]
    : undefined;
  const metroTone = freePageMetroTone(props.entryId, selectedEntryId, nextSongEntryId);
  const showTransport = Boolean(metroTone);
  const localTitleSlider = useMasterStore(showsTitlePositionSlider);
  const panicOn = useMasterStore(panicBlocksFollow);
  const selected = Boolean(props.entryId && props.entryId === selectedEntryId);
  const showTitleSlider = Boolean(
    localTitleSlider &&
      selected &&
      !panicOn &&
      songShowsPositionSlider(song, files, gigMode)
  );
  const saveSongInfo = useMasterStore((s) => s.saveSongInfo);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const songId = props.songId;
  const storedNotes = parseSongInfo(song?.info).pageNotes?.[props.page] ?? "";
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    dirty.current = false;
    if (!songId) {
      setNotes("");
      return;
    }
    if (!dirty.current) setNotes(storedNotes);
    setError(null);
  }, [songId, props.page, storedNotes]);

  const persist = (text: string) => {
    if (!songId || readOnly || !dirty.current) return;
    setError(null);
    dirty.current = false;
    if (!song) return;
    const info = parseSongInfo(song.info);
    void saveSongInfo(songId, {
      ...info,
      pageNotes: { ...info.pageNotes, [props.page]: text }
    }).catch((err: unknown) => {
      dirty.current = true;
      setError(err instanceof Error ? err.message : "Could not save notes.");
    });
  };

  useEffect(() => {
    return () => {
      persist(notesRef.current);
    };
  }, [songId, props.page, readOnly]);

  return (
    <div className="lyrics-song-head">
      <h3 className="lyrics-song-title">
        {showTransport ? (
          <span className="lyrics-song-click">
            <MetroPulse
              song={song}
              active={Boolean(song)}
              follow={
                metroTone === "current" && (metronomePlaying || (freeMode && followSound))
                  ? "sound"
                  : metroTone === "current" && playing && !metronomePlaying
                    ? "playback"
                    : undefined
              }
              tone={metroTone}
            />
          </span>
        ) : null}
        {showTransport && song ? (
          <PlayModeMark
            song={song}
            files={files}
            setlistMode={gigMode}
            inheritColor
            className="lyrics-song-mode"
          />
        ) : null}
        {props.children}
      </h3>
      {showTitleSlider ? <SongPositionTrack song={song} className="stage-title-track" /> : null}
      {songId ? (
        <>
          {readOnly ? (
            notes.trim() ? <p className="stage-song-notes">{notes}</p> : null
          ) : (
            <input
              type="text"
              className={notes.trim() ? "stage-song-note-field has-note" : "stage-song-note-field"}
              aria-label={`${PAGE_LABELS[props.page]} notes`}
              value={notes}
              placeholder=""
              onChange={(event) => {
                dirty.current = true;
                setNotes(event.target.value.replace(/\s*\n+\s*/g, " "));
              }}
              onBlur={() => persist(notes)}
            />
          )}
          {error ? <p className="stage-song-note-error">{error}</p> : null}
        </>
      ) : null}
    </div>
  );
}
