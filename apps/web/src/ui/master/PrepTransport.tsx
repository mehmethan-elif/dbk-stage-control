import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import {
  effectivePlayMode,
  hasBackingAudio,
  hasClickFlac,
  ELIF_KONUSMA_LABEL,
  isElifKonusma,
  isMetronomeSetlistMode,
  isSongEntry,
  measureStartTimes,
  metronomeTempoMap,
  parseSongInfo,
  PlaybackState,
  PlayMode,
  secondsPerBeat,
  sectionForBoundary,
  snapToSectionBoundary,
  sectionAt,
  sectionNamed,
  songDisplayName,
  tempoAt,
  withKeyChangeElifs,
  type Song
} from "@dbk/core";
import { practiceEntryId } from "../../practice/gig";
import { findSongByRef } from "../../store/song-library";
import { nextTransportEntry } from "./next-song-section";
import {
  audioContextTime,
  clientPracticeMode,
  currentGig,
  isStageContentPage,
  practicePlaysMasterMix,
  nextUnskippedSongEntryId,
  onMetronomeBeat,
  panicBlocksFollow,
  songPlaying,
  STAGE_ZOOM_MAX,
  STAGE_ZOOM_MIN,
  unlockAudio,
  followsSharedPlayhead,
  useMasterStore,
  usesContinuousMetroTransport,
  usesFreeMetroTransport
} from "../../store/master-store";
import {
  AutoScrollIcon,
  DockLeftIcon,
  PauseIcon,
  PlayIcon,
  StopIcon
} from "../shared/icons";
import { sectionBarClass } from "./section-color";
import {
  nearestMeasureIndex,
  sectionStartAtTime,
  sliderTimeFromClientX,
  songTransportEnd,
  songTransportSections
} from "./transport-sections";

export function StageSetlistButton() {
  const setlistOpen = useMasterStore((s) => s.setlistOpen);
  const toggleSetlistOpen = useMasterStore((s) => s.toggleSetlistOpen);
  return (
    <button
      type="button"
      className={`icon-btn${setlistOpen ? " on" : ""}`}
      title="Setlist"
      aria-label="Setlist"
      aria-pressed={setlistOpen}
      onClick={toggleSetlistOpen}
    >
      <DockLeftIcon />
    </button>
  );
}

function PanicButton() {
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

function FadeButton() {
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
  const autoScroll = useMasterStore((s) => s.autoScroll);
  const zoomIn = useMasterStore((s) => s.zoomIn);
  const zoomOut = useMasterStore((s) => s.zoomOut);
  const toggleAutoScroll = useMasterStore((s) => s.toggleAutoScroll);
  return (
    <div className="prep-transport-tools">
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

function MetroFlash({
  active,
  tone
}: {
  active: boolean;
  tone?: "current" | "next";
}) {
  const flashRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!active) {
      flashRef.current?.classList.remove("is-on", "is-accent");
      return;
    }
    const pending: Array<{ at: number; accent: boolean }> = [];
    const unsub = onMetronomeBeat((beat) => {
      pending.push(beat);
    });
    let raf = 0;
    const loop = () => {
      const now = audioContextTime();
      const el = flashRef.current;
      while (pending.length > 0 && (pending[0]?.at ?? 0) <= now + 0.004) {
        const beat = pending.shift();
        if (!el || !beat) continue;
        el.classList.remove("is-on", "is-accent");
        void el.offsetWidth;
        el.classList.add("is-on");
        if (beat.accent) el.classList.add("is-accent");
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, [active]);

  return (
    <span
      ref={flashRef}
      className={`prep-metro-flash${tone ? ` is-${tone}` : ""}`}
      aria-hidden="true"
    />
  );
}

function SongMetroBeats({
  song,
  active,
  tone
}: {
  song?: Song;
  active: boolean;
  tone?: "current" | "next";
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const parsed = song ? parseSongInfo(song.info) : undefined;
  const count = Math.max(1, parsed?.numerator ?? 4);

  useEffect(() => {
    const root = rootRef.current;
    const info = song ? parseSongInfo(song.info) : undefined;
    const beats = Math.max(1, info?.numerator ?? 4);
    const pattern = info?.beats ?? [];
    const paint = (index: number) => {
      if (!root) return;
      const cells = root.children;
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (!(cell instanceof HTMLElement)) continue;
        cell.classList.toggle("is-on", i === index);
        cell.classList.toggle("is-accent", i === index && pattern[i] === true);
      }
    };
    if (!active || !song || !info) {
      paint(-1);
      return;
    }
    const map = metronomeTempoMap(info);
    let songTime = 0;
    let beatsInBar = 0;
    let nextAt = performance.now() / 1000 + 0.05;
    const pending: Array<{ at: number; index: number }> = [];
    let raf = 0;
    const loop = () => {
      const now = performance.now() / 1000;
      const horizon = now + 0.12;
      while (nextAt < horizon) {
        const point = tempoAt(map, songTime);
        pending.push({ at: nextAt, index: beatsInBar });
        const interval = Math.max(0.05, secondsPerBeat(point));
        nextAt += interval;
        songTime += interval;
        beatsInBar += 1;
        if (beatsInBar >= beats) beatsInBar = 0;
      }
      while (pending.length > 0 && (pending[0]?.at ?? 0) <= now + 0.004) {
        const beat = pending.shift();
        if (beat) paint(beat.index);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      paint(-1);
    };
  }, [active, song?.id, song?.info]);

  return (
    <span
      ref={rootRef}
      className={`prep-metro-beats${tone ? ` is-${tone}` : ""}`}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="prep-metro-beat" />
      ))}
    </span>
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
  const gig = useMasterStore(currentGig);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const playback = useMasterStore((s) => s.playback);
  const previewTime = useMasterStore((s) => s.previewTime);
  const metronomePlaying = useMasterStore((s) => s.metronomePlaying);
  const masterPage = useMasterStore((s) => s.masterPage);
  const seek = useMasterStore((s) => s.seek);
  const panicTargetTime = useMasterStore((s) => s.panicTargetTime);
  const panicArmed = useMasterStore(panicBlocksFollow);
  const setPanicTarget = useMasterStore((s) => s.setPanicTarget);
  const detached = useMasterStore(followsSharedPlayhead);
  const practiceClient = useMasterStore(clientPracticeMode);
  const playMasterMix = useMasterStore(practicePlaysMasterMix);
  const continuousMetro = useMasterStore(usesContinuousMetroTransport);
  const freeMode = useMasterStore(usesFreeMetroTransport);
  const dualVisualMetro =
    freeMode || (continuousMetro && isMetronomeSetlistMode(gig?.performanceMode));
  const showPlayButtons = continuousMetro && !freeMode && !playMasterMix;
  const nextSongId = continuousMetro ? nextUnskippedSongEntryId(gig, selectedEntryId) : null;
  const displayedEntries = gig ? withKeyChangeElifs(gig.setlist, songs) : [];
  const nextEntry = continuousMetro
    ? nextTransportEntry(displayedEntries, selectedEntryId ?? undefined)
    : undefined;
  const selectedDisplayed = selectedEntryId
    ? displayedEntries.find((entry) => entry.entryId === selectedEntryId)
    : undefined;
  const currentIsElif = Boolean(selectedDisplayed && isElifKonusma(selectedDisplayed));
  const nextIsElif = Boolean(nextEntry && isElifKonusma(nextEntry));
  const nextSong =
    nextEntry && isSongEntry(nextEntry) ? findSongByRef(songs, nextEntry.songId) : undefined;
  const nextTitle = nextIsElif
    ? ELIF_KONUSMA_LABEL
    : nextSong
      ? songDisplayName(nextSong)
      : "—";
  const showNextMetro = Boolean(nextSong) && !nextIsElif;
  const playFromPointer = useRef(false);
  const pendingMeasureRef = useRef<number | null>(null);
  const pendingPanicRef = useRef<number | null>(null);
  const pendingSectionRef = useRef<number | null>(null);
  const lastTapRef = useRef(0);
  const ignoreCommitRef = useRef(false);
  const [pendingMeasure, setPendingMeasure] = useState<number | null>(null);
  const [pendingPanicTime, setPendingPanicTime] = useState<number | null>(null);
  const showStageChrome = isStageContentPage(masterPage);

  const playing =
    playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
  const selected = selectedEntryId
    ? gig?.setlist.find((entry) => entry.entryId === selectedEntryId)
    : undefined;
  const liveEntry =
    detached && playing && playback.clock?.setlistEntryId
      ? gig?.setlist.find((entry) => entry.entryId === playback.clock?.setlistEntryId)
      : undefined;
  const displayEntry = liveEntry ?? selected;
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
  const metronomeMode = playMasterMix
    ? false
    : freeMode || practiceClient
      ? true
      : !displayEntry ||
        !isSongEntry(displayEntry) ||
        selectedMode === PlayMode.View ||
        (selectedMode === PlayMode.Playback && !hasBackingAudio(song, selectedFiles)) ||
        (selectedMode === PlayMode.ClickOnly &&
          (!song || !hasClickFlac(song, selectedFiles)));
  const clockMatches = Boolean(displayEntry && playback.clock?.setlistEntryId === displayEntry.entryId);
  const showStop =
    playing &&
    (detached || clockMatches || playback.currentIndex === selectedIndex || !playback.clock);
  const selectedTime =
    metronomePlaying || !playing
      ? previewTime
      : clockMatches || detached
        ? (playback.clock?.time ?? previewTime)
        : previewTime;
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

  const startCurrentMetronome = () => {
    useMasterStore.getState().startMetronome();
  };

  const stopCurrentMetronome = () => {
    useMasterStore.getState().stopMetronome();
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
      if (useMasterStore.getState().metronomePlaying) {
        useMasterStore.getState().stopMetronome();
      }
      return;
    }
    if (dualVisualMetro) return;
    if (metronomePlaying) return;
    useMasterStore.getState().previewContinuousNextMetronome();
  }, [continuousMetro, dualVisualMetro, freeMode, metronomePlaying, selectedEntryId, nextSongId]);

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
  const canPlay = Boolean(song);
  const sections = song?.sections ?? [];
  const transportSections = songTransportSections(song);
  const timelineStart = 0;
  const timelineEnd = songTransportEnd(song);
  const timelineLength = Math.max(0.001, timelineEnd - timelineStart);
  const measureStarts = song ? measureStartTimes(song.tempoMap, timelineEnd) : [0];
  let measureIndex = 0;
  for (let index = 0; index < measureStarts.length; index++) {
    if ((measureStarts[index] ?? 0) <= selectedTime + 0.02) measureIndex = index;
    else break;
  }
  const showPanic =
    !practiceClient &&
    !metronomeMode &&
    Boolean(song && hasClickFlac(song, selectedFiles));
  const panicTime = pendingPanicTime ?? panicTargetTime;
  const panicSection = sectionForBoundary(sections, panicTime);
  const panicAtStart = Boolean(
    panicSection && Math.abs(panicSection.start - panicTime) < 1e-6
  );
  const displayedMeasure = pendingMeasure ?? measureIndex;
  const activeMeasureStart = measureStarts[displayedMeasure] ?? 0;
  const activeMeasureEnd = measureStarts[displayedMeasure + 1] ?? timelineEnd;
  const headStart = panicArmed
    ? panicAtStart
      ? (panicSection?.start ?? panicTime)
      : panicTime
    : activeMeasureStart;
  const headEnd = panicArmed
    ? panicAtStart
      ? (panicSection?.end ?? panicTime)
      : panicTime
    : activeMeasureEnd;
  const sliderValue = panicArmed ? panicTime : activeMeasureStart;
  const previewSliderTime = (time: number) => {
    if (panicArmed) {
      const snapped = snapToSectionBoundary(sections, time);
      pendingPanicRef.current = snapped;
      setPendingPanicTime(snapped);
      setPanicTarget(snapped);
      return;
    }
    const index = nearestMeasureIndex(measureStarts, time);
    pendingMeasureRef.current = index;
    setPendingMeasure(index);
  };
  const sliderTimeFromEvent = (event: PointerEvent<HTMLInputElement>) =>
    sliderTimeFromClientX(
      event.clientX,
      event.currentTarget.getBoundingClientRect(),
      timelineStart,
      timelineEnd
    );
  const sectionSeek = deviceKind === "client";
  const jumpToSongStart = () => {
    pendingSectionRef.current = null;
    pendingMeasureRef.current = null;
    pendingPanicRef.current = null;
    setPendingMeasure(null);
    setPendingPanicTime(null);
    if (panicArmed) {
      setPanicTarget(timelineStart);
      return;
    }
    seek(timelineStart);
  };
  const commitSectionSeek = () => {
    if (ignoreCommitRef.current) {
      ignoreCommitRef.current = false;
      return;
    }
    const start = pendingSectionRef.current;
    pendingSectionRef.current = null;
    if (start != null) seek(start);
  };
  const commitPosition = () => {
    if (ignoreCommitRef.current) {
      ignoreCommitRef.current = false;
      return;
    }
    if (panicArmed) {
      if (pendingPanicRef.current == null) return;
      setPanicTarget(pendingPanicRef.current);
      pendingPanicRef.current = null;
      setPendingPanicTime(null);
      return;
    }
    const index = pendingMeasureRef.current;
    if (index === null) return;
    seek(measureStarts[index] ?? 0);
    pendingMeasureRef.current = null;
    setPendingMeasure(null);
  };

  return (
    <div
      className={`prep-transport${metronomeMode ? " metro" : ""}${continuousMetro ? " is-continuous-metro" : ""}${freeMode ? " is-free-metro" : ""}`}
    >
      {showStageChrome ? <StageSetlistButton /> : null}
      {showPlayButtons ? (
        <>
          <button
            type="button"
            className={`add prep-play play${metronomePlaying ? " is-playing" : ""}`}
            title="Play"
            aria-label="Play"
            disabled={!canPlay}
            onPointerDown={onPlayPointerDown}
            onClick={() => onPlayClick(startCurrentMetronome)}
          >
            <PlayIcon />
          </button>
          <button
            type="button"
            className={`add prep-play stop${metronomePlaying ? " is-playing" : ""}`}
            title="Stop"
            aria-label="Stop"
            disabled={!canPlay}
            onPointerDown={onPlayPointerDown}
            onClick={() => onPlayClick(stopCurrentMetronome)}
          >
            <StopIcon />
          </button>
        </>
      ) : freeMode ? null : (
        <button
          type="button"
          className={`add prep-play ${buttonMode}${buttonMode === "stop" ? " is-playing" : ""}`}
          title={buttonMode === "stop" ? "Stop" : buttonMode === "pause" ? "Continue after SERBEST" : "Play"}
          aria-label={buttonMode === "stop" ? "Stop" : buttonMode === "pause" ? "Continue after SERBEST" : "Play"}
          disabled={!canPlay}
          onPointerDown={onPlayPointerDown}
          onClick={() => onPlayClick(metronomeMode ? toggleMetronome : togglePlayback)}
        >
          {buttonMode === "stop" ? <StopIcon /> : buttonMode === "pause" ? <PauseIcon /> : <PlayIcon />}
        </button>
      )}
      {deviceKind === "master" && !metronomeMode ? <FadeButton /> : null}
      {showPanic ? <PanicButton /> : null}
      <div
        className={`prep-now-track${metronomeMode ? " metro" : ""}${panicArmed ? " panic" : ""}`}
        title={currentIsElif ? ELIF_KONUSMA_LABEL : song?.title}
      >
        {metronomeMode ? (
          currentIsElif ? null : dualVisualMetro ? (
            <SongMetroBeats song={song} active={Boolean(song)} tone="current" />
          ) : (
            <MetroFlash active={metronomePlaying} tone="current" />
          )
        ) : (
          <>
            <div className="prep-now-sections" aria-hidden="true">
              {transportSections.map((section, index) => (
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
                className={`prep-position-head${panicArmed ? " panic" : ""}`}
                aria-hidden="true"
                style={{
                  left: `${(headStart / timelineLength) * 100}%`,
                  width: `${(Math.max(0.02, headEnd - headStart) / timelineLength) * 100}%`
                }}
              />
            ) : null}
            <input
              className={`prep-position-slider${panicArmed ? " panic" : ""}${sectionSeek ? " is-section-seek" : ""}`}
              type="range"
              min={0}
              max={timelineEnd}
              step="any"
              value={sliderValue}
              disabled={!song}
              aria-label={
                panicArmed
                  ? "Panic resume section"
                  : sectionSeek
                    ? "Jump to section"
                    : "Song position by measure"
              }
              onChange={(event) => {
                if (sectionSeek) return;
                previewSliderTime(Number(event.target.value));
              }}
              onPointerDown={(event) => {
                if (!song || event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                const now = performance.now();
                if (now - lastTapRef.current < 400) {
                  lastTapRef.current = 0;
                  ignoreCommitRef.current = true;
                  jumpToSongStart();
                  return;
                }
                lastTapRef.current = now;
                ignoreCommitRef.current = false;
                if (sectionSeek) {
                  pendingSectionRef.current =
                    sectionStartAtTime(transportSections, sliderTimeFromEvent(event)) ?? null;
                  return;
                }
                previewSliderTime(sliderTimeFromEvent(event));
              }}
              onPointerMove={(event) => {
                if (sectionSeek) return;
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                previewSliderTime(sliderTimeFromEvent(event));
              }}
              onPointerUp={sectionSeek ? commitSectionSeek : commitPosition}
              onLostPointerCapture={sectionSeek ? commitSectionSeek : commitPosition}
              onPointerCancel={() => {
                pendingMeasureRef.current = null;
                pendingPanicRef.current = null;
                pendingSectionRef.current = null;
                setPendingMeasure(null);
                setPendingPanicTime(null);
              }}
              onKeyUp={sectionSeek ? undefined : commitPosition}
              onBlur={sectionSeek ? undefined : commitPosition}
            />
          </>
        )}
        <div className="prep-now-overlay">
          <div className="prep-now-copy">
            <span className="prep-now-title">
              {currentIsElif ? ELIF_KONUSMA_LABEL : song ? songDisplayName(song) : "—"}
            </span>
          </div>
        </div>
      </div>
      {continuousMetro ? (
        <>
          <span className="prep-next-song-label">NEXT</span>
          {showPlayButtons ? (
            <button
              type="button"
              className="add prep-play play"
              title="Play next song"
              aria-label="Play next song"
              disabled={!nextSongId}
              onPointerDown={onPlayPointerDown}
              onClick={() => onPlayClick(playNextSong)}
            >
              <PlayIcon />
            </button>
          ) : null}
          <div className="prep-now-track metro" title={nextTitle === "—" ? undefined : nextTitle}>
            {showNextMetro ? (
              dualVisualMetro ? (
                <SongMetroBeats song={nextSong} active tone="next" />
              ) : (
                <MetroFlash active={!metronomePlaying} tone="next" />
              )
            ) : null}
            <div className="prep-now-overlay">
              <div className="prep-now-copy">
                <span className="prep-now-title">{nextTitle}</span>
              </div>
            </div>
          </div>
        </>
      ) : null}
      {showStageChrome ? (
        <StageViewTools />
      ) : null}
    </div>
  );
}
