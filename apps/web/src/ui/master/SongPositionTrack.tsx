import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import {
  measureStartTimes,
  PlaybackState,
  sectionForBoundary,
  snapToSectionBoundary
} from "@dbk/core";
import type { Song } from "@dbk/core";
import { useFollowPlayheadTime } from "../../store/follow-clock";
import {
  clientStageLive,
  followsSharedPlayhead,
  panicBlocksFollow,
  useMasterStore
} from "../../store/master-store";
import { sectionBarClass } from "./section-color";
import {
  nearestMeasureIndex,
  sectionStartAtTime,
  sliderTimeFromClientX,
  songTransportEnd,
  songTransportSections
} from "./transport-sections";

export function SongPositionTrack(props: {
  song: Song | undefined;
  className?: string;
  showTitle?: boolean;
  title?: string;
}) {
  const seek = useMasterStore((s) => s.seek);
  const playback = useMasterStore((s) => s.playback);
  const previewTime = useMasterStore((s) => s.previewTime);
  const metronomePlaying = useMasterStore((s) => s.metronomePlaying);
  const panicTargetTime = useMasterStore((s) => s.panicTargetTime);
  const panicArmed = useMasterStore(panicBlocksFollow);
  const setPanicTarget = useMasterStore((s) => s.setPanicTarget);
  const detached = useMasterStore(followsSharedPlayhead);
  const liveClient = useMasterStore(clientStageLive);
  const deviceKind = useMasterStore((s) => s.deviceKind);
  const playing =
    playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
  const clockMatches = Boolean(
    props.song && playback.clock?.songId && playback.clock.songId === props.song.id
  );
  const storePlayhead =
    metronomePlaying || !playing
      ? previewTime
      : liveClient || clockMatches || detached
        ? (playback.clock?.time ?? previewTime)
        : previewTime;
  const selectedTime = useFollowPlayheadTime(storePlayhead);
  const pendingMeasureRef = useRef<number | null>(null);
  const pendingPanicRef = useRef<number | null>(null);
  const pendingSectionRef = useRef<number | null>(null);
  const lastTapRef = useRef(0);
  const ignoreCommitRef = useRef(false);
  const [pendingMeasure, setPendingMeasure] = useState<number | null>(null);
  const [pendingPanicTime, setPendingPanicTime] = useState<number | null>(null);
  const song = props.song;
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
  const panicTime = pendingPanicTime ?? panicTargetTime;
  const panicSection = sectionForBoundary(sections, panicTime);
  const panicAtStart = Boolean(panicSection && Math.abs(panicSection.start - panicTime) < 1e-6);
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
      className={`prep-now-track${panicArmed ? " panic" : ""}${props.className ? ` ${props.className}` : ""}`}
      title={props.title}
    >
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
          panicArmed ? "Panic resume section" : sectionSeek ? "Jump to section" : "Song position by measure"
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
      {props.showTitle ? (
        <div className="prep-now-overlay">
          <div className="prep-now-copy">
            <span className="prep-now-title">{props.title ?? "—"}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
