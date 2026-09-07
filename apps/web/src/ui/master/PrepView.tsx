import { useEffect, useState } from "react";
import { estimateSetDuration, formatDuration, isSongEntry, PlayMode } from "@dbk/core";
import { currentGig, useMasterStore } from "../../store/master-store";
import { SaveIcon, SelectIcon } from "../shared/icons";
import { StageDialog } from "../shared/StageDialog";
import { PrepSongInfo } from "./PrepSongInfo";
import { PrepSongList } from "./PrepSongList";

export function PrepView() {
  const songs = useMasterStore((s) => s.songs);
  const gigs = useMasterStore((s) => s.gigs);
  const gigId = useMasterStore((s) => s.gigId);
  const songQuery = useMasterStore((s) => s.songQuery);
  const setSongQuery = useMasterStore((s) => s.setSongQuery);
  const setGigId = useMasterStore((s) => s.setGigId);
  const saveSetlist = useMasterStore((s) => s.saveSetlist);
  const exportPracticePackage = useMasterStore((s) => s.exportPracticePackage);
  const practiceBusy = useMasterStore((s) => s.practiceBusy);
  const deleteCurrentSetlist = useMasterStore((s) => s.deleteCurrentSetlist);
  const gig = useMasterStore(currentGig);
  const [dialog, setDialog] = useState<"select" | "save" | "delete" | null>(null);
  const [saveName, setSaveName] = useState("");
  const [libraryFocusId, setLibraryFocusId] = useState<string | null>(null);
  const [libModes, setLibModes] = useState<Record<string, PlayMode>>({});

  useEffect(() => {
    setLibraryFocusId(null);
  }, [gig?.id]);

  const total = gig ? estimateSetDuration(gig, new Map(songs.map((song) => [song.id, song]))) : 0;
  const songCount = gig ? gig.setlist.filter(isSongEntry).length : 0;

  return (
    <div className="prep">
      <section className="panel prep-panel">
        <div className="prep-head">
          <div className="prep-head-row">
            <h2>Library</h2>
            <input
              className="search search-in-head"
              placeholder="Search…"
              value={songQuery}
              onChange={(event) => setSongQuery(event.target.value)}
            />
          </div>
        </div>
        <PrepSongList
          libraryFocusId={libraryFocusId}
          onLibraryFocus={setLibraryFocusId}
          libModes={libModes}
        />
      </section>

      <div className="prep-side">
        <PrepSongInfo
          libraryFocusId={libraryFocusId}
          libModes={libModes}
          onLibPlayMode={(songId, mode) => setLibModes((current) => ({ ...current, [songId]: mode }))}
        />
        <section className="panel prep-side-panel prep-setlist-info">
          <div className="panel-head">
            <h2>{gig?.name?.trim() ? `Setlist - ${gig.name.trim()}` : "Setlist"}</h2>
            <div className="panel-head-actions">
              <button className="icon-btn" title="Select" aria-label="Select" onClick={() => setDialog("select")}>
                <SelectIcon />
              </button>
              <button
                className="icon-btn"
                title="Save"
                aria-label="Save"
                onClick={() => {
                  setSaveName(gig?.name ?? "");
                  setDialog("save");
                }}
              >
                <SaveIcon />
              </button>
              <button
                className="icon-btn danger"
                title="Delete"
                aria-label="Delete"
                disabled={!gig}
                onClick={() => setDialog("delete")}
              >
                ×
              </button>
            </div>
          </div>
          <div className="prep-setlist-summary">
            {songCount} songs · {formatDuration(total)}
          </div>
          <button
            type="button"
            className="lyrics-btn prep-export-btn"
            disabled={!gig || Boolean(practiceBusy)}
            onClick={() => void exportPracticePackage()}
          >
            {practiceBusy ?? "Export practice zip"}
          </button>
        </section>
      </div>

      {dialog === "select" ? (
        <StageDialog title="Select setlist" onClose={() => setDialog(null)}>
          {gigs.length === 0 ? (
            <p className="meta">No saved setlists yet.</p>
          ) : (
            <div className="dialog-list">
              {gigs.map((item) => (
                <button
                  key={item.id}
                  className={item.id === gigId ? "on" : ""}
                  onClick={() => {
                    void setGigId(item.id);
                    setDialog(null);
                  }}
                >
                  <span>{item.name}</span>
                  <span className="meta">{item.setlist.filter(isSongEntry).length} songs</span>
                </button>
              ))}
            </div>
          )}
          <div className="dialog-actions">
            <button className="add" onClick={() => setDialog(null)}>
              Cancel
            </button>
          </div>
        </StageDialog>
      ) : null}

      {dialog === "delete" ? (
        <StageDialog title="Delete setlist" onClose={() => setDialog(null)}>
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
                void deleteCurrentSetlist().then(() => setDialog(null));
              }}
            >
              Delete
            </button>
          </div>
        </StageDialog>
      ) : null}

      {dialog === "save" ? (
        <StageDialog title="Save setlist" onClose={() => setDialog(null)}>
          <input
            className="search"
            placeholder="Setlist name"
            value={saveName}
            autoFocus
            onChange={(event) => setSaveName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && saveName.trim()) {
                void saveSetlist(saveName).then(() => setDialog(null));
              }
            }}
          />
          <div className="dialog-actions">
            <button className="add" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              className="add"
              disabled={!saveName.trim()}
              onClick={() => {
                void saveSetlist(saveName).then(() => setDialog(null));
              }}
            >
              Save
            </button>
          </div>
        </StageDialog>
      ) : null}
    </div>
  );
}
