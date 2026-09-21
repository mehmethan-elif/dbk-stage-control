import { useEffect, useRef } from "react";
import { bandRoster, lanRosterState } from "@dbk/core";
import { currentGig, useMasterStore } from "../../store/master-store";
import {
  BassIcon,
  ChordIcon,
  DrumsIcon,
  EditSectionsIcon,
  LyricsIcon,
  MixerIcon,
  PreparationIcon,
  ScoreIcon,
  SpeakerMonitorIcon,
  StageConnectIcon
} from "../shared/icons";
import { AudioView } from "./AudioView";
import { ChordView } from "./ChordView";
import { DrumView } from "./DrumView";
import { LanView } from "./LanView";
import { useNavigatorOnline } from "../shared/BandRoster";
import { LyricsView } from "./LyricsView";
import { MixerView } from "./MixerView";
import { NotaViewAsync, usePdfWarmup } from "./lazy-pdf";
import { PdfExportButton } from "./pdf-export/PdfExportButton";
import { FadeButton, PanicButton, PrepTransport, StageSetlistButton, StageViewTools } from "./PrepTransport";
import { PrepView } from "./PrepView";
import { isNativeApp } from "../../native/platform";
import { LibraryMissing } from "../native/LibraryMissing";
import { ConcertTime } from "../shared/ConcertTime";
import { holdLibraryLoading, LibraryLoading } from "../shared/LibraryLoading";
import { StageCrashGuard } from "../shared/StageCrashGuard";
import { useStagePinchZoom } from "./stage-zoom";

export function MasterApp() {
  usePdfWarmup();
  useStagePinchZoom();
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
  const loadTries = useRef(0);

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
        <div className="topbar-transport-actions">
          <FadeButton />
          <PanicButton />
        </div>
        <StageSetlistButton />
        <button
          type="button"
          className={`lyrics-btn page-icon${masterPage === "prep" ? " on" : ""}`}
          title="Preparation"
          aria-label="Preparation"
          aria-pressed={masterPage === "prep"}
          onClick={() => setMasterPage("prep")}
        >
          <PreparationIcon />
        </button>
        <button
          type="button"
          className={`lyrics-btn page-icon${masterPage === "lyrics" ? " on" : ""}`}
          title="Lyrics"
          aria-label="Lyrics"
          aria-pressed={masterPage === "lyrics"}
          onClick={() => setMasterPage(masterPage === "lyrics" ? "prep" : "lyrics")}
        >
          <LyricsIcon />
        </button>
        <button
          type="button"
          className={`lyrics-btn page-icon${masterPage === "nota" ? " on" : ""}`}
          title="Score"
          aria-label="Score"
          aria-pressed={masterPage === "nota"}
          onClick={() => setMasterPage(masterPage === "nota" ? "prep" : "nota")}
        >
          <ScoreIcon />
        </button>
        <button
          type="button"
          className={`lyrics-btn page-icon${masterPage === "chords" ? " on" : ""}`}
          title="Chord"
          aria-label="Chord"
          aria-pressed={masterPage === "chords"}
          onClick={() => setMasterPage(masterPage === "chords" ? "prep" : "chords")}
        >
          <ChordIcon />
        </button>
        <button
          type="button"
          className={`lyrics-btn page-icon${masterPage === "bass" ? " on" : ""}`}
          title="Bass"
          aria-label="Bass"
          aria-pressed={masterPage === "bass"}
          onClick={() => setMasterPage(masterPage === "bass" ? "prep" : "bass")}
        >
          <BassIcon />
        </button>
        <button
          type="button"
          className={`lyrics-btn page-icon${masterPage === "drums" ? " on" : ""}`}
          title="Drums"
          aria-label="Drums"
          aria-pressed={masterPage === "drums"}
          onClick={() => setMasterPage(masterPage === "drums" ? "prep" : "drums")}
        >
          <DrumsIcon />
        </button>
        <div className="grow" />
        <div className="mode-toggle">
          <button
            className={editOpen && masterPage === "nota" ? "on" : ""}
            title="Edit sections"
            aria-label="Edit sections"
            aria-pressed={editOpen && masterPage === "nota"}
            onClick={() => {
              // The boxes are drawn on the score PDF, so this only has anything to edit there.
              if (masterPage !== "nota") {
                setMasterPage("nota");
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
        </div>
        <PdfExportButton />
        <StageViewTools />
        <ConcertTime />
        <button
          type="button"
          className={`lyrics-btn page-icon${masterPage === "lan" ? " on" : lanState === "ready" ? " lan-ok" : lanState === "problem" ? " lan-bad" : " lan-warn"}`}
          title="LAN"
          aria-label="LAN"
          aria-pressed={masterPage === "lan"}
          onClick={() => setMasterPage(masterPage === "lan" ? "prep" : "lan")}
        >
          <StageConnectIcon />
        </button>
      </header>
      <div className="app-transport">
        <PrepTransport />
      </div>
      <StageCrashGuard label={masterPage} resetKey={masterPage}>
        {masterPage === "mixer" ? (
          <MixerView />
        ) : masterPage === "audio" ? (
          <AudioView />
        ) : masterPage === "lyrics" ? (
          <LyricsView />
        ) : masterPage === "chords" || masterPage === "bass" ? (
          <ChordView key={masterPage} />
        ) : masterPage === "nota" ? (
          <NotaViewAsync layer="score" />
        ) : masterPage === "drums" ? (
          <DrumView />
        ) : masterPage === "lan" ? (
          <LanView />
        ) : (
          <PrepView />
        )}
      </StageCrashGuard>
    </div>
  );
}
