import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import {
  clientPracticeMode,
  clientStageLive,
  useMasterStore
} from "../../store/master-store";
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
import { NotaView } from "../master/NotaView";
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
  const ready = useMasterStore((s) => s.ready);
  const masterPage = useMasterStore((s) => s.masterPage);
  const setMasterPage = useMasterStore((s) => s.setMasterPage);
  const songs = useMasterStore((s) => s.songs);
  const clientSession = useMasterStore((s) => s.clientSession);
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
        <div className="grow" />
        <StageViewTools />
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
        <button
          type="button"
          className={`lyrics-btn page-icon topbar-connect${page === "lan" ? " on" : stageLive ? " lan-ok" : ""}`}
          title="Stage connect"
          aria-label="Stage connect"
          aria-pressed={page === "lan" || connected}
          onClick={() => setMasterPage(page === "lan" ? "lyrics" : "lan")}
        >
          <StageConnectIcon />
        </button>
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
