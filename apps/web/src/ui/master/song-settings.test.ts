import { describe, expect, it } from "vitest";
import { PlayMode, type Song } from "@dbk/core";
import { hasPackedSong, songFileWithInfo } from "./song-settings";

const files = ["song.json", "Master.mp3"];

describe("hasPackedSong", () => {
  it("treats a reaper export as packed even without sections", () => {
    const song = { tags: ["reaper-export"], sections: [], assets: [] } as Pick<
      Song,
      "assets" | "sections" | "tags"
    >;
    expect(hasPackedSong(song, files)).toBe(true);
  });

  it("treats stem files as packed", () => {
    const song = { sections: [], assets: [] } as Pick<Song, "assets" | "sections" | "tags">;
    expect(hasPackedSong(song, ["song.json", "Kick.flac"])).toBe(true);
  });

  it("does not treat a metronome stub as packed", () => {
    const song = { sections: [], assets: [] } as Pick<Song, "assets" | "sections" | "tags">;
    expect(hasPackedSong(song, ["song.json"])).toBe(false);
  });
});

describe("songFileWithInfo", () => {
  it("keeps root kita when a later info write omits it", () => {
    const next = songFileWithInfo(
      {
        id: "biz",
        kita: 2,
        info: { bpm: 132, numerator: 4, denominator: 4, kita: 2 }
      },
      { bpm: 132, numerator: 4, denominator: 4, playMode: PlayMode.View }
    );
    expect(next.kita).toBe(2);
    expect((next.info as { kita?: number }).kita).toBe(2);
  });

  it("copies root kita into info when info never stored it", () => {
    const next = songFileWithInfo(
      {
        id: "biz",
        kita: 2,
        info: { bpm: 132, numerator: 4, denominator: 4 }
      },
      { bpm: 132, numerator: 4, denominator: 4, playMode: PlayMode.View }
    );
    expect(next.kita).toBe(2);
    expect((next.info as { kita?: number }).kita).toBe(2);
  });
});
