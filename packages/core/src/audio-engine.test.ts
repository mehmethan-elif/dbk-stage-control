import { describe, expect, it } from "vitest";
import {
  clickOnlyMixSilences,
  clickOnlySong,
  defaultLibraryPlayMode,
  hasBackingAudio,
  isRealMetronomeTrack,
  savedOrDefaultLibraryPlayMode,
  hasOnlyClickAudio,
  performanceAudioSong,
  playNextCueSeconds
} from "./audio-engine.js";
import { PlayMode, type Song } from "./models.js";

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
  it("does not treat a click-only track as backing audio", () => {
    expect(hasBackingAudio(undefined, ["Click.flac"])).toBe(false);
    expect(hasBackingAudio(undefined, ["Click.flac", "Bass.flac"])).toBe(true);
  });

  it("does not treat practice master audio as backing", () => {
    expect(hasBackingAudio(undefined, ["Master.flac"])).toBe(false);
    expect(hasBackingAudio(undefined, ["Master.mp3"])).toBe(false);
    expect(hasBackingAudio(undefined, ["Master.mp3", "Bass.flac"])).toBe(true);
  });
});

describe("isRealMetronomeTrack", () => {
  const stub = { assets: [], sections: [] } as Pick<Song, "assets" | "sections">;

  it("is true only without backing stems and without sections", () => {
    expect(isRealMetronomeTrack(stub)).toBe(true);
    expect(isRealMetronomeTrack(stub, ["song.json", "Nota.pdf"])).toBe(true);
    expect(isRealMetronomeTrack(stub, ["Click.flac", "Master.mp3"])).toBe(true);
    expect(isRealMetronomeTrack(stub, ["Bass.flac"])).toBe(false);
    expect(isRealMetronomeTrack({ assets: [], sections: [{ name: "SAN", start: 0, end: 8 }] })).toBe(
      false
    );
  });
});

describe("defaultLibraryPlayMode", () => {
  it("uses backing tracks when a stem exists, ignoring Master.mp3", () => {
    expect(defaultLibraryPlayMode(undefined, ["Master.mp3", "Bass.flac"])).toBe(PlayMode.Playback);
    expect(defaultLibraryPlayMode(undefined, ["Click.flac", "Keys.flac"])).toBe(PlayMode.Playback);
  });

  it("uses backing tracks when Click.flac is the only performance audio", () => {
    expect(defaultLibraryPlayMode(undefined, ["Click.flac", "Master.mp3"])).toBe(PlayMode.Playback);
    expect(defaultLibraryPlayMode(undefined, ["Click.flac"])).toBe(PlayMode.Playback);
  });

  it("uses metronome when there is no click or backing track", () => {
    expect(defaultLibraryPlayMode(undefined, ["Master.mp3", "song.json"])).toBe(PlayMode.View);
    expect(defaultLibraryPlayMode(undefined, ["Nota.pdf"])).toBe(PlayMode.View);
  });
});

describe("savedOrDefaultLibraryPlayMode", () => {
  it("assigns a first-import default from the files on disk", () => {
    expect(savedOrDefaultLibraryPlayMode({}, undefined, ["Bass.flac"])).toBe(PlayMode.Playback);
    expect(savedOrDefaultLibraryPlayMode({}, undefined, ["Click.flac"])).toBe(PlayMode.Playback);
    expect(savedOrDefaultLibraryPlayMode({}, undefined, ["Nota.pdf"])).toBe(PlayMode.View);
  });

  it("keeps a later song-info play mode even when files would default differently", () => {
    expect(savedOrDefaultLibraryPlayMode({ playMode: PlayMode.View }, undefined, ["Bass.flac"])).toBe(
      PlayMode.View
    );
    expect(
      savedOrDefaultLibraryPlayMode({ playMode: PlayMode.Playback }, undefined, ["Click.flac"])
    ).toBe(PlayMode.Playback);
    expect(
      savedOrDefaultLibraryPlayMode({ playMode: PlayMode.ClickOnly }, undefined, ["Bass.flac"])
    ).toBe(PlayMode.Playback);
    expect(
      savedOrDefaultLibraryPlayMode({ playMode: PlayMode.Free }, undefined, ["Bass.flac"])
    ).toBe(PlayMode.View);
  });
});

describe("hasOnlyClickAudio", () => {
  it("is true when Click.flac is the only audio file", () => {
    expect(hasOnlyClickAudio(undefined, ["Click.flac", "song.json"])).toBe(true);
    expect(hasOnlyClickAudio(undefined, ["Click.flac", "Master.mp3"])).toBe(true);
  });

  it("is false when other audio files are present", () => {
    expect(hasOnlyClickAudio(undefined, ["Click.flac", "Bass.flac"])).toBe(false);
  });
});

describe("clickOnlyMixSilences", () => {
  it("silences backing stems only in click-only mode", () => {
    const click = { audioRole: "click" as const, path: "Click.flac" };
    const bass = { audioRole: "stem" as const, path: "Bass.flac" };
    expect(clickOnlyMixSilences(bass, PlayMode.ClickOnly)).toBe(true);
    expect(clickOnlyMixSilences(click, PlayMode.ClickOnly)).toBe(false);
    expect(clickOnlyMixSilences(bass, PlayMode.Playback)).toBe(false);
  });
});

describe("clickOnlySong", () => {
  it("removes backing audio while retaining click and non-audio assets", () => {
    const song = {
      assets: [
        { id: "click", kind: "audio", audioRole: "click", path: "Click.flac" },
        { id: "bass", kind: "audio", audioRole: "stem", path: "Bass.flac" },
        { id: "lyrics", kind: "lyrics", path: "lyrics.json" }
      ]
    } as Song;

    expect(clickOnlySong(song).assets.map((asset) => asset.id)).toEqual([
      "click",
      "lyrics"
    ]);
  });
});

describe("performanceAudioSong", () => {
  it("removes practice master audio from stage playback", () => {
    const song = {
      assets: [
        { id: "master", kind: "audio", path: "Master.mp3" },
        { id: "bass", kind: "audio", audioRole: "stem", path: "Bass.flac" }
      ]
    } as Song;

    expect(performanceAudioSong(song).assets.map((asset) => asset.id)).toEqual([
      "bass"
    ]);
  });
});
