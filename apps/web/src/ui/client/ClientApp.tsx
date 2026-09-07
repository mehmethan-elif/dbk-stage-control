import { useEffect, useRef, useState } from "react";
import { useMasterStore } from "../../store/master-store";
import { ChronometerIcon } from "../shared/icons";
import { ChordView } from "../master/ChordView";
import { DrumView } from "../master/DrumView";
import { LyricsView } from "../master/LyricsView";
import { NotaView } from "../master/NotaView";
import { PrepTransport, StageViewChrome } from "../master/PrepTransport";
import { ClientLibrary } from "./ClientLibrary";

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
  const leaveStage = useMasterStore((s) => s.leaveStage);
  const joinStage = useMasterStore((s) => s.joinStage);
  const syncHost = useMasterStore((s) => s.syncHost);
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
  const practice = clientSession === "practice";
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

  if (!ready) {
    return <div className="panel-body">Loading…</div>;
  }

  const empty = practice && songs.length === 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand">DBK Stage Control</div>
          <div className="brand-version">v {__APP_VERSION__}</div>
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
        <button
          type="button"
          className={`lyrics-btn${practice ? " on" : ""}`}
          aria-pressed={practice}
          onClick={() => {
            if (!practice) leaveStage();
          }}
        >
          PRACTICE
        </button>
        <button
          type="button"
          className={`lyrics-btn${!practice ? " on" : ""}`}
          aria-pressed={!practice}
          onClick={() => {
            if (practice && syncHost) joinStage(syncHost);
            else if (practice) setMasterPage("lan");
          }}
        >
          STAGE
        </button>
        <div className="grow" />
        <span className="badge">{practice ? "PRACTICE" : "STAGE"}</span>
        <button
          type="button"
          className={`lyrics-btn${page === "lan" ? " on" : syncConnected ? " lan-ok" : " lan-warn"}`}
          aria-pressed={page === "lan"}
          onClick={() => setMasterPage(page === "lan" ? "lyrics" : "lan")}
        >
          SONGS
        </button>
      </header>
      {page !== "lan" && practice && !empty ? (
        <div className="app-transport">
          <PrepTransport />
        </div>
      ) : null}
      {page !== "lan" && !practice && gigId ? (
        <div className="app-transport">
          <StageViewChrome />
        </div>
      ) : null}
      {empty && page !== "lan" ? (
        <ClientLibrary />
      ) : page === "lan" ? (
        <ClientLibrary />
      ) : (
        <div className="client-main">
          <div className="client-stage">
            {page === "nota" ? (
              <NotaView />
            ) : page === "chords" ? (
              <ChordView />
            ) : page === "drums" ? (
              <DrumView />
            ) : (
              <LyricsView />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
