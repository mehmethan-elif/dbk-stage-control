import { useEffect, useRef, useState, type ReactNode } from "react";
import { parseSongInfo } from "@dbk/core";
import { useMasterStore } from "../../store/master-store";
import { type StageNotesPage } from "./stage-page-notes";

const PAGE_LABELS: Record<StageNotesPage, string> = {
  lyrics: "Lyrics",
  score: "Score",
  chord: "Chord",
  drums: "Drums"
};

export function StageSongHead(props: {
  songId: string | undefined;
  page: StageNotesPage;
  children: ReactNode;
}) {
  const readOnly = useMasterStore((s) => s.deviceKind === "client");
  const song = useMasterStore((s) => s.songs.find((item) => item.id === props.songId));
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
    })
      .catch((err: unknown) => {
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
      <h3 className="lyrics-song-title">{props.children}</h3>
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
