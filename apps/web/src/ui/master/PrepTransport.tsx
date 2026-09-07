import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import {
  entryPlayMode,
  hasBackingAudio,
  isSongEntry,
  measureStartTimes,
  PlaybackState,
  PlayMode,
  practiceMasterAudio,
  sectionAt,
  sectionNamed
} from "@dbk/core";
import {
  currentGig,
  isStageContentPage,
  STAGE_ZOOM_MAX,
  STAGE_ZOOM_MIN,
  unlockAudio,
  useMasterStore
} from "../../store/master-store";
import {
  AutoScrollIcon,
  EditSectionsIcon,
  PauseIcon,
  PlayIcon,
  StopIcon
} from "../shared/icons";
import { sectionBarClass } from "./section-color";

export function StageSetlistButton() {
  const setlistOpen = useMasterStore((s) => s.setlistOpen);
  const toggleSetlistOpen = useMasterStore((s) => s.toggleSetlistOpen);
  return (
    <button
      type="button"
      className={`lyrics-btn${setlistOpen ? " on" : ""}`}
      aria-pressed={setlistOpen}
      onClick={toggleSetlistOpen}
    >
      SETLIST
    </button>
  );
}

export function StageViewTools() {
  const page = useMasterStore((s) => s.masterPage);
  const readOnly = useMasterStore((s) => s.deviceKind === "client");
  const zoom = useMasterStore((s) =>
    isStageContentPage(s.masterPage) ? s.stageZooms[s.masterPage] : 1
  );
  const autoScroll = useMasterStore((s) => s.autoScroll);
  const editOpen = useMasterStore((s) => s.editOpen);
  const zoomIn = useMasterStore((s) => s.zoomIn);
  const zoomOut = useMasterStore((s) => s.zoomOut);
  const toggleAutoScroll = useMasterStore((s) => s.toggleAutoScroll);
  const toggleEditOpen = useMasterStore((s) => s.toggleEditOpen);
  const fadeStop = useMasterStore((s) => s.fadeStop);
  return (
    <div className="prep-transport-tools">
      {!readOnly ? (
        <button
          type="button"
          className="fade-stop-btn"
          title="Fade out and stop"
          aria-label="Fade out and stop"
          onClick={fadeStop}
        >
          FADE STOP
        </button>
      ) : null}
      {page === "nota" && !readOnly ? (
        <button
          type="button"
          className={`icon-btn${editOpen ? " on" : ""}`}
          title="Edit sections"
          aria-label="Edit sections"
          aria-pressed={editOpen}
          onClick={toggleEditOpen}
        >
          <EditSectionsIcon />
        </button>
      ) : null}
      <button
        type="button"
        className="icon-btn"
        title="Zoom out"
        aria-label="Zoom out"
        disabled={zoom <= STAGE_ZOOM_MIN}
        onClick={zoomOut}
      >
        −
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Zoom in"
        aria-label="Zoom in"
        disabled={zoom >= STAGE_ZOOM_MAX}
        onClick={zoomIn}
      >
        +
      </button>
      <button
        type="button"
        className={`icon-btn${autoScroll ? " on" : ""}`}
        title="Auto Scroll"
        aria-label="Auto Scroll"
        aria-pressed={autoScroll}
        onClick={toggleAutoScroll}
      >
        <AutoScrollIcon />
      </button>
    </div>
  );
}

export function StageViewChrome() {
  return (
    <div className="prep-transport stage-view-chrome">
      <StageSetlistButton />
      <StageViewTools />
    </div>
  );
}

export function PrepTransport() {
  const songs = useMasterStore((s) => s.songs);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const deviceKind = useMasterStore((s) => s.deviceKind);
  const clientSession = useMasterStore((s) => s.clientSession);
  const gig = useMasterStore(currentGig);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const playback = useMasterStore((s) => s.playback);
  const previewTime = useMasterStore((s) => s.previewTime);
  const metronomePlaying = useMasterStore((s) => s.metronomePlaying);
  const masterPage = useMasterStore((s) => s.masterPage);
  const seek = useMasterStore((s) => s.seek);
  const practiceClient = deviceKind === "client" && clientSession === "practice";
  const playFromPointer = useRef(false);
  const pendingMeasureRef = useRef<number | null>(null);
  const [pendingMeasure, setPendingMeasure] = useState<number | null>(null);
  const showStageChrome = isStageContentPage(masterPage);

  const selected = selectedEntryId
    ? gig?.setlist.find((entry) => entry.entryId === selectedEntryId)
    : undefined;
  const selectedIndex = selected && gig ? gig.setlist.indexOf(selected) : -1;
  const song =
    selected && isSongEntry(selected) ? songs.find((item) => item.id === selected.songId) : undefined;
  const masterFiles = song
    ? [...(fileIndex[song.id] ?? []), ...(song.folder ? (fileIndex[song.folder] ?? []) : [])]
    : [];
  const hasMasterMix = Boolean(practiceMasterAudio(masterFiles));
  const metronomeMode = practiceClient
    ? false
    : !selected ||
      !isSongEntry(selected) ||
      !hasBackingAudio(song, song ? fileIndex[song.id] : undefined) ||
      entryPlayMode(selected) === PlayMode.View;
  const playing =
    playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
  const clockMatches = Boolean(selected && playback.clock?.setlistEntryId === selected.entryId);
  const showStop =
    playing && (clockMatches || playback.currentIndex === selectedIndex || !playback.clock);
  const selectedTime = clockMatches ? (playback.clock?.time ?? previewTime) : previewTime;
  const serbestHold =
    !metronomeMode &&
    !playing &&
    sectionNamed(sectionAt(song?.sections ?? [], selectedTime), "SERBEST");
  const buttonMode = metronomeMode
    ? metronomePlaying
      ? "stop"
      : "play"
    : showStop
      ? "stop"
      : serbestHold
        ? "pause"
        : "play";

  const toggleMetronome = () => {
    const state = useMasterStore.getState();
    if (state.metronomePlaying) state.stopMetronome(true);
    else state.startMetronome();
  };

  const togglePlayback = () => {
    const state = useMasterStore.getState();
    if (practiceClient) {
      if (state.playback.state === PlaybackState.Playing) state.pausePractice();
      else void state.playPractice();
      return;
    }
    if (state.playback.state === PlaybackState.Loading) return;
    const selectedEntry = state.selectedEntryId
      ? currentGig(state)?.setlist.find((entry) => entry.entryId === state.selectedEntryId)
      : undefined;
    const gigNow = currentGig(state);
    const index = selectedEntry && gigNow ? gigNow.setlist.indexOf(selectedEntry) : -1;
    const playingNow =
      state.playback.state === PlaybackState.Playing ||
      state.playback.state === PlaybackState.Transitioning;
    const sameSong =
      Boolean(selectedEntry && state.playback.clock?.setlistEntryId === selectedEntry.entryId) ||
      state.playback.currentIndex === index;
    if (playingNow && sameSong) state.pause();
    else void state.playSelected();
  };

  const onPlayPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    playFromPointer.current = true;
    unlockAudio();
  };

  const onPlayClick = (toggle: () => void) => {
    if (playFromPointer.current) {
      playFromPointer.current = false;
      toggle();
      return;
    }
    toggle();
  };
  const canPlay = practiceClient ? hasMasterMix : Boolean(song);
  const sections = song?.sections ?? [];
  const timelineStart = 0;
  const timelineEnd = sections.reduce(
    (end, section) => Math.max(end, section.end),
    song?.duration ?? 0
  );
  const timelineLength = Math.max(0.001, timelineEnd - timelineStart);
  const measureStarts = song ? measureStartTimes(song.tempoMap, song.duration) : [0];
  let measureIndex = 0;
  for (let index = 0; index < measureStarts.length; index++) {
    if ((measureStarts[index] ?? 0) <= selectedTime + 0.02) measureIndex = index;
    else break;
  }
  const displayedMeasure = pendingMeasure ?? measureIndex;
  const activeMeasureStart = measureStarts[displayedMeasure] ?? 0;
  const activeMeasureEnd = measureStarts[displayedMeasure + 1] ?? timelineEnd;
  const commitPosition = () => {
    const index = pendingMeasureRef.current;
    if (index === null) return;
    seek(measureStarts[index] ?? 0);
    pendingMeasureRef.current = null;
    setPendingMeasure(null);
  };

  return (
    <div className={`prep-transport${metronomeMode ? " metro" : ""}`}>
      {showStageChrome ? <StageSetlistButton /> : null}
      <button
        type="button"
        className={`add prep-play ${buttonMode}`}
        title={buttonMode === "stop" ? "Stop" : buttonMode === "pause" ? "Continue after SERBEST" : "Play"}
        aria-label={buttonMode === "stop" ? "Stop" : buttonMode === "pause" ? "Continue after SERBEST" : "Play"}
        disabled={!canPlay}
        onPointerDown={onPlayPointerDown}
        onClick={() => onPlayClick(metronomeMode ? toggleMetronome : togglePlayback)}
      >
        {buttonMode === "stop" ? <StopIcon /> : buttonMode === "pause" ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="prep-now-track" title={song?.title}>
        <div className="prep-now-sections" aria-hidden="true">
          {sections.map((section, index) => (
            <span
              key={`${section.start}-${section.end}-${section.name}-${index}`}
              className={`prep-transport-section${sectionBarClass(section.name)}`}
              style={
                {
                  left: `${((section.start - timelineStart) / timelineLength) * 100}%`,
                  width: `calc(${((section.end - section.start) / timelineLength) * 100}% - 2px)`
                } as CSSProperties
              }
            />
          ))}
        </div>
        {song ? (
          <span
            className="prep-position-head"
            aria-hidden="true"
            style={{
              left: `${(activeMeasureStart / timelineLength) * 100}%`,
              width: `${((activeMeasureEnd - activeMeasureStart) / timelineLength) * 100}%`
            }}
          />
        ) : null}
        <input
          className="prep-position-slider"
          type="range"
          min={0}
          max={timelineEnd}
          step="any"
          value={activeMeasureStart}
          disabled={!song}
          aria-label="Song position by measure"
          onChange={(event) => {
            const target = Number(event.target.value);
            const index = measureStarts.reduce(
              (best, time, candidate) =>
                Math.abs(time - target) < Math.abs((measureStarts[best] ?? 0) - target)
                  ? candidate
                  : best,
              0
            );
            pendingMeasureRef.current = index;
            setPendingMeasure(index);
          }}
          onPointerUp={commitPosition}
          onPointerCancel={() => {
            pendingMeasureRef.current = null;
            setPendingMeasure(null);
          }}
          onKeyUp={commitPosition}
          onBlur={commitPosition}
        />
        <div className="prep-now-overlay">
          <div className="prep-now-copy">
            <span className="prep-now-title">{song?.title ?? "—"}</span>
          </div>
        </div>
      </div>
      {showStageChrome ? <StageViewTools /> : null}
    </div>
  );
}
