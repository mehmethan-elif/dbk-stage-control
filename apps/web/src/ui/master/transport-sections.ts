import type { Song } from "@dbk/core";

export type TransportSection = {
  name: string;
  start: number;
  end: number;
};

/** Every `song.json` section, in order — no D.S. / segno folding. */
export function songTransportSections(song: Song | undefined): TransportSection[] {
  return (song?.sections ?? []).map((section) => ({
    name: section.name,
    start: section.start,
    end: section.end
  }));
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
  const hit = sections.find(
    (section) => time >= section.start - 1e-9 && time < section.end + 1e-9
  );
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
