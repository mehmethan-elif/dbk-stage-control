import { useEffect, useRef, useState } from "react";
import { bandRoster, lanRosterState } from "@dbk/core";
import { currentGig, useMasterStore } from "../../store/master-store";
import {
  ChronometerIcon,
  EditSectionsIcon,
  MixerIcon,
  PreparationIcon,
  SpeakerMonitorIcon
} from "../shared/icons";
import { AudioView } from "./AudioView";
import { DrumView } from "./DrumView";
import { LanView } from "./LanView";
import { useNavigatorOnline } from "../shared/BandRoster";
import { LyricsView } from "./LyricsView";
import { MixerView } from "./MixerView";
import { NotaView } from "./NotaView";
import { PrepTransport } from "./PrepTransport";
import { PrepView } from "./PrepView";
import { isNativeApp } from "../../native/platform";
import { LibraryMissing } from "../native/RoleGate";
import { holdLibraryLoading, LibraryLoading } from "../shared/LibraryLoading";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatHourMin(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatElapsed(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  return `${pad2(Math.floor(totalMin / 60))}:${pad2(totalMin % 60)}`;
}

export function MasterApp() {
  const ready = useMasterStore((s) => s.ready);
  const libraryStatus = useMasterStore((s) => s.libraryStatus);
  const load = useMasterStore((s) => s.load);
  const songCount = useMasterStore((s) => s.songs.length);
  const masterPage = useMasterStore((s) => s.masterPage);
  const setMasterPage = useMasterStore((s) => s.setMasterPage);
  const editOpen = useMasterStore((s) => s.editOpen);
  const toggleEditOpen = useMasterStore((s) => s.toggleEditOpen);
  const hostOk = useMasterStore((s) => s.hostOk);
  const syncConnected = useMasterStore((s) => s.syncConnected);
  const syncPeers = useMasterStore((s) => s.syncPeers);
  const gig = useMasterStore(currentGig);
  const online = useNavigatorOnline();
  const lanState = lanRosterState(bandRoster(gig), syncPeers, syncConnected, online);
  const native = isNativeApp();
  const [now, setNow] = useState(() => new Date());
  const [concertOn, setConcertOn] = useState(false);
  const [concertMs, setConcertMs] = useState(0);
  const concertStarted = useRef<number | null>(null);
  const loadTries = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
      if (concertStarted.current != null) {
        setConcertMs(Date.now() - concertStarted.current);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (ready && songCount > 0) return;
    if (ready && loadTries.current >= 2) return;
    loadTries.current += 1;
    void load("master");
  }, [load, ready, songCount]);

  if (!ready || holdLibraryLoading()) {
    return <LibraryLoading status={libraryStatus} />;
  }

  if (native && !hostOk) {
    return <LibraryMissing master />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand">DBK STAGE</div>
          <div className="brand-name">ELIF AVCI</div>
        </div>
        <div className="topbar-time-cluster">
          <span className="topbar-clock-value">{formatHourMin(now)}</span>
          <button
            type="button"
            className={`chrono-btn${concertOn ? " on" : ""}`}
            title={concertOn ? "Reset concert time" : "Start concert time"}
            aria-label={concertOn ? "Reset concert time" : "Start concert time"}
            aria-pressed={concertOn}
            onClick={() => {
              if (concertOn) {
                concertStarted.current = null;
                setConcertOn(false);
                setConcertMs(0);
                return;
              }
              concertStarted.current = Date.now();
              setConcertOn(true);
              setConcertMs(0);
            }}
          >
            <ChronometerIcon />
          </button>
          <span className="concert-time-value">{formatElapsed(concertMs)}</span>
        </div>
        <button
          type="button"
          className={`lyrics-btn${masterPage === "lyrics" ? " on" : ""}`}
          aria-pressed={masterPage === "lyrics"}
          onClick={() => setMasterPage(masterPage === "lyrics" ? "prep" : "lyrics")}
        >
          LYRICS
        </button>
        <button
          type="button"
          className={`lyrics-btn${masterPage === "nota" ? " on" : ""}`}
          aria-pressed={masterPage === "nota"}
          onClick={() => setMasterPage(masterPage === "nota" ? "prep" : "nota")}
        >
          SCORE
        </button>
        <button
          type="button"
          className={`lyrics-btn${masterPage === "chords" ? " on" : ""}`}
          aria-pressed={masterPage === "chords"}
          onClick={() => setMasterPage(masterPage === "chords" ? "prep" : "chords")}
        >
          CHORD
        </button>
        <button
          type="button"
          className={`lyrics-btn${masterPage === "drums" ? " on" : ""}`}
          aria-pressed={masterPage === "drums"}
          onClick={() => setMasterPage(masterPage === "drums" ? "prep" : "drums")}
        >
          DRUMS
        </button>
        <div className="grow" />
        <button
          type="button"
          className={`lyrics-btn${masterPage === "lan" ? " on" : lanState === "ready" ? " lan-ok" : lanState === "problem" ? " lan-bad" : " lan-warn"}`}
          aria-pressed={masterPage === "lan"}
          onClick={() => setMasterPage(masterPage === "lan" ? "prep" : "lan")}
        >
          LAN
        </button>
        <div className="mode-toggle">
          <button
            className={editOpen && masterPage === "chords" ? "on" : ""}
            title="Edit sections"
            aria-label="Edit sections"
            aria-pressed={editOpen && masterPage === "chords"}
            onClick={() => {
              if (masterPage !== "chords") {
                setMasterPage("chords");
                if (!editOpen) toggleEditOpen();
                return;
              }
              toggleEditOpen();
            }}
          >
            <EditSectionsIcon />
          </button>
          <button
            className={masterPage === "audio" ? "on" : ""}
            title="Audio"
            aria-label="Audio"
            aria-pressed={masterPage === "audio"}
            onClick={() => setMasterPage("audio")}
          >
            <SpeakerMonitorIcon />
          </button>
          <button
            className={masterPage === "mixer" ? "on" : ""}
            title="Mixer"
            aria-label="Mixer"
            aria-pressed={masterPage === "mixer"}
            onClick={() => setMasterPage("mixer")}
          >
            <MixerIcon />
          </button>
          <button
            className={masterPage === "prep" ? "on" : ""}
            title="Preparation"
            aria-label="Preparation"
            aria-pressed={masterPage === "prep"}
            onClick={() => setMasterPage("prep")}
          >
            <PreparationIcon />
          </button>
        </div>
      </header>
      <div className="app-transport">
        <PrepTransport />
      </div>
      {masterPage === "mixer" ? (
        <MixerView />
      ) : masterPage === "audio" ? (
        <AudioView />
      ) : masterPage === "lyrics" ? (
        <LyricsView />
      ) : masterPage === "nota" || masterPage === "chords" ? (
        <NotaView layer={masterPage === "chords" ? "chord" : "score"} />
      ) : masterPage === "drums" ? (
        <DrumView />
      ) : masterPage === "lan" ? (
        <LanView />
      ) : (
        <PrepView />
      )}
    </div>
  );
}
