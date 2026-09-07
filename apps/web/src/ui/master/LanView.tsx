import { useEffect, useMemo, useState } from "react";
import { currentGig, useMasterStore } from "../../store/master-store";
import { isNativeApp } from "../../native/platform";
import { MASTER_HOST_KEY, PRACTICE_SHARE_PORT, SYNC_PORT } from "../../native/sync";

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function clientUrlForHost(hostname: string): string {
  const port = window.location.port;
  const host = port ? `${hostname}:${port}` : hostname;
  return `${window.location.protocol}//${host}/client`;
}

export function LanView() {
  const deviceKind = useMasterStore((s) => s.deviceKind);
  const syncConnected = useMasterStore((s) => s.syncConnected);
  const syncHosting = useMasterStore((s) => s.syncHosting);
  const syncPeerCount = useMasterStore((s) => s.syncPeerCount);
  const joinAddress = useMasterStore((s) => s.joinAddress);
  const syncHost = useMasterStore((s) => s.syncHost);
  const gigId = useMasterStore((s) => s.gigId);
  const gig = useMasterStore(currentGig);
  const reconnectSync = useMasterStore((s) => s.reconnectSync);
  const setClientHost = useMasterStore((s) => s.setClientHost);
  const refreshJoinAddress = useMasterStore((s) => s.refreshJoinAddress);
  const native = isNativeApp();
  const master = deviceKind === "master";
  const [lanHosts, setLanHosts] = useState<string[]>([]);
  const joinUrl = useMemo(() => {
    if (native) {
      const ip = joinAddress?.replace(/:\d+$/, "");
      return ip ? `http://${ip}:${PRACTICE_SHARE_PORT}/client` : null;
    }
    if (typeof window === "undefined") return null;
    const originUrl = `${window.location.origin}/client`;
    if (isLoopbackHost(window.location.hostname) && lanHosts[0]) {
      return clientUrlForHost(lanHosts[0]);
    }
    return originUrl;
  }, [native, joinAddress, lanHosts]);
  const extraUrls = useMemo(() => {
    if (native || typeof window === "undefined") return [];
    const shown = new Set(joinUrl ? [joinUrl] : []);
    return lanHosts
      .map((ip) => clientUrlForHost(ip))
      .filter((url) => !shown.has(url));
  }, [native, lanHosts, joinUrl]);
  const masterAddress =
    syncHost?.trim() ||
    joinAddress ||
    (typeof window !== "undefined" ? window.location.host : null);
  const [copied, setCopied] = useState(false);
  const [host, setHost] = useState(
    () => syncHost ?? (typeof localStorage !== "undefined" ? localStorage.getItem(MASTER_HOST_KEY) : "") ?? ""
  );

  useEffect(() => {
    if (native || !master) return;
    let cancelled = false;
    void fetch("/health")
      .then((res) => res.json() as Promise<{ addresses?: string[] }>)
      .then((data) => {
        if (!cancelled) setLanHosts(data.addresses ?? []);
      })
      .catch(() => {
        if (!cancelled) setLanHosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [native, master]);

  const status = syncConnected ? (syncHosting ? "Hosting" : "Connected") : "Connecting";
  const statusClass = syncConnected ? "ready" : "warn";

  return (
    <section className="panel lan-page">
      <h2>LAN</h2>
      <div className="panel-body lan-body">
        <div className="lan-status">
          <span className={`badge ${statusClass}`}>{status.toUpperCase()}</span>
          <span className="badge">{master ? "MASTER" : "CLIENT"}</span>
          {syncHosting ? (
            <span className="badge">
              {syncPeerCount} {syncPeerCount === 1 ? "client" : "clients"}
            </span>
          ) : null}
        </div>

        {master ? (
          <>
            <div className="lan-block">
              <div className="lan-label">Join address</div>
              <div className="lan-address">{joinUrl ?? "Waiting for address…"}</div>
              {extraUrls.length > 0 ? (
                <ul className="lan-extra">
                  {extraUrls.map((url) => (
                    <li key={url}>{url}</li>
                  ))}
                </ul>
              ) : null}
              <div className="lan-actions">
                <button
                  type="button"
                  className="lyrics-btn on"
                  disabled={!joinUrl}
                  onClick={() => {
                    if (!joinUrl) return;
                    void navigator.clipboard.writeText(joinUrl).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? "Copied" : "Copy address"}
                </button>
                {native ? (
                  <button type="button" className="lyrics-btn" onClick={() => void refreshJoinAddress()}>
                    Refresh
                  </button>
                ) : null}
              </div>
            </div>
            <p className="meta">
              Band tablets open this address in Safari or Chrome, then Add to Home Screen. They follow the
              master clock on stage and do not play stems.
            </p>
          </>
        ) : (
          <>
            <div className="lan-block">
              <div className="lan-label">Master</div>
              <div className="lan-address">{masterAddress ?? "Not set"}</div>
              <p className="meta">
                {syncConnected
                  ? gigId
                    ? `Receiving ${gig?.name ?? "setlist"}.`
                    : "Connected. Waiting for master…"
                  : "Looking for the master on this network…"}
              </p>
            </div>
            {native ? (
              <form
                className="lan-block"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = host.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
                  if (!value) return;
                  setClientHost(value);
                }}
              >
                <label className="lan-label" htmlFor="lan-master-ip">
                  Master address
                </label>
                <input
                  id="lan-master-ip"
                  className="role-ip"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  placeholder={`192.168.1.5 or 192.168.1.5:${SYNC_PORT}`}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <div className="lan-actions">
                  <button type="submit" className="lyrics-btn on">
                    Connect
                  </button>
                </div>
              </form>
            ) : null}
          </>
        )}

        <div className="lan-actions">
          <button type="button" className="lyrics-btn" onClick={() => reconnectSync()}>
            Reconnect
          </button>
        </div>
      </div>
    </section>
  );
}
