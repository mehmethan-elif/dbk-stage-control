import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMasterStore } from "../../store/master-store";
import {
  loadStageNotes,
  saveStageNotes,
  type StageNotesPage
} from "./stage-page-notes";

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
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const songId = props.songId;
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    dirty.current = false;
    if (!songId) {
      setNotes("");
      return;
    }
    let cancelled = false;
    void loadStageNotes(songId, props.page).then((text) => {
      if (cancelled || dirty.current) return;
      setNotes(text);
      setError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [songId, props.page]);

  const persist = (text: string) => {
    if (!songId || readOnly || !dirty.current) return;
    setError(null);
    void saveStageNotes(songId, props.page, text)
      .then(() => {
        dirty.current = false;
      })
      .catch((err: unknown) => {
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
            <p className={`stage-song-notes${notes.trim() ? "" : " meta"}`}>
              {notes.trim() ? notes : "No notes"}
            </p>
          ) : (
            <input
              type="text"
              className="stage-song-note-field"
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
