import { describe, expect, it } from "vitest";
import type { Song } from "@dbk/core";
import { hidesCountSection, skipsCountIn } from "./count-section";
import { stageRows } from "./lyric-rows";
import { songTransportSections } from "./transport-sections";

const song: Song = {
  id: "direct", version: 1, title: "Direct", duration: 12, assets: [], tempoMap: [],
  sections: [{ name: "COUNT", start: 0, end: 2 }, { name: "ARA", start: 2, end: 12 }],
  info: { startAt: 2 }
};

describe("count-in display", () => {
  it("hides COUNT when Song Info skips it, retaining the following section and timing", () => {
    expect(skipsCountIn(song)).toBe(true);
    expect(hidesCountSection(song, song.sections[0])).toBe(true);
    expect(hidesCountSection(song, song.sections[1])).toBe(false);
    expect(stageRows(song)).toEqual([{ kind: "section", name: "ARA", time: 2, end: 12 }]);
    expect(songTransportSections(song)).toEqual([song.sections[1]]);
    expect(song.sections).toHaveLength(2);
  });

  it("keeps COUNT when enabled or unset", () => {
    for (const info of [undefined, { startAt: 0 }]) {
      const enabled = { ...song, info };
      expect(skipsCountIn(enabled)).toBe(false);
      expect(stageRows(enabled)).toHaveLength(2);
      expect(songTransportSections(enabled)).toHaveLength(2);
    }
  });

  it("does not mark a non-COUNT intro or a sectionless song as a direct pass", () => {
    expect(skipsCountIn({ ...song, sections: [{ name: "SERBEST", start: 0, end: 2 }, song.sections[1]!] })).toBe(false);
    expect(skipsCountIn({ ...song, sections: [] })).toBe(false);
    expect(skipsCountIn(undefined)).toBe(false);
  });
});
