import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import {
  clientPracticeMode,
  clientStageLive,
  useMasterStore
} from "../../store/master-store";
import { stageHomeScreenRole } from "../../native/sync-host";
import {
  ChordIcon,
  ChronometerIcon,
  DrumsIcon,
  LyricsIcon,
  ScoreIcon,
  StageConnectIcon
} from "../shared/icons";
import { DrumView } from "../master/DrumView";
import { LyricsView } from "../master/LyricsView";
import { NotaViewAsync, usePdfWarmup } from "../master/lazy-pdf";
import { PrepTransport, StageSetlistButton, StageViewTools } from "../master/PrepTransport";
import { ClientLibrary } from "./ClientLibrary";
import { LibraryLoading } from "../shared/LibraryLoading";

class StageCrashGuard extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message || "Score failed to render." };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Client stage crashed", error, info.componentStack);
  }

  render() {
    if (this.state.message) {
      return <div className="lyrics-empty meta">{this.state.message}</div>;
    }
    return this.props.children;
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatElapsed(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  return `${pad2(Math.floor(totalMin / 60))}:${pad2(totalMin % 60)}`;
}

export function ClientApp() {
  usePdfWarmup();
  const ready = useMasterStore((s) => s.ready);
  const masterPage = useMasterStore((s) => s.masterPage);
  const setMasterPage = useMasterStore((s) => s.setMasterPage);
  const songs = useMasterStore((s) => s.songs);
  const stageLive = useMasterStore(clientStageLive);
  // Only the stage icon joins a show, so the practice one carries no connect button, no concert
  // clock, and nothing that could leave it parked on the connect page. See `stageHomeScreenRole`.
  const stageRole = stageHomeScreenRole();
  const requested =
    masterPage === "nota"
      ? "nota"
      : masterPage === "chords"
        ? "chords"
        : masterPage === "drums"
          ? "drums"
          : masterPage === "lan"
            ? "lan"
            : "lyrics";
  const page = requested === "lan" && !stageRole ? "lyrics" : requested;
  const practice = useMasterStore(clientPracticeMode);
  const libraryStatus = useMasterStore((s) => s.libraryStatus);
  const practiceBusy = useMasterStore((s) => s.practiceBusy);
  const [concertOn, setConcertOn] = useState(false);
  const [concertMs, setConcertMs] = useState(0);
  const concertStarted = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (concertStarted.current != null) {
        setConcertMs(Date.now() - concertStarted.current);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  // Joining is the only reason the connect page exists, so it leaves of its own accord once the
  // desk answers and comes back if the link ever goes. Nobody has to think about it mid-show. The
  // page buttons still work while it is up, so losing the desk does not trap anyone here.
  const wasLive = useRef(false);
  useEffect(() => {
    if (!stageRole) return;
    if (stageLive) {
      wasLive.current = true;
      if (masterPage === "lan") setMasterPage("lyrics");
      return;
    }
    if (wasLive.current) {
      wasLive.current = false;
      setMasterPage("lan");
    }
  }, [stageRole, stageLive, masterPage, setMasterPage]);

  if (!ready) {
    return <LibraryLoading status={libraryStatus ?? practiceBusy} />;
  }

  const empty = practice && songs.length === 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand">DBK STAGE</div>
          <div className="brand-name">ELIF AVCI</div>
        </div>
        <StageSetlistButton />
        <button
          type="button"
          className={`lyrics-btn page-icon${page === "lyrics" ? " on" : ""}`}
          title="Lyrics"
          aria-label="Lyrics"
          aria-pressed={page === "lyrics"}
          onClick={() => setMasterPage("lyrics")}
        >
          <LyricsIcon />
        </button>
        <button
          type="button"
          className={`lyrics-btn page-icon${page === "nota" ? " on" : ""}`}
          title="Score"
          aria-label="Score"
          aria-pressed={page === "nota"}
          onClick={() => setMasterPage("nota")}
        >
          <ScoreIcon />
        </button>
        <button
          type="button"
          className={`lyrics-btn page-icon${page === "chords" ? " on" : ""}`}
          title="Chord"
          aria-label="Chord"
          aria-pressed={page === "chords"}
          onClick={() => setMasterPage("chords")}
        >
          <ChordIcon />
        </button>
        <button
          type="button"
          className={`lyrics-btn page-icon${page === "drums" ? " on" : ""}`}
          title="Drums"
          aria-label="Drums"
          aria-pressed={page === "drums"}
          onClick={() => setMasterPage("drums")}
        >
          <DrumsIcon />
        </button>
        <span className="topbar-role">{stageRole ? "STAGE" : "PRACTICE"}</span>
        <div className="grow" />
        <StageViewTools />
        {stageRole ? (
          <>
            <div className="topbar-time-cluster">
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
            <span
              className={`lyrics-btn page-icon topbar-connect${stageLive ? " lan-ok" : ""}`}
              title={stageLive ? "Connected to the desk" : "Not connected"}
              role="status"
              aria-label={stageLive ? "Connected to the desk" : "Not connected"}
            >
              <StageConnectIcon />
            </span>
          </>
        ) : null}
      </header>
      {page !== "lan" && ((practice && !empty) || stageLive) ? (
        <div className="app-transport">
          <PrepTransport />
        </div>
      ) : null}
      {empty && page !== "lan" ? (
        <ClientLibrary />
      ) : page === "lan" ? (
        <ClientLibrary />
      ) : (
        <div className="client-main">
          <div className="client-stage">
            <StageCrashGuard>
              {page === "nota" || page === "chords" ? (
                <NotaViewAsync layer={page === "chords" ? "chord" : "score"} />
              ) : page === "drums" ? (
                <DrumView />
              ) : (
                <LyricsView />
              )}
            </StageCrashGuard>
          </div>
        </div>
      )}
    </div>
  );
}
