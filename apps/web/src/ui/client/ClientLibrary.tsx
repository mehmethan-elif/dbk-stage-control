import { useState } from "react";
import { MASTER_HOST_KEY, SYNC_PORT } from "../../native/sync";
import { useMasterStore } from "../../store/master-store";
import { PracticeImport } from "./PracticeImport";

export function ClientLibrary() {
  const clientSession = useMasterStore((s) => s.clientSession);
  const syncConnected = useMasterStore((s) => s.syncConnected);
  const syncHost = useMasterStore((s) => s.syncHost);
  const practiceBusy = useMasterStore((s) => s.practiceBusy);
  const songs = useMasterStore((s) => s.songs);
  const joinStage = useMasterStore((s) => s.joinStage);
  const leaveStage = useMasterStore((s) => s.leaveStage);
  const importPracticePackage = useMasterStore((s) => s.importPracticePackage);
  const importPracticeFolder = useMasterStore((s) => s.importPracticeFolder);
  const pullPracticeLibrary = useMasterStore((s) => s.pullPracticeLibrary);
  const [host, setHost] = useState(
    () =>
      syncHost ??
      (typeof localStorage !== "undefined" ? localStorage.getItem(MASTER_HOST_KEY) : "") ??
      ""
  );
  const [message, setMessage] = useState("");

  const run = async (work: () => Promise<void>, ok: string) => {
    try {
      setMessage("");
      await work();
      setMessage(ok);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="panel lan-page">
      <h2>Library and stage</h2>
      <div className="panel-body lan-body">
        <p className="meta">
          After WhatsApp, tap <strong>Import zip</strong>, or unzip in Files and tap{" "}
          <strong>Use this folder</strong>.
        </p>

        <div className="lan-block">
          <div className="lan-label">Songs on this tablet</div>
          <div className="lan-address">{songs.length} songs</div>
          {message ? <p className="meta">{message}</p> : null}
          <PracticeImport
            importZip={(file) => run(() => importPracticePackage(file), "Imported.")}
            importFolder={(files) => run(() => importPracticeFolder(files), "Folder imported.")}
            busy={practiceBusy}
          />
          <div className="lan-actions">
            <button
              type="button"
              className="lyrics-btn"
              onClick={() => void run(() => pullPracticeLibrary(host), "Updated from master.")}
            >
              Update from master
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
