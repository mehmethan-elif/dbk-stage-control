import { useEffect, useMemo, useState } from "react";
import { bandRoster } from "@dbk/core";
import { isRemotePeer } from "@dbk/protocol";
import { currentGig, useMasterStore } from "../../store/master-store";
import { isNativeApp } from "../../native/platform";
import { MASTER_HOST_KEY, PRACTICE_SHARE_PORT, SYNC_PORT } from "../../native/sync";
import { BandRoster, useNavigatorOnline } from "../shared/BandRoster";

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function pageUrlForHost(hostname: string, page: "client" | "remote"): string {
  const port = window.location.port;
  const host = port ? `${hostname}:${port}` : hostname;
  return `${window.location.protocol}//${host}/${page}`;
}

export function LanView() {
  const deviceKind = useMasterStore((s) => s.deviceKind);
  const syncConnected = useMasterStore((s) => s.syncConnected);
  const syncPeers = useMasterStore((s) => s.syncPeers);
  const joinAddress = useMasterStore((s) => s.joinAddress);
  const syncHost = useMasterStore((s) => s.syncHost);
  const gigId = useMasterStore((s) => s.gigId);
  const gig = useMasterStore(currentGig);
  const setClientHost = useMasterStore((s) => s.setClientHost);
  const refreshJoinAddress = useMasterStore((s) => s.refreshJoinAddress);
  const publishClientLibrary = useMasterStore((s) => s.publishClientLibrary);
  const practiceBusy = useMasterStore((s) => s.practiceBusy);
  const libraryStatus = useMasterStore((s) => s.libraryStatus);
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
      return pageUrlForHost(lanHosts[0], "client");
    }
    return originUrl;
  }, [native, joinAddress, lanHosts]);
  const remoteUrl = useMemo(() => {
    if (native) {
      const ip = joinAddress?.replace(/:\d+$/, "");
      return ip ? `http://${ip}:${PRACTICE_SHARE_PORT}/remote` : null;
    }
    if (typeof window === "undefined") return null;
    if (isLoopbackHost(window.location.hostname) && lanHosts[0]) {
      return pageUrlForHost(lanHosts[0], "remote");
    }
    return `${window.location.origin}/remote`;
  }, [native, joinAddress, lanHosts]);
  const extraUrls = useMemo(() => {
    if (native || typeof window === "undefined") return [];
    const shown = new Set(joinUrl ? [joinUrl] : []);
    return lanHosts
      .map((ip) => pageUrlForHost(ip, "client"))
      .filter((url) => !shown.has(url));
  }, [native, lanHosts, joinUrl]);
  const remoteConnected = syncPeers.some(isRemotePeer);
  const stageMasterAddress = useMemo(() => {
    if (native) return joinAddress?.trim() || null;
    const ip = lanHosts[0] ?? (typeof window !== "undefined" && !isLoopbackHost(window.location.hostname)
      ? window.location.hostname
      : null);
    return ip ? `${ip}:${SYNC_PORT}` : null;
  }, [native, joinAddress, lanHosts]);
  const extraMasterAddresses = useMemo(() => {
    if (native) return [];
    const shown = new Set(stageMasterAddress ? [stageMasterAddress] : []);
    return lanHosts
      .slice(1)
      .map((ip) => `${ip}:${SYNC_PORT}`)
      .filter((address) => !shown.has(address));
  }, [native, lanHosts, stageMasterAddress]);
  const masterAddress =
    syncHost?.trim() ||
    joinAddress ||
    (typeof window !== "undefined" ? window.location.host : null);
  const [copiedPage, setCopiedPage] = useState(false);
  const [copiedRemote, setCopiedRemote] = useState(false);
  const [copiedMaster, setCopiedMaster] = useState(false);
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

  const online = useNavigatorOnline();
  const roster = bandRoster(gig);

  return (
    <section className="panel lan-page">
      <h2>LAN</h2>
      <div className="panel-body lan-body">
        {master ? (
          <>
            <div className="lan-block">
              <div className="lan-label">Band</div>
              <BandRoster names={roster} peers={syncPeers} masterOnline={online} />
              <p className={`meta${remoteConnected ? " remote-on" : ""}`}>
                {remoteConnected ? "Soundcheck remote connected." : "Soundcheck remote offline."}
              </p>
            </div>
            <div className="lan-block">
              <div className="lan-label">Master address</div>
              <div className="lan-address-row">
                <div className="lan-address">{stageMasterAddress ?? "Waiting for address…"}</div>
                <button
                  type="button"
                  className="lyrics-btn on"
                  disabled={!stageMasterAddress}
                  onClick={() => {
                    if (!stageMasterAddress) return;
                    void navigator.clipboard.writeText(stageMasterAddress).then(() => {
                      setCopiedMaster(true);
                      window.setTimeout(() => setCopiedMaster(false), 1500);
                    });
                  }}
                >
                  {copiedMaster ? "Copied" : "Copy"}
                </button>
                {native ? (
                  <button type="button" className="lyrics-btn" onClick={() => void refreshJoinAddress()}>
                    Refresh
                  </button>
                ) : null}
              </div>
            </div>
            <div className="lan-block">
              <div className="lan-label">Client page</div>
              <div className="lan-address-row">
                <div className="lan-address">{joinUrl ?? "Waiting for address…"}</div>
                <button
                  type="button"
                  className="lyrics-btn on"
                  disabled={!joinUrl}
                  onClick={() => {
                    if (!joinUrl) return;
                    void navigator.clipboard.writeText(joinUrl).then(() => {
                      setCopiedPage(true);
                      window.setTimeout(() => setCopiedPage(false), 1500);
                    });
                  }}
                >
                  {copiedPage ? "Copied" : "Copy"}
                </button>
              </div>
              {extraUrls.length > 0 ? (
                <ul className="lan-extra">
                  {extraUrls.map((url) => (
                    <li key={url}>{url}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="lan-block">
              <div className="lan-label">Soundcheck remote</div>
              <div className="lan-address-row">
                <div className="lan-address">{remoteUrl ?? "Waiting for address…"}</div>
                <button
                  type="button"
                  className="lyrics-btn on"
                  disabled={!remoteUrl}
                  onClick={() => {
                    if (!remoteUrl) return;
                    void navigator.clipboard.writeText(remoteUrl).then(() => {
                      setCopiedRemote(true);
                      window.setTimeout(() => setCopiedRemote(false), 1500);
                    });
                  }}
                >
                  {copiedRemote ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            {!native ? (
              <div className="lan-block">
                <div className="lan-label">Band library</div>
                <div className="lan-actions">
                  <button
                    type="button"
                    className="lyrics-btn"
                    disabled={Boolean(practiceBusy)}
                    onClick={() => void publishClientLibrary()}
                  >
                    {practiceBusy ?? "Publish band library"}
                  </button>
                </div>
                {libraryStatus ? <p className="meta">{libraryStatus}</p> : null}
              </div>
            ) : null}
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
      </div>
    </section>
  );
}
