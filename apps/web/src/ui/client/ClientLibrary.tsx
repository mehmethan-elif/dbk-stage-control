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
  const [host, setHost] = useState(
    () =>
      syncHost ??
      (typeof localStorage !== "undefined" ? localStorage.getItem(MASTER_HOST_KEY) : "") ??
      ""
  );

  return (
    <section className="panel lan-page">
      <h2>Connect</h2>
      <div className="panel-body lan-body">
        <p className="meta">
          DBK opens in practice. It updates songs and setlists from GitHub when you open it.
        </p>

        <div className="lan-block">
          <div className="lan-label">DBK Stage Control</div>
          <div className="lan-address">{songs.length} songs on this tablet</div>
          {practiceBusy ? <p className="meta">{practiceBusy}</p> : null}
          {libraryStatus ? <p className="meta">{libraryStatus}</p> : null}
        </div>

        <form
          className="lan-block"
          onSubmit={(event) => {
            event.preventDefault();
            joinStage(host);
          }}
        >
          <label className="lan-label" htmlFor="client-master-ip">
            Master address
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
              : "Practice is local. Connect only when you are on stage."}
          </p>
          <div className="lan-actions">
            {clientSession === "stage" ? (
              <button type="button" className="lyrics-btn" onClick={() => leaveStage()}>
                Disconnect
              </button>
            ) : (
              <button type="submit" className="lyrics-btn on">
                Connect
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
