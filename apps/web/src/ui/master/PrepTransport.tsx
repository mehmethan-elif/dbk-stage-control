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
import { CONCERT_FINAL_LABEL } from "./setlist-marker";
import { useFollowPlayheadTime } from "../../store/follow-clock";
import {
  clientPracticeMode,
  clientStageLive,
  currentGig,
  followsFreeMasterClicks,
  followsMasterMetroVisuals,
  livePerformanceEntryId,
  liveSongIsBackingTracks,
  isStageContentPage,
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
import { MetroPulse } from "./song-metro-beats";
import { SongPositionTrack } from "./SongPositionTrack";

function TransportSongSlot(props: {
  play?: ReactNode;
  song?: Song;
  files?: string[];
  setlistMode?: string;
  title: string;
  className?: string;
  showIcon?: boolean;
  showPulse?: boolean;
  pulseActive?: boolean;
  pulseTone?: "current" | "next";
  follow?: "sound" | "playback";
  track?: ReactNode;
}) {
  return (
    <div className={`prep-song-slot${props.className ? ` ${props.className}` : ""}`}>
      {props.showPulse ? (
        <span className="prep-song-click">
          <MetroPulse
            song={props.song}
            active={Boolean(props.pulseActive)}
            follow={props.follow}
            tone={props.pulseTone}
          />
        </span>
      ) : null}
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

const ZOOM_DRAG_PX = 20;

export function StageViewTools() {
  const zoom = useMasterStore((s) =>
    isStageContentPage(s.masterPage) ? s.stageZooms[s.masterPage] : 1
  );
  const setStageZoom = useMasterStore((s) => s.setStageZoom);
  const dragging = useRef(false);
  const originY = useRef(0);
  const originZoom = useRef(1);
  const [held, setHeld] = useState(false);
  const percent = Math.round(zoom * 100);

  const endDrag = () => {
    dragging.current = false;
    setHeld(false);
  };

  return (
    <div className="prep-transport-tools">
      <button
        type="button"
        className={`lyrics-btn page-icon zoom-drag${held ? " on" : ""}`}
        title={`Zoom ${percent}%. Drag up to zoom in, down to zoom out`}
        aria-label="Zoom"
        role="slider"
        aria-orientation="vertical"
        aria-valuemin={Math.round(STAGE_ZOOM_MIN * 100)}
        aria-valuemax={Math.round(STAGE_ZOOM_MAX * 100)}
        aria-valuenow={percent}
        aria-valuetext={`${percent} percent`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          dragging.current = true;
          originY.current = event.clientY;
          originZoom.current = zoom;
          event.currentTarget.setPointerCapture(event.pointerId);
          setHeld(true);
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          setStageZoom(
            originZoom.current + ((originY.current - event.clientY) / ZOOM_DRAG_PX) * STAGE_ZOOM_STEP
          );
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onWheel={(event) => {
          event.preventDefault();
          const state = useMasterStore.getState();
          const current = isStageContentPage(state.masterPage)
            ? state.stageZooms[state.masterPage]
            : 1;
          setStageZoom(current + (event.deltaY < 0 ? STAGE_ZOOM_STEP : -STAGE_ZOOM_STEP));
        }}
      >
        <MagnifierIcon />
      </button>
    </div>
  );
}

export function PrepTransport() {
  const songs = useMasterStore((s) => s.songs);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const deviceKind = useMasterStore((s) => s.deviceKind);
  const masterPage = useMasterStore((s) => s.masterPage);
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
  const followFreeClicks = useMasterStore(followsFreeMasterClicks);
  const showPlayButtons = !liveClient;
  const prepTransport = masterPage === "prep";
  const panicOn = useMasterStore(panicBlocksFollow);
  const displayedEntries = gig ? withKeyChangeElifs(gig.setlist, songs) : [];
  const nextEntry = nextTransportEntry(displayedEntries, selectedEntryId ?? undefined);
  const nextIsTalk = Boolean(nextEntry && isTalkEntry(nextEntry));
  const nextSong =
    nextEntry && isSongEntry(nextEntry) ? findSongByRef(songs, nextEntry.songId) : undefined;
  const nextSongId = nextEntry && isSongEntry(nextEntry) ? nextEntry.entryId : null;
  const selectedDisplayed = selectedEntryId
    ? displayedEntries.find((entry) => entry.entryId === selectedEntryId)
    : undefined;
  const currentIsTalk = Boolean(
    (selectedDisplayed && isTalkEntry(selectedDisplayed)) || selectedEntryId?.startsWith("elif_")
  );
  const nextTitle =
    nextIsTalk && nextEntry && isTalkEntry(nextEntry)
      ? talkDisplayLabel(nextEntry)
      : nextSong
        ? songDisplayName(nextSong)
        : CONCERT_FINAL_LABEL;
  const showNextSongPulse = Boolean(nextSong) && !nextIsTalk;
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
  const selectedTime = useFollowPlayheadTime(storePlayhead);
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

  const playNextSong = () => {
    if (!nextSongId) return;
    const state = useMasterStore.getState();
    state.selectSetlistEntry(nextSongId, { playNext: true });
    const next = useMasterStore.getState();
    if (practicePlaysMasterMix(next)) void next.playPractice();
    else if (next.deviceKind === "client") next.startMetronome(0);
    else void next.playSelected();
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
  const nextFiles = nextSong
    ? [...(fileIndex[nextSong.id] ?? []), ...(nextSong.folder ? (fileIndex[nextSong.folder] ?? []) : [])]
    : undefined;
  const currentPulseActive = Boolean(song) && !currentIsTalk;
  const nextPulseActive = showNextSongPulse;
  const showCurrentSlider = Boolean(
    song &&
      !currentIsTalk &&
      songShowsPositionSlider(song, selectedFiles, gig?.performanceMode) &&
      (panicOn || !isStageContentPage(masterPage))
  );
  const currentFollow =
    metronomePlaying || (freeMode && followFreeClicks)
      ? "sound"
      : playing && !metronomeMode
        ? "playback"
        : undefined;
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
  const nextPlay = showPlayButtons && showNextSongPulse ? (
    <button
      type="button"
      className="add prep-play play"
      title="Play next song"
      aria-label="Play next song"
      disabled={!showNextSongPulse || !nextSongId}
      onPointerDown={onPlayPointerDown}
      onClick={() => onPlayClick(playNextSong)}
    >
      <PlayIcon />
    </button>
  ) : null;

  return (
    <div
      className={`prep-transport${
        prepTransport || panicOn ? " is-current-only" : " is-song-pair"
      }${panicOn ? " is-panic" : ""}${metronomeMode ? " metro" : ""}${continuousMetro || liveMetroVisuals ? " is-continuous-metro" : ""}${freeMode ? " is-free-metro" : ""}`}
    >
      {deviceKind === "master" ? null : showPanic ? <PanicButton /> : null}
      <TransportSongSlot
        className="is-current"
        play={currentPlay}
        song={currentIsTalk ? undefined : song}
        files={selectedFiles}
        setlistMode={gig?.performanceMode}
        title={currentTitle}
        showIcon={!panicOn && !currentIsTalk && Boolean(song)}
        showPulse={!panicOn && !currentIsTalk && Boolean(song)}
        pulseActive={currentPulseActive}
        pulseTone="current"
        follow={currentFollow}
        track={
          showCurrentSlider ? (
            <SongPositionTrack song={song} showTitle={!panicOn} title={currentTitle} />
          ) : undefined
        }
      />
      {prepTransport || panicOn ? null : (
        <TransportSongSlot
          className="is-next"
          play={nextPlay}
          song={nextSong}
          files={nextFiles}
          setlistMode={gig?.performanceMode}
          title={nextTitle}
          showIcon={showNextSongPulse}
          showPulse={showNextSongPulse}
          pulseActive={nextPulseActive}
          pulseTone="next"
          follow={undefined}
        />
      )}
    </div>
  );
}
