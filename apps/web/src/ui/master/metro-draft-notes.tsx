import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isRealMetronomeTrack, parseSongInfo, type Song } from "@dbk/core";
import { useMasterStore } from "../../store/master-store";

export function MetroDraftNotes(props: {
  song: Song | undefined;
  files?: string[];
  page: "lyrics" | "drums";
  label: string;
  emptyLabel: string;
}) {
  const readOnly = useMasterStore((s) => s.deviceKind === "client");
  const saveSongInfo = useMasterStore((s) => s.saveSongInfo);
  const stored = parseSongInfo(props.song?.info).metroNotes?.[props.page] ?? "";
  const [text, setText] = useState(stored);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const songId = props.song?.id;
  const song = props.song;
  const page = props.page;
  const textRef = useRef(text);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  textRef.current = text;

  const fitField = () => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    if (!dirty.current) setText(stored);
    setError(null);
  }, [songId, page, stored]);

  useLayoutEffect(() => {
    fitField();
  }, [text, stored]);

  useEffect(() => {
    const parent = fieldRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => fitField());
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (!songId || readOnly || !dirty.current || !song) return;
      dirty.current = false;
      const info = parseSongInfo(song.info);
      const nextNotes = { ...info.metroNotes, [page]: textRef.current.trim() || undefined };
      const metroNotes =
        nextNotes.lyrics || nextNotes.drums
          ? {
              ...(nextNotes.lyrics ? { lyrics: nextNotes.lyrics } : {}),
              ...(nextNotes.drums ? { drums: nextNotes.drums } : {})
            }
          : undefined;
      void saveSongInfo(songId, { ...info, metroNotes });
    };
  }, [songId, page, readOnly, song, saveSongInfo]);

  if (!isRealMetronomeTrack(props.song, props.files)) return null;

  const persist = () => {
    if (!songId || readOnly || !dirty.current || !song) return;
    dirty.current = false;
    const info = parseSongInfo(song.info);
    const nextNotes = { ...info.metroNotes, [page]: text.trim() || undefined };
    const metroNotes =
      nextNotes.lyrics || nextNotes.drums
        ? {
            ...(nextNotes.lyrics ? { lyrics: nextNotes.lyrics } : {}),
            ...(nextNotes.drums ? { drums: nextNotes.drums } : {})
          }
        : undefined;
    void saveSongInfo(songId, { ...info, metroNotes }).catch((err: unknown) => {
      dirty.current = true;
      setError(err instanceof Error ? err.message : "Could not save notes.");
    });
  };

  if (readOnly) {
    return stored.trim() ? (
      <pre className="metro-draft-notes is-read">{stored}</pre>
    ) : (
      <div className="lyrics-empty meta">{props.emptyLabel}</div>
    );
  }

  return (
    <div className="metro-draft-notes">
      <textarea
        ref={fieldRef}
        className="metro-draft-field"
        rows={1}
        aria-label={props.label}
        placeholder={props.label}
        value={text}
        onChange={(event) => {
          dirty.current = true;
          setText(event.target.value);
          const el = event.currentTarget;
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }}
        onBlur={persist}
      />
      {error ? <p className="stage-song-note-error">{error}</p> : null}
    </div>
  );
}
