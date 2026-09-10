import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import {
  clientPracticeMode,
  clientStageLive,
  useMasterStore,
  usesFreeMetroTransport
} from "../../store/master-store";
import { ChronometerIcon } from "../shared/icons";
import { DrumView } from "../master/DrumView";
import { LyricsView } from "../master/LyricsView";
import { NotaView } from "../master/NotaView";
import { PrepTransport, StageViewChrome } from "../master/PrepTransport";
import { ClientLibrary } from "./ClientLibrary";
import { holdLibraryLoading, LibraryLoading } from "../shared/LibraryLoading";

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

function formatHourMin(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatElapsed(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  return `${pad2(Math.floor(totalMin / 60))}:${pad2(totalMin % 60)}`;
}

export function ClientApp() {
  const ready = useMasterStore((s) => s.ready);
  const gigId = useMasterStore((s) => s.gigId);
  const masterPage = useMasterStore((s) => s.masterPage);
  const setMasterPage = useMasterStore((s) => s.setMasterPage);
  const syncConnected = useMasterStore((s) => s.syncConnected);
  const songs = useMasterStore((s) => s.songs);
  const clientSession = useMasterStore((s) => s.clientSession);
  const offlineMode = useMasterStore((s) => s.clientOfflineMode);
  const setClientOfflineMode = useMasterStore((s) => s.setClientOfflineMode);
  const stageLive = useMasterStore(clientStageLive);
  const connected = clientSession === "stage";
  const page =
    masterPage === "nota"
      ? "nota"
      : masterPage === "chords"
        ? "chords"
        : masterPage === "drums"
          ? "drums"
          : masterPage === "lan"
            ? "lan"
            : "lyrics";
  const practice = useMasterStore(clientPracticeMode);
  const freeTransport = useMasterStore(usesFreeMetroTransport);
  const [now, setNow] = useState(() => new Date());
  const [concertOn, setConcertOn] = useState(false);
  const [concertMs, setConcertMs] = useState(0);
  const concertStarted = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
      if (concertStarted.current != null) {
        setConcertMs(Date.now() - concertStarted.current);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  if (!ready || holdLibraryLoading()) {
    return <LibraryLoading />;
  }

  const empty = practice && songs.length === 0;

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
          className={`lyrics-btn${page === "lyrics" ? " on" : ""}`}
          aria-pressed={page === "lyrics"}
          onClick={() => setMasterPage("lyrics")}
        >
          LYRICS
        </button>
        <button
          type="button"
          className={`lyrics-btn${page === "nota" ? " on" : ""}`}
          aria-pressed={page === "nota"}
          onClick={() => setMasterPage("nota")}
        >
          SCORE
        </button>
        <button
          type="button"
          className={`lyrics-btn${page === "chords" ? " on" : ""}`}
          aria-pressed={page === "chords"}
          onClick={() => setMasterPage("chords")}
        >
          CHORD
        </button>
        <button
          type="button"
          className={`lyrics-btn${page === "drums" ? " on" : ""}`}
          aria-pressed={page === "drums"}
          onClick={() => setMasterPage("drums")}
        >
          DRUMS
        </button>
        <div className="grow" />
        {stageLive ? null : (
          <div className="topbar-offline-modes" role="radiogroup" aria-label="Offline mode">
            <button
              type="button"
              role="radio"
              aria-checked={offlineMode === "free"}
              className={`lyrics-btn${offlineMode === "free" ? " on" : ""}`}
              onClick={() => setClientOfflineMode("free")}
            >
              FREE
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={offlineMode === "practice"}
              className={`lyrics-btn${offlineMode === "practice" ? " on" : ""}`}
              onClick={() => setClientOfflineMode("practice")}
            >
              PRACTICE
            </button>
          </div>
        )}
        <button
          type="button"
          className={`lyrics-btn${page === "lan" ? " on" : stageLive ? " lan-ok" : ""}`}
          aria-pressed={page === "lan" || connected}
          onClick={() => setMasterPage(page === "lan" ? "lyrics" : "lan")}
        >
          STAGE CONNECT
        </button>
      </header>
      {page !== "lan" && practice && !empty ? (
        <div className="app-transport">
          <PrepTransport />
        </div>
      ) : null}
      {page !== "lan" && !practice && gigId ? (
        <div className="app-transport">
          {freeTransport ? <PrepTransport /> : <StageViewChrome />}
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
                <NotaView layer={page === "chords" ? "chord" : "score"} />
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
