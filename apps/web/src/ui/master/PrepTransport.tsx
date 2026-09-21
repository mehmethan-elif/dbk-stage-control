import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  effectivePlayMode,
  hasClickFlac,
  hasPlaybackAudio,
  ELIF_KONUSMA_LABEL,
  isSongEntry,
  isTalkEntry,
  talkDisplayLabel,
  PlaybackState,
  PlayMode,
  sectionAt,
  sectionNamed,
  songDisplayName,
  withKeyChangeElifs,
  type Song
} from "@dbk/core";
import { practiceEntryId } from "../../practice/gig";
import { findSongByRef } from "../../store/song-library";
import { nextTransportEntry } from "./next-song-section";
import { useFollowPlayheadTime } from "../../store/follow-clock";
import {
  clientPracticeMode,
  clientStageLive,
  currentGig,
  followsMasterMetroVisuals,
  livePerformanceEntryId,
  liveSongIsBackingTracks,
  isStageContentPage,
  stagePageCanZoom,
  panicBlocksFollow,
  practicePlaysMasterMix,
  songPlaying,
  songShowsPositionSlider,
  STAGE_ZOOM_MAX,
  STAGE_ZOOM_MIN,
  STAGE_ZOOM_STEP,
  unlockAudio,
  followsSharedPlayhead,
  useMasterStore,
  usesContinuousMetroTransport,
  usesFreeMetroTransport
} from "../../store/master-store";
import { DockLeftIcon, MagnifierIcon, PauseIcon, PlayIcon, StopIcon } from "../shared/icons";
import { PlayModeMark } from "./play-mode-mark";
import { SongPositionTrack } from "./SongPositionTrack";

function TransportSongSlot(props: {
  play?: ReactNode;
  song?: Song;
  files?: string[];
  setlistMode?: string;
  title: string;
  className?: string;
  showIcon?: boolean;
  track?: ReactNode;
}) {
  return (
    <div className={`prep-song-slot${props.className ? ` ${props.className}` : ""}`}>
      {props.play}
      {props.showIcon && props.song ? (
        <PlayModeMark song={props.song} files={props.files} setlistMode={props.setlistMode} />
      ) : null}
      {props.track ?? <span className="prep-now-title">{props.title}</span>}
    </div>
  );
}

export function StageSetlistButton() {
  const setlistOpen = useMasterStore((s) => s.setlistOpen);
  const toggleSetlistOpen = useMasterStore((s) => s.toggleSetlistOpen);
  return (
    <button
      type="button"
      className={`lyrics-btn page-icon${setlistOpen ? " on" : ""}`}
      title="Setlist"
      aria-label="Setlist"
      aria-pressed={setlistOpen}
      onClick={toggleSetlistOpen}
    >
      <DockLeftIcon />
    </button>
  );
}

export function PanicButton() {
  const panicActive = useMasterStore((s) => s.panicActive);
  const playing = useMasterStore(songPlaying);
  const setPanic = useMasterStore((s) => s.setPanic);
  return (
    <button
      type="button"
      className={`panic-btn${panicActive ? " on" : ""}`}
      title={
        !playing
          ? "Panic is available while a song is playing"
          : panicActive
            ? "Leave panic at the red section"
            : "Panic: click only, pick the live section"
      }
      aria-label="Panic"
      aria-pressed={panicActive}
      disabled={!playing}
      onClick={() => setPanic(!panicActive)}
    >
      PANIC
    </button>
  );
}

export function FadeButton() {
  const fadeStop = useMasterStore((s) => s.fadeStop);
  return (
    <button
      type="button"
      className="fade-stop-btn"
      title="Fade out and stop"
      aria-label="Fade out and stop"
      onClick={fadeStop}
    >
      FADE
    </button>
  );
}

export function StageViewTools() {
  const zoom = useMasterStore((s) =>
    isStageContentPage(s.masterPage) ? s.stageZooms[s.masterPage] : 1
  );
  const canZoom = useMasterStore((s) => stagePageCanZoom(s.masterPage));
  const setStageZoom = useMasterStore((s) => s.setStageZoom);
  const percent = Math.round(zoom * 100);

  // The score does not zoom, so it carries no controls for it either.
  if (!canZoom) return null;

  return (
    <div className="prep-transport-tools zoom-tools">
      <button
        type="button"
        className="lyrics-btn page-icon zoom-step"
        title={`Zoom out (${percent}%)`}
        aria-label="Zoom out"
        disabled={zoom <= STAGE_ZOOM_MIN}
        onClick={() => setStageZoom(zoom - STAGE_ZOOM_STEP)}
      >
        <MagnifierIcon mark="minus" />
      </button>
      <button
        type="button"
        className="lyrics-btn page-icon zoom-step"
        title={`Zoom in (${percent}%)`}
        aria-label="Zoom in"
        disabled={zoom >= STAGE_ZOOM_MAX}
        onClick={() => setStageZoom(zoom + STAGE_ZOOM_STEP)}
      >
        <MagnifierIcon mark="plus" />
      </button>
    </div>
  );
}

export function PrepTransport() {
  const songs = useMasterStore((s) => s.songs);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const deviceKind = useMasterStore((s) => s.deviceKind);
  const gig = useMasterStore(currentGig);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const playback = useMasterStore((s) => s.playback);
  const previewTime = useMasterStore((s) => s.previewTime);
  const metronomePlaying = useMasterStore((s) => s.metronomePlaying);
  const detached = useMasterStore(followsSharedPlayhead);
  const practiceClient = useMasterStore(clientPracticeMode);
  const liveClient = useMasterStore(clientStageLive);
  const playMasterMix = useMasterStore(practicePlaysMasterMix);
  const continuousMetro = useMasterStore(usesContinuousMetroTransport);
  const liveMetroVisuals = useMasterStore(followsMasterMetroVisuals);
  const backingLive = useMasterStore(liveSongIsBackingTracks);
  const performanceEntryId = useMasterStore(livePerformanceEntryId);
  const freeMode = useMasterStore(usesFreeMetroTransport);
  const showPlayButtons = !liveClient;
  const panicOn = useMasterStore(panicBlocksFollow);
  const displayedEntries = gig ? withKeyChangeElifs(gig.setlist, songs) : [];
  const nextEntry = nextTransportEntry(displayedEntries, selectedEntryId ?? undefined);
  const nextSongId = nextEntry && isSongEntry(nextEntry) ? nextEntry.entryId : null;
  const selectedDisplayed = selectedEntryId
    ? displayedEntries.find((entry) => entry.entryId === selectedEntryId)
    : undefined;
  const currentIsTalk = Boolean(
    (selectedDisplayed && isTalkEntry(selectedDisplayed)) || selectedEntryId?.startsWith("elif_")
  );
  const playFromPointer = useRef(false);
  const playing =
    playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
  const selected = selectedEntryId
    ? gig?.setlist.find((entry) => entry.entryId === selectedEntryId)
    : undefined;
  const liveEntry =
    detached && playing && playback.clock?.setlistEntryId
      ? gig?.setlist.find((entry) => entry.entryId === playback.clock?.setlistEntryId)
      : undefined;
  const performanceEntry = performanceEntryId
    ? gig?.setlist.find((entry) => entry.entryId === performanceEntryId)
    : undefined;
  const displayEntry = liveClient ? (performanceEntry ?? selected) : (liveEntry ?? selected);
  const selectedIndex = selected && gig ? gig.setlist.indexOf(selected) : -1;
  const song =
    (displayEntry && isSongEntry(displayEntry) ? findSongByRef(songs, displayEntry.songId) : undefined) ??
    songs.find(
      (item) =>
        Boolean(selectedEntryId) &&
        (practiceEntryId(item.id) === selectedEntryId ||
          practiceEntryId(item.folder ?? "") === selectedEntryId ||
          item.id === selectedEntryId)
    ) ??
    (selectedEntryId?.startsWith("practice_")
      ? findSongByRef(songs, selectedEntryId.slice("practice_".length))
      : undefined);
  const selectedFiles = song
    ? [...(fileIndex[song.id] ?? []), ...(song.folder ? (fileIndex[song.folder] ?? []) : [])]
    : undefined;
  const selectedMode = displayEntry && isSongEntry(displayEntry)
    ? effectivePlayMode(song, selectedFiles, gig?.performanceMode)
    : PlayMode.View;
  const metronomeMode = liveClient
    ? liveMetroVisuals
    : playMasterMix || backingLive
      ? false
      : freeMode || practiceClient
        ? true
        : !displayEntry ||
          !isSongEntry(displayEntry) ||
          selectedMode === PlayMode.View ||
          (selectedMode === PlayMode.Playback && !hasPlaybackAudio(song, selectedFiles));
  const dualVisualMetro = metronomeMode;
  const clockMatches = Boolean(displayEntry && playback.clock?.setlistEntryId === displayEntry.entryId);
  const showStop =
    playing &&
    (detached || clockMatches || playback.currentIndex === selectedIndex || !playback.clock);
  const storePlayhead =
    metronomePlaying || !playing
      ? previewTime
      : liveClient || clockMatches || detached
        ? (playback.clock?.time ?? previewTime)
        : previewTime;
  // Only the idle SERBEST check reads this, so there is no reason to animate it mid-song.
  const selectedTime = useFollowPlayheadTime(storePlayhead, !playing);
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
    if (state.metronomePlaying) state.stopMetronome();
    else state.startMetronome();
  };

  useEffect(() => {
    if (freeMode) {
      useMasterStore.getState().syncFreeVisualMetronome();
      return;
    }
    if (dualVisualMetro) return;
    if (backingLive) return;
    if (metronomePlaying) return;
    useMasterStore.getState().previewContinuousNextMetronome();
  }, [backingLive, continuousMetro, dualVisualMetro, freeMode, metronomePlaying, selectedEntryId, nextSongId]);

  const togglePlayback = () => {
    const state = useMasterStore.getState();
    if (practicePlaysMasterMix(state)) {
      if (state.playback.state === PlaybackState.Playing) state.pausePractice();
      else void state.playPractice();
      return;
    }
    if (practiceClient) {
      if (state.metronomePlaying) state.stopMetronome();
      else state.startMetronome();
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
    if (playingNow && (detached || sameSong)) state.pause();
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
  const canPlay = Boolean(song) && !currentIsTalk;
  const currentTitle =
    currentIsTalk && selectedDisplayed && isTalkEntry(selectedDisplayed)
      ? talkDisplayLabel(selectedDisplayed)
      : currentIsTalk
        ? ELIF_KONUSMA_LABEL
        : song
          ? songDisplayName(song)
          : "—";
  const showCurrentSlider = Boolean(
    song && !currentIsTalk && songShowsPositionSlider(song, selectedFiles, gig?.performanceMode)
  );
  const showPanic =
    !practiceClient &&
    !metronomeMode &&
    Boolean(song && hasClickFlac(song, selectedFiles));
  const currentPlay = showPlayButtons && !currentIsTalk ? (
    <button
      type="button"
      className={`add prep-play ${buttonMode}${buttonMode === "stop" ? " is-playing" : ""}${
        panicOn ? " is-half" : ""
      }`}
      title={buttonMode === "stop" ? "Stop" : buttonMode === "pause" ? "Continue after SERBEST" : "Play"}
      aria-label={buttonMode === "stop" ? "Stop" : buttonMode === "pause" ? "Continue after SERBEST" : "Play"}
      disabled={!canPlay}
      onPointerDown={onPlayPointerDown}
      onClick={() => onPlayClick(metronomeMode ? toggleMetronome : togglePlayback)}
    >
      {buttonMode === "stop" ? <StopIcon /> : buttonMode === "pause" ? <PauseIcon /> : <PlayIcon />}
    </button>
  ) : null;
  return (
    <div
      className={`prep-transport is-current-only${panicOn ? " is-panic" : ""}${metronomeMode ? " metro" : ""}${continuousMetro || liveMetroVisuals ? " is-continuous-metro" : ""}${freeMode ? " is-free-metro" : ""}`}
    >
      {deviceKind === "master" ? null : showPanic ? <PanicButton /> : null}
      <TransportSongSlot
        className="is-current"
        play={currentPlay}
        song={currentIsTalk ? undefined : song}
        files={selectedFiles}
        setlistMode={gig?.performanceMode}
        title={currentTitle}
        showIcon={!showCurrentSlider && !currentIsTalk && Boolean(song)}
        track={
          showCurrentSlider ? (
            <SongPositionTrack
              song={song}
              showTitle
              title={currentTitle}
              icon={
                song ? (
                  <PlayModeMark song={song} files={selectedFiles} setlistMode={gig?.performanceMode} />
                ) : null
              }
            />
          ) : undefined
        }
      />
    </div>
  );
}
