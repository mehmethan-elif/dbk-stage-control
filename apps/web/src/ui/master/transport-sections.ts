import { hidesCountSection } from "./count-section";
import type { Song } from "@dbk/core";
import {
  finalOwnerSection,
  firstTempoChangeTime,
  songCues
} from "./rall-alert";

export type TransportSection = {
  name: string;
  start: number;
  end: number;
};

function formEnd(song: Song | undefined): number {
  return (song?.sections ?? []).reduce((end, section) => Math.max(end, section.end), 0);
}

function rallTransportSection(song: Song): TransportSection | undefined {
  const start = firstTempoChangeTime(song.tempoMap);
  if (start == null) return undefined;
  const end = Math.max(start, formEnd(song));
  return { name: "RALL", start, end };
}

function finalTransportSection(song: Song): TransportSection | undefined {
  const start = song.finalAt;
  if (start == null || !Number.isFinite(start)) return undefined;
  const end = Math.max(start, finalOwnerSection(song)?.end ?? formEnd(song));
  return { name: "FINAL", start, end };
}

/** Every `song.json` section, then RALL / FINAL when the export marked them. */
export function songTransportSections(song: Song | undefined): TransportSection[] {
  const sections = (song?.sections ?? []).filter((section) => !hidesCountSection(song, section)).map((section) => ({
    name: section.name,
    start: section.start,
    end: section.end
  }));
  if (!song) return sections;
  for (const kind of songCues(song)) {
    const extra = kind === "rall" ? rallTransportSection(song) : finalTransportSection(song);
    if (
      extra &&
      !sections.some(
        (section) =>
          section.name === extra.name && Math.abs(section.start - extra.start) < 0.02
      )
    ) {
      sections.push(extra);
    }
  }
  return sections;
}

export function sliderTimeFromClientX(
  clientX: number,
  rect: { left: number; width: number },
  timelineStart: number,
  timelineEnd: number
): number {
  const width = Math.max(1, rect.width);
  const t = (clientX - rect.left) / width;
  const clamped = Math.min(1, Math.max(0, t));
  return timelineStart + clamped * (timelineEnd - timelineStart);
}

export function sectionStartAtTime(
  sections: readonly { start: number; end: number }[],
  time: number
): number | undefined {
  let hit: { start: number; end: number } | undefined;
  for (const section of sections) {
    if (time >= section.start - 1e-9 && time < section.end + 1e-9) hit = section;
  }
  if (hit) return hit.start;
  return [...sections].reverse().find((section) => time >= section.start)?.start;
}

export function nearestMeasureIndex(starts: number[], time: number): number {
  if (starts.length === 0) return 0;
  return starts.reduce(
    (best, start, candidate) =>
      Math.abs(start - time) < Math.abs((starts[best] ?? 0) - time) ? candidate : best,
    0
  );
}

export function songTransportEnd(song: Song | undefined): number {
  const lastSection = songTransportSections(song).reduce(
    (end, section) => Math.max(end, section.end),
    0
  );
  return lastSection;
}
