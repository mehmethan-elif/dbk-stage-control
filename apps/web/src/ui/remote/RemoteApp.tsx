import { useMemo, useState } from "react";
import { isSongEntry, PlaybackState, songDisplayName } from "@dbk/core";
import { MASTER_HOST_KEY, SYNC_PORT } from "../../native/sync";
import { currentGig, useMasterStore } from "../../store/master-store";
import { findSongByRef } from "../../store/song-library";
import { MixerView } from "../master/MixerView";
import { PlayIcon, StopIcon } from "../shared/icons";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

export function RemoteApp() {
  const ready = useMasterStore((s) => s.ready);
  const syncConnected = useMasterStore((s) => s.syncConnected);
  const syncHost = useMasterStore((s) => s.syncHost);
  const clientSession = useMasterStore((s) => s.clientSession);
  const gig = useMasterStore(currentGig);
  const songs = useMasterStore((s) => s.songs);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const previewTime = useMasterStore((s) => s.previewTime);
  const playback = useMasterStore((s) => s.playback);
  const joinRemote = useMasterStore((s) => s.joinRemote);
  const leaveRemote = useMasterStore((s) => s.leaveRemote);
  const remoteSelect = useMasterStore((s) => s.remoteSelect);
  const remotePlay = useMasterStore((s) => s.remotePlay);
  const remoteStop = useMasterStore((s) => s.remoteStop);
  const remoteSeek = useMasterStore((s) => s.remoteSeek);
  const [host, setHost] = useState(() => {
    if (syncHost) return syncHost;
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(MASTER_HOST_KEY) : "";
    if (stored) return stored;
    if (typeof window === "undefined") return "";
    const hostname = window.location.hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" ? "" : hostname;
  });
  const [scrub, setScrub] = useState<number | null>(null);
  const [page, setPage] = useState<"setlist" | "mixer">("setlist");

  const joined = clientSession === "stage";
  const connected = joined && syncConnected;
  const playing =
    playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
  const songsOnSetlist = useMemo(
    () => (gig?.setlist ?? []).filter(isSongEntry).filter((entry) => !entry.skipped),
    [gig]
  );
  const selected = songsOnSetlist.find((entry) => entry.entryId === selectedEntryId);
  const playingId = playback.clock?.setlistEntryId;
  const song = selected ? findSongByRef(songs, selected.songId) : undefined;
  const duration = Math.max(song?.duration ?? 0, previewTime, playback.clock?.time ?? 0);
  const time = scrub ?? previewTime;
  const section = playback.clock?.section;
  const commitSeek = (event?: { currentTarget: EventTarget }) => {
    const el = event?.currentTarget;
    const next = el instanceof HTMLInputElement ? Number(el.value) : scrub;
    if (next == null || !Number.isFinite(next)) return;
    remoteSeek(next);
    setScrub(null);
  };

  if (!ready) {
    return (
      <div className="app-shell remote-app">
        <div className="app-loading">
          <div className="brand">DBK STAGE</div>
          <div className="brand-name">REMOTE</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell remote-app">
      <header className="topbar remote-topbar">
        <div className="brand-block">
          <div className="brand">DBK STAGE</div>
          <div className="brand-name">SOUNDCHECK</div>
        </div>
        <div className={`remote-link${connected ? " on" : ""}`}>
          {connected ? "Connected" : joined ? "Connecting…" : "Offline"}
        </div>
        {connected ? (
          <div className="remote-pages">
            <button
              type="button"
              className={`lyrics-btn${page === "setlist" ? " on" : ""}`}
              aria-pressed={page === "setlist"}
              onClick={() => setPage("setlist")}
            >
              SETLIST
            </button>
            <button
              type="button"
              className={`lyrics-btn${page === "mixer" ? " on" : ""}`}
              aria-pressed={page === "mixer"}
              onClick={() => setPage("mixer")}
            >
              MIXER
            </button>
          </div>
        ) : null}
      </header>

      {connected ? (
        <div className="remote-body">
          <section className="remote-now">
            <div className="remote-now-title">{song ? songDisplayName(song) : "Select a song"}</div>
            <div className="remote-now-meta">
              {gig?.name ?? "Setlist"}
              {section ? ` · ${section}` : ""}
            </div>
            <div className="remote-clock">
              <span>{formatClock(time)}</span>
              <span>{duration > 0 ? formatClock(duration) : "—"}</span>
            </div>
            <input
              className="remote-seek"
              type="range"
              min={0}
              max={Math.max(duration, 1)}
              step={0.1}
              value={Math.min(time, Math.max(duration, 1))}
              disabled={!selected}
              aria-label="Position"
              onChange={(event) => setScrub(Number(event.target.value))}
              onPointerUp={commitSeek}
              onKeyUp={commitSeek}
            />
            <div className="remote-transport">
              <button
                type="button"
                className={`add prep-play play${playing ? " is-playing" : ""}`}
                title="Play"
                aria-label="Play"
                disabled={!selected}
                onClick={() => remotePlay(selected?.entryId)}
              >
                <PlayIcon />
              </button>
              <button
                type="button"
                className="add prep-play stop"
                title="Stop"
                aria-label="Stop"
                disabled={!selected}
                onClick={() => remoteStop()}
              >
                <StopIcon />
              </button>
            </div>
          </section>

          {page === "mixer" ? (
            <section className="remote-mixer" aria-label="Mixer">
              <MixerView />
            </section>
          ) : (
            <section className="remote-setlist" aria-label="Setlist">
              {songsOnSetlist.length === 0 ? (
                <p className="meta">Waiting for the iPad setlist…</p>
              ) : (
                songsOnSetlist.map((entry, index) => {
                  const item = findSongByRef(songs, entry.songId);
                  const on = entry.entryId === selectedEntryId;
                  const live = entry.entryId === playingId && playing;
                  return (
                    <button
                      key={entry.entryId}
                      type="button"
                      className={`remote-song${on ? " on" : ""}${live ? " is-playing" : ""}`}
                      onClick={() => remoteSelect(entry.entryId)}
                    >
                      <span className="remote-song-num">{index + 1}</span>
                      <span className="remote-song-name">{item ? songDisplayName(item) : entry.songId}</span>
                    </button>
                  );
                })
              )}
            </section>
          )}

          <button type="button" className="lyrics-btn remote-leave" onClick={() => leaveRemote()}>
            Disconnect
          </button>
        </div>
      ) : (
        <form
          className="remote-connect"
          onSubmit={(event) => {
            event.preventDefault();
            if (joined) leaveRemote();
            else joinRemote(host);
          }}
        >
          <p className="remote-copy">
            The iPad plays the tracks. This phone only sends Play, Stop, and position.
          </p>
          <label className="lan-label" htmlFor="remote-master-ip">
            Master address
          </label>
          <input
            id="remote-master-ip"
            className="role-ip"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder={`192.168.1.5 or 192.168.1.5:${SYNC_PORT}`}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={joined}
          />
          <button type="submit" className="lyrics-btn on remote-join" disabled={!joined && !host.trim()}>
            {joined ? "Cancel" : "Connect"}
          </button>
        </form>
      )}
    </div>
  );
}
