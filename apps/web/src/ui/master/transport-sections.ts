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

export function songTransportEnd(song: Song | undefined): number {
  const lastSection = songTransportSections(song).reduce(
    (end, section) => Math.max(end, section.end),
    0
  );
  return lastSection;
}
