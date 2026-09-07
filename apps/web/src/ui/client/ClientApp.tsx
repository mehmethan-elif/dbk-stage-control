import { useEffect, useRef, useState } from "react";
import { PlaybackState, practiceMasterAudio, songDisplayName } from "@dbk/core";
import { practiceEntryId } from "../../practice/gig";
import { useMasterStore } from "../../store/master-store";
import { ChronometerIcon, PauseIcon, PlayIcon, StopIcon } from "../shared/icons";
import { ChordView } from "../master/ChordView";
import { DrumView } from "../master/DrumView";
import { LyricsView } from "../master/LyricsView";
import { NotaView } from "../master/NotaView";
import { StageViewChrome } from "../master/PrepTransport";
import { ClientLibrary } from "./ClientLibrary";
import { PracticeImport } from "./PracticeImport";

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

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export function ClientApp() {
  const ready = useMasterStore((s) => s.ready);
  const gigId = useMasterStore((s) => s.gigId);
  const masterPage = useMasterStore((s) => s.masterPage);
  const setMasterPage = useMasterStore((s) => s.setMasterPage);
  const syncConnected = useMasterStore((s) => s.syncConnected);
  const songs = useMasterStore((s) => s.songs);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const clientSession = useMasterStore((s) => s.clientSession);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const previewTime = useMasterStore((s) => s.previewTime);
  const playback = useMasterStore((s) => s.playback);
  const selectPracticeSong = useMasterStore((s) => s.selectPracticeSong);
  const playPractice = useMasterStore((s) => s.playPractice);
  const pausePractice = useMasterStore((s) => s.pausePractice);
  const seekPractice = useMasterStore((s) => s.seekPractice);
  const leaveStage = useMasterStore((s) => s.leaveStage);
  const joinStage = useMasterStore((s) => s.joinStage);
  const syncHost = useMasterStore((s) => s.syncHost);
  const practiceBusy = useMasterStore((s) => s.practiceBusy);
  const importPracticePackage = useMasterStore((s) => s.importPracticePackage);
  const importPracticeFolder = useMasterStore((s) => s.importPracticeFolder);
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
  const current = songs.find((song) => selectedEntryId === practiceEntryId(song.id));
  const hasMaster = Boolean(
    current &&
      (practiceMasterAudio(fileIndex[current.id] ?? []) ||
        practiceMasterAudio(fileIndex[current.folder] ?? []))
  );
  const playing = playback.state === PlaybackState.Playing;
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
        <div className="app-transport client-practice-bar">
          <button
            type="button"
            className={`add prep-play ${playing ? "stop" : "play"}`}
            disabled={!hasMaster}
            title={playing ? "Pause" : "Play Master mix"}
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => {
              if (playing) pausePractice();
              else void playPractice();
            }}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className="add prep-play"
            disabled={!hasMaster}
            title="Stop"
            aria-label="Stop"
            onClick={() => {
              pausePractice();
              seekPractice(0);
            }}
          >
            <StopIcon />
          </button>
          <input
            className="client-practice-slider"
            type="range"
            min={0}
            max={Math.max(1, current?.duration ?? 1)}
            step="any"
            value={previewTime}
            disabled={!hasMaster}
            aria-label="Practice position"
            onChange={(event) => seekPractice(Number(event.target.value))}
          />
          <span className="client-practice-time">
            {formatClock(previewTime)} · {songDisplayName(current)}
            {hasMaster ? "" : " · no Master mix"}
          </span>
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
        <div className={`client-main${practice ? " is-practice" : ""}`}>
          {practice ? (
            <aside className="client-song-list" aria-label="Practice songs">
              <PracticeImport
                compact
                importZip={importPracticePackage}
                importFolder={importPracticeFolder}
                busy={practiceBusy}
              />
              {songs.map((song) => (
                <button
                  key={song.id}
                  type="button"
                  className={`client-song-btn${current?.id === song.id ? " on" : ""}`}
                  onClick={() => selectPracticeSong(song.id)}
                >
                  {songDisplayName(song)}
                </button>
              ))}
            </aside>
          ) : null}
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
