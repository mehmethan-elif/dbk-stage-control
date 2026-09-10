import { useEffect, useState } from "react";
import { estimateSetDuration, formatDuration, isSongEntry } from "@dbk/core";
import { currentGig, selectableGigs, useMasterStore } from "../../store/master-store";
import { isSongLibraryGig, setlistNameTaken, SONG_LIBRARY_NAME } from "../../store/song-library";
import { RenameIcon, SelectIcon } from "../shared/icons";
import { StageDialog } from "../shared/StageDialog";
import { PrepSongInfo } from "./PrepSongInfo";
import { PrepSongList } from "./PrepSongList";
import { SetlistPerformancePanel } from "./SetlistPerformancePanel";

export function PrepView() {
  const songs = useMasterStore((s) => s.songs);
  const gigs = useMasterStore(selectableGigs);
  const gigId = useMasterStore((s) => s.gigId);
  const setGigId = useMasterStore((s) => s.setGigId);
  const saveSetlist = useMasterStore((s) => s.saveSetlist);
  const renameSetlist = useMasterStore((s) => s.renameSetlist);
  const deleteCurrentSetlist = useMasterStore((s) => s.deleteCurrentSetlist);
  const gig = useMasterStore(currentGig);
  const [dialog, setDialog] = useState<"select" | "save" | "delete" | null>(null);
  const [saveName, setSaveName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [initialSongId, setInitialSongId] = useState<string | null>(null);
  const [libraryFocusId, setLibraryFocusId] = useState<string | null>(null);

  useEffect(() => {
    setLibraryFocusId(null);
  }, [gig?.id]);

  const total = gig ? estimateSetDuration(gig, new Map(songs.map((song) => [song.id, song]))) : 0;
  const songCount = gig ? gig.setlist.filter(isSongEntry).length : 0;
  const songLibrary = isSongLibraryGig(gig);

  const closeDialog = () => {
    setDialog(null);
    setInitialSongId(null);
    setNameError(null);
  };

  const commitSetlistName = () => {
    const trimmed = saveName.trim();
    if (!trimmed) return;
    const exceptId = initialSongId ? null : gig?.id;
    if (setlistNameTaken(gigs, trimmed, exceptId)) {
      setNameError(
        trimmed.toLowerCase() === SONG_LIBRARY_NAME.toLowerCase()
          ? `${SONG_LIBRARY_NAME} is reserved.`
          : `A setlist named "${trimmed}" already exists.`
      );
      return;
    }
    const action = initialSongId
      ? saveSetlist(trimmed, initialSongId)
      : renameSetlist(trimmed);
    void action.then((ok) => {
      if (ok) closeDialog();
      else setNameError(`Could not save "${trimmed}".`);
    });
  };

  return (
    <div className="prep">
      <section className="panel prep-panel">
        <div className="prep-head">
          <div className="prep-head-row">
            <h2 className="prep-library-title">
              <span className="prep-active-setlist">{gig?.name?.trim() || "No setlist"}</span>
              <span className="prep-head-summary">
                {songCount} songs · {formatDuration(total)}
              </span>
            </h2>
            <div className="panel-head-actions">
              <button className="icon-btn" title="Select" aria-label="Select" onClick={() => setDialog("select")}>
                <SelectIcon />
              </button>
              <button
                className="icon-btn"
                title="Rename"
                aria-label="Rename"
                disabled={songLibrary}
                onClick={() => {
                  setInitialSongId(null);
                  setSaveName(gig?.name ?? "");
                  setNameError(null);
                  setDialog("save");
                }}
              >
                <RenameIcon />
              </button>
              <button
                className="icon-btn danger"
                title="Delete"
                aria-label="Delete"
                disabled={!gig || songLibrary}
                onClick={() => setDialog("delete")}
              >
                ×
              </button>
            </div>
          </div>
        </div>
        <PrepSongList
          libraryFocusId={libraryFocusId}
          onLibraryFocus={setLibraryFocusId}
          onCreateSetlist={(songId) => {
            setInitialSongId(songId);
            setSaveName("");
            setNameError(null);
            setDialog("save");
          }}
        />
      </section>

      <div className="prep-side">
        <PrepSongInfo
          libraryFocusId={libraryFocusId}
        />
        <SetlistPerformancePanel />
      </div>

      {dialog === "select" ? (
        <StageDialog title="Select setlist" onClose={closeDialog}>
          <div className="dialog-list">
            {gigs.map((item) => (
              <button
                key={item.id}
                className={item.id === gigId ? "on" : ""}
                onClick={() => {
                  void setGigId(item.id);
                  closeDialog();
                }}
              >
                <span>{item.name}</span>
                <span className="meta">{item.setlist.filter(isSongEntry).length} songs</span>
              </button>
            ))}
          </div>
          <div className="dialog-actions">
            <button className="add" onClick={() => setDialog(null)}>
              Cancel
            </button>
          </div>
        </StageDialog>
      ) : null}

      {dialog === "delete" ? (
        <StageDialog title="Delete setlist" onClose={closeDialog}>
          <p className="dialog-copy">
            Delete {gig?.name ? `"${gig.name}"` : "this setlist"}? This cannot be undone.
          </p>
          <div className="dialog-actions">
            <button className="add" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              className="add danger"
              onClick={() => {
                void deleteCurrentSetlist().then(closeDialog);
              }}
            >
              Delete
            </button>
          </div>
        </StageDialog>
      ) : null}

      {dialog === "save" ? (
        <StageDialog title={initialSongId ? "New setlist" : "Rename setlist"} onClose={closeDialog}>
          <input
            className="search"
            placeholder="Setlist name"
            value={saveName}
            autoFocus
            onChange={(event) => {
              setSaveName(event.target.value);
              setNameError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && saveName.trim()) {
                commitSetlistName();
              }
            }}
          />
          {nameError ? <p className="dialog-copy">{nameError}</p> : null}
          <div className="dialog-actions">
            <button className="add" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              className="add"
              disabled={!saveName.trim()}
              onClick={commitSetlistName}
            >
              {initialSongId ? "Create" : "Rename"}
            </button>
          </div>
        </StageDialog>
      ) : null}
    </div>
  );
}
