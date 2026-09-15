import { useEffect, useState, type MouseEvent, type PointerEvent } from "react";
import { clientBandRoster, isMasterBandName } from "@dbk/core";
import { MASTER_HOST_KEY, PRACTICE_SHARE_PORT } from "../../native/sync";
import { currentGig, useMasterStore } from "../../store/master-store";
import { BandRoster } from "../shared/BandRoster";

let lastStageAction = 0;

function onStageAction(
  event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>,
  action: () => void
) {
  event.stopPropagation();
  event.preventDefault();
  if ("button" in event && event.button > 0) return;
  const now = performance.now();
  if (now - lastStageAction < 400) return;
  lastStageAction = now;
  action();
}

export function ClientLibrary() {
  const clientSession = useMasterStore((s) => s.clientSession);
  const syncConnected = useMasterStore((s) => s.syncConnected);
  const syncHost = useMasterStore((s) => s.syncHost);
  const syncPeers = useMasterStore((s) => s.syncPeers);
  const gig = useMasterStore(currentGig);
  const stageName = useMasterStore((s) => s.stageName);
  const setStageName = useMasterStore((s) => s.setStageName);
  const joinStage = useMasterStore((s) => s.joinStage);
  const leaveStage = useMasterStore((s) => s.leaveStage);
  // This page is served by the master itself, so its address is the address of the page. Nothing
  // to type in and nothing to mistype.
  const servedHere =
    typeof window !== "undefined" && window.location.port === String(PRACTICE_SHARE_PORT);
  const host =
    syncHost ??
    (servedHere ? window.location.hostname : null) ??
    (typeof localStorage !== "undefined" ? localStorage.getItem(MASTER_HOST_KEY) : "") ??
    "";
  const roster = clientBandRoster(gig);
  const onStage = clientSession === "stage";
  const connected = onStage && syncConnected;
  const canConnect = Boolean(host.trim()) && Boolean(stageName?.trim());
  const [waited, setWaited] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const attempting = onStage && !connected && !waited;
  const stalled = onStage && !connected && waited;

  const connect = () => {
    if (connected || !canConnect) return;
    setWaited(false);
    setAttempt((count) => count + 1);
    // An attempt that got no answer is stood back up rather than left in place, since the socket
    // it was waiting on is already dead.
    if (onStage) leaveStage();
    joinStage(host);
  };

  useEffect(() => {
    if (stageName && isMasterBandName(stageName)) setStageName(null);
  }, [stageName, setStageName]);

  useEffect(() => {
    if (!onStage || connected) {
      setWaited(false);
      return;
    }
    const timer = window.setTimeout(() => setWaited(true), 4000);
    return () => window.clearTimeout(timer);
  }, [onStage, connected, syncHost, attempt]);

  return (
    <section className="panel lan-page">
      <h2>Connect</h2>
      <div className="panel-body lan-body">
        <div className="lan-block">
          <div className="lan-label">Band Members</div>
          <BandRoster
            names={roster}
            peers={syncPeers}
            selected={stageName}
            onSelect={setStageName}
          />
        </div>

        <form
          className="lan-block"
          onSubmit={(event) => {
            event.preventDefault();
            connect();
          }}
        >
          <div className="lan-actions">
            <button
              type="button"
              className={`lyrics-btn lan-connect-action${canConnect && !attempting ? " on" : ""}`}
              disabled={!canConnect || attempting}
              onPointerDown={(event) => onStageAction(event, connect)}
              onClick={(event) => onStageAction(event, connect)}
            >
              {attempting ? "Connecting…" : "Connect"}
            </button>
          </div>
          <p className="meta">
            {attempting
              ? `Connecting to ${syncHost ?? host}…`
              : stalled
                ? "No answer from the desk. Is it on this Wi-Fi with the app open?"
                : !stageName?.trim()
                  ? "Choose your name, then Connect."
                  : "Ready — press Connect."}
          </p>
        </form>
      </div>
    </section>
  );
}
