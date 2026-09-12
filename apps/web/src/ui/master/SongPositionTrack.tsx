import { useRef, type CSSProperties, type PointerEvent } from "react";
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
  const lastTapRef = useRef(0);
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
  const panicSection = sectionForBoundary(sections, panicTargetTime);
  const panicAtStart = Boolean(panicSection && Math.abs(panicSection.start - panicTargetTime) < 1e-6);
  const activeMeasureStart = measureStarts[measureIndex] ?? 0;
  const activeMeasureEnd = measureStarts[measureIndex + 1] ?? timelineEnd;
  const headStart = panicArmed
    ? panicAtStart
      ? (panicSection?.start ?? panicTargetTime)
      : panicTargetTime
    : activeMeasureStart;
  const headEnd = panicArmed
    ? panicAtStart
      ? (panicSection?.end ?? panicTargetTime)
      : panicTargetTime
    : activeMeasureEnd;
  const sliderValue = panicArmed ? panicTargetTime : activeMeasureStart;
  const sliderTimeFromEvent = (event: PointerEvent<HTMLInputElement>) =>
    sliderTimeFromClientX(
      event.clientX,
      event.currentTarget.getBoundingClientRect(),
      timelineStart,
      timelineEnd
    );
  const jumpToSongStart = () => {
    if (panicArmed) {
      setPanicTarget(timelineStart);
      return;
    }
    seek(timelineStart);
  };
  const jumpToClick = (time: number) => {
    if (panicArmed) {
      setPanicTarget(snapToSectionBoundary(sections, time));
      return;
    }
    const start = sectionStartAtTime(transportSections, time);
    if (start != null) seek(start);
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
        className={`prep-position-slider${panicArmed ? " panic" : ""} is-section-seek`}
        type="range"
        min={0}
        max={timelineEnd}
        step="any"
        value={sliderValue}
        disabled={!song}
        aria-label={panicArmed ? "Panic resume section" : "Jump to section"}
        onChange={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (!song || event.button !== 0) return;
          event.preventDefault();
          const now = performance.now();
          if (now - lastTapRef.current < 400) {
            lastTapRef.current = 0;
            jumpToSongStart();
            return;
          }
          lastTapRef.current = now;
          jumpToClick(sliderTimeFromEvent(event));
        }}
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
