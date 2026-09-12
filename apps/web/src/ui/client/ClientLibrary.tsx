import { useEffect, useState, type MouseEvent, type PointerEvent } from "react";
import { clientBandRoster, isMasterBandName } from "@dbk/core";
import { MASTER_HOST_KEY, PRACTICE_SHARE_PORT, SYNC_PORT } from "../../native/sync";
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
  const servedHere =
    typeof window !== "undefined" && window.location.port === String(PRACTICE_SHARE_PORT);
  const [host, setHost] = useState(
    () =>
      syncHost ??
      (servedHere ? window.location.hostname : null) ??
      (typeof localStorage !== "undefined" ? localStorage.getItem(MASTER_HOST_KEY) : "") ??
      ""
  );
  const roster = clientBandRoster(gig);
  const onStage = clientSession === "stage";
  const connected = onStage && syncConnected;
  const canConnect = Boolean(host.trim()) || servedHere;
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    if (stageName && isMasterBandName(stageName)) setStageName(null);
  }, [stageName, setStageName]);

  useEffect(() => {
    if (!servedHere || onStage) return;
    joinStage(window.location.hostname);
  }, [servedHere, onStage, joinStage]);

  useEffect(() => {
    if (!onStage || connected) {
      setWaited(false);
      return;
    }
    const timer = window.setTimeout(() => setWaited(true), 4000);
    return () => window.clearTimeout(timer);
  }, [onStage, connected, syncHost]);

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
            disabled={connected}
            onSelect={setStageName}
          />
        </div>

        <form
          className="lan-block"
          onSubmit={(event) => {
            event.preventDefault();
            if (onStage || !canConnect) return;
            joinStage(host);
          }}
        >
          <label className="lan-label" htmlFor="client-master-ip">
            Master address
          </label>
          <div className="lan-address-row">
            <input
              id="client-master-ip"
              className="role-ip"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder={`192.168.1.5 or 192.168.1.5:${SYNC_PORT}`}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={onStage}
            />
            <button
              type="button"
              className="lyrics-btn lan-connect-action"
              disabled={!onStage && !canConnect}
              onPointerDown={(event) =>
                onStageAction(event, () => {
                  if (onStage) leaveStage();
                  else if (canConnect) joinStage(host);
                })
              }
              onClick={(event) =>
                onStageAction(event, () => {
                  if (onStage) leaveStage();
                  else if (canConnect) joinStage(host);
                })
              }
            >
              {onStage ? "Disconnect" : "Connect"}
            </button>
          </div>
          <p className="meta">
            {connected
              ? "Connected to master."
              : onStage
                ? waited
                  ? "No master at that address. Same Wi-Fi? Allow Local Network for this app."
                  : `Connecting to ${syncHost ?? host}…`
                : servedHere
                  ? "This page is on the master. Connecting…"
                  : "Type the master address, then Connect. Or open the Client page URL in Safari."}
          </p>
        </form>
      </div>
    </section>
  );
}
