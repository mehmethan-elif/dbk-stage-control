import type { Section, Song } from "@dbk/core";

const TIME_EPS = 0.02;

export function isCountSection(song: Song | undefined, section: Section | undefined): boolean {
  const first = song?.sections[0];
  if (!first || !section) return false;
  return (
    Math.abs(section.start - first.start) < TIME_EPS &&
    Math.abs(section.end - first.end) < TIME_EPS
  );
}

export function countSection(song: Song | undefined): Section | undefined {
  return song?.sections[0];
}

export function countLabel(
  song: Song | undefined,
  start: number,
  end: number
): string | null {
  const texts = (song?.chords ?? [])
    .filter((chord) => chord.time >= start - TIME_EPS && chord.time < end - TIME_EPS)
    .map((chord) => chord.text.trim())
    .filter((text) => text.length > 0);
  return texts.length > 0 ? texts.join("  ") : null;
}
