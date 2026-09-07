import { useState } from "react";
import { MASTER_HOST_KEY, SYNC_PORT } from "../../native/sync";
import { useMasterStore } from "../../store/master-store";

export function ClientLibrary() {
  const clientSession = useMasterStore((s) => s.clientSession);
  const syncConnected = useMasterStore((s) => s.syncConnected);
  const syncHost = useMasterStore((s) => s.syncHost);
  const practiceBusy = useMasterStore((s) => s.practiceBusy);
  const libraryStatus = useMasterStore((s) => s.libraryStatus);
  const songs = useMasterStore((s) => s.songs);
  const joinStage = useMasterStore((s) => s.joinStage);
  const leaveStage = useMasterStore((s) => s.leaveStage);
  const syncClientLibrary = useMasterStore((s) => s.syncClientLibrary);
  const [host, setHost] = useState(
    () =>
      syncHost ??
      (typeof localStorage !== "undefined" ? localStorage.getItem(MASTER_HOST_KEY) : "") ??
      ""
  );

  return (
    <section className="panel lan-page">
      <h2>Library and stage</h2>
      <div className="panel-body lan-body">
        <p className="meta">
          DBK Stage Control updates itself from GitHub. Open the page and it downloads new songs and
          setlist changes. No zip.
        </p>

        <div className="lan-block">
          <div className="lan-label">DBK Stage Control</div>
          <div className="lan-address">{songs.length} songs on this tablet</div>
          {practiceBusy ? <p className="meta">{practiceBusy}</p> : null}
          {libraryStatus ? <p className="meta">{libraryStatus}</p> : null}
          <div className="lan-actions">
            <button
              type="button"
              className="lyrics-btn on"
              disabled={Boolean(practiceBusy)}
              onClick={() => void syncClientLibrary()}
            >
              Check for updates
            </button>
          </div>
        </div>

        <form
          className="lan-block"
          onSubmit={(event) => {
            event.preventDefault();
            joinStage(host);
          }}
        >
          <label className="lan-label" htmlFor="client-master-ip">
            Join stage
          </label>
          <input
            id="client-master-ip"
            className="role-ip"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder={`192.168.1.5 or 192.168.1.5:${SYNC_PORT}`}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <p className="meta">
            {clientSession === "stage"
              ? syncConnected
                ? "Following the master. This tablet does not play audio."
                : "Looking for the master…"
              : "Practice is local. Join only when you are on stage."}
          </p>
          <div className="lan-actions">
            {clientSession === "stage" ? (
              <button type="button" className="lyrics-btn" onClick={() => leaveStage()}>
                Leave stage
              </button>
            ) : (
              <button type="submit" className="lyrics-btn on">
                Join stage
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
