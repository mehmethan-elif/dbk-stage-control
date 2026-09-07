import { describe, expect, it } from "vitest";
import { hasBackingAudio, hasOnlyClickAudio, playNextCueSeconds } from "./audio-engine.js";

describe("playNextCueSeconds", () => {
  it("uses the NEXT marker when present", () => {
    expect(playNextCueSeconds({ nextSongAt: 4 }, 8)).toBe(4);
    expect(playNextCueSeconds({ nextSongAt: 0 }, 8)).toBe(0);
  });

  it("falls back to click duration when the marker is missing", () => {
    expect(playNextCueSeconds({}, 8)).toBe(8);
    expect(playNextCueSeconds(null, 8)).toBe(8);
    expect(playNextCueSeconds(undefined, 0)).toBeNull();
  });
});

describe("hasBackingAudio", () => {
  it("treats a click track as playable backing audio", () => {
    expect(hasBackingAudio(undefined, ["Click.flac"])).toBe(true);
  });
});

describe("hasOnlyClickAudio", () => {
  it("is true when Click.flac is the only audio file", () => {
    expect(hasOnlyClickAudio(undefined, ["Click.flac", "song.json"])).toBe(true);
  });

  it("is false when other audio files are present", () => {
    expect(hasOnlyClickAudio(undefined, ["Click.flac", "Bass.flac"])).toBe(false);
  });
});
