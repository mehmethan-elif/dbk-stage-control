import { DirectPassMark } from "./DirectPassMark";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { parseSongInfo, withKeyChangeElifs } from "@dbk/core";
import {
  currentGig,
  followsFreeMasterClicks,
  nextUnskippedSongEntryId,
  setlistLocked,
  songPlaying,
  useMasterStore,
  usesFreeMetroTransport
} from "../../store/master-store";
import { PlayModeMark } from "./play-mode-mark";
import { nextTransportSongEntry } from "./next-song-section";
import { type StageNotesPage } from "./stage-page-notes";
import { freePageMetroTone, MetroPulse } from "./song-metro-beats";
import { scrollStageToNode } from "./stage-scroll";

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
  const selectSetlistEntry = useMasterStore((s) => s.selectSetlistEntry);
  const frozen = useMasterStore(setlistLocked);
  const freeMode = useMasterStore(usesFreeMetroTransport);
  const followSound = useMasterStore(followsFreeMasterClicks);
  const selectedEntryId = useMasterStore((s) =>
    usesFreeMetroTransport(s) ? s.selectedEntryId : null
  );
  const nextSongEntryId = useMasterStore((s) => {
    if (!usesFreeMetroTransport(s)) return null;
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

  /**
   * The name doubles as the way back to the top of its own song: tap it and the song heads the
   * page, and the setlist follows. Mid-number the setlist is held, and selecting there would take
   * the show off what is sounding, so then the tap only scrolls.
   */
  const openSong = (event: MouseEvent<HTMLButtonElement>) => {
    const title = event.currentTarget.closest(".lyrics-song-title");
    if (title instanceof HTMLElement) {
      scrollStageToNode(title.closest(".lyrics-stage"), title.parentElement?.querySelector<HTMLElement>(".direct-pass-mark") ?? title);
    }
    if (!props.entryId || frozen) return;
    void selectSetlistEntry(props.entryId);
  };

  return (
    <div className="lyrics-song-head">
      <DirectPassMark song={song} />
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
        <button type="button" className="stage-song-title-btn" onClick={openSong}>
          {props.children}
        </button>
      </h3>
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
