import { useEffect, useRef, useState } from "react";
import { entryPlayMode, isSongEntry, songDisplayName } from "@dbk/core";
import { libraryApi } from "../../../library/api";
import { currentGig, useMasterStore } from "../../../store/master-store";
import { findSongByRef } from "../../../store/song-library";
import { listedSongForColor } from "../../shared/key-color";
import { PrinterIcon } from "../../shared/icons";
import { loadNotaLayout } from "../nota-sections";
import { buildSongPdf } from "./build-pdf";
import { exportPdfFileName, PDF_EXPORT_LABELS, PDF_EXPORT_TARGETS, type PdfExportTarget } from "./pdf-names";

function notaFile(files: string[] | undefined): string | undefined {
  return files?.find((name) => /(^|\/)nota\.pdf$/i.test(name));
}

export function PdfExportButton() {
  const songs = useMasterStore((s) => s.songs);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const gig = useMasterStore(currentGig);
  const entry = selectedEntryId
    ? gig?.setlist.find((item) => item.entryId === selectedEntryId)
    : undefined;
  const song = entry && isSongEntry(entry) ? findSongByRef(songs, entry.songId) : undefined;
  const files = song
    ? [
        ...(fileIndex[song.id] ?? []),
        ...(song.folder && song.folder !== song.id ? (fileIndex[song.folder] ?? []) : [])
      ]
    : [];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<PdfExportTarget, boolean>>({
    lyrics: true,
    chords: true,
    drums: true
  });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = PDF_EXPORT_TARGETS.filter((target) => targets[target]);
  const canExport = Boolean(song) && selected.length > 0 && !busy;

  const exportPdfs = async () => {
    if (!song) {
      setError("Select a song.");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const needsScore = selected.includes("chords");
      const notaPath = notaFile(files);
      const notaBytes = needsScore && notaPath ? await libraryApi.readBytes(song.id, notaPath) : undefined;
      if (needsScore && !notaBytes) throw new Error("This song has no score PDF.");
      const layout = needsScore ? await loadNotaLayout(song.id, song.sections) : undefined;
      const written: string[] = [];
      for (const target of selected) {
        const playMode = entryPlayMode(entry, song.info);
        const bytes = await buildSongPdf({
          song: listedSongForColor(song, playMode, files) ?? song,
          target,
          notaBytes,
          rects: layout?.rects
        });
        const name = exportPdfFileName(songDisplayName(song), target);
        await libraryApi.writeBytes(song.id, name, bytes);
        written.push(name);
      }
      useMasterStore.setState((state) => ({
        fileIndex: {
          ...state.fileIndex,
          [song.id]: [...new Set([...(state.fileIndex[song.id] ?? []), ...written])]
        }
      }));
      setDone(written.join(", "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pdf-export" ref={rootRef}>
      <button
        type="button"
        className={open ? "on" : ""}
        title="PDF"
        aria-label="PDF"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setError(null);
          setDone(null);
        }}
      >
        <PrinterIcon />
      </button>
      {open ? (
        <div className="pdf-export-pop" role="dialog" aria-label="Export PDF">
          <div className="pdf-export-song">{song ? songDisplayName(song) : "Select a song"}</div>
          {PDF_EXPORT_TARGETS.map((target) => (
            <label key={target} className="pdf-export-option">
              <input
                type="checkbox"
                checked={targets[target]}
                onChange={() => setTargets((current) => ({ ...current, [target]: !current[target] }))}
              />
              {PDF_EXPORT_LABELS[target]}
            </label>
          ))}
          <button type="button" className="pdf-export-go" disabled={!canExport} onClick={() => void exportPdfs()}>
            {busy ? "Exporting…" : "Export"}
          </button>
          {error ? <p className="pdf-export-status is-error">{error}</p> : null}
          {done ? <p className="pdf-export-status">{done}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
