import { describe, expect, it } from "vitest";
import { chordFollowTargets } from "./ChordView";

function node(id: string, pack?: { id: string }) {
  return {
    id,
    closest: (selector: string) => (selector === ".chord-section" ? (pack ?? null) : null)
  };
}

describe("chordFollowTargets", () => {
  const line = node("line", { id: "pack" });
  const section = node("section");
  const nextSection = node("next-section");
  const song = node("song");

  it("aims at the played line and the whole next section", () => {
    expect(
      chordFollowTargets({
        currentLine: line,
        currentSection: section,
        nextSection,
        song
      })
    ).toEqual({ current: line, next: nextSection, pack: { id: "pack" } });
  });

  it("falls back to the section when a count leaves no line, not the whole song", () => {
    expect(
      chordFollowTargets({
        currentLine: null,
        currentSection: section,
        nextSection,
        song
      })
    ).toEqual({ current: section, next: nextSection, pack: section });
  });

  it("falls back to the song only when nothing on the page is marked", () => {
    expect(
      chordFollowTargets({
        currentLine: null,
        currentSection: null,
        nextSection: null,
        song
      })
    ).toEqual({ current: song, next: null, pack: null });
  });
});
