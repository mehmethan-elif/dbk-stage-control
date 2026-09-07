import { describe, expect, it } from "vitest";
import {
  DEFAULT_METRONOME_BPM,
  metronomeTempoMap,
  parseSongInfo,
  songDisplayName,
  songInfoFromPlayback
} from "./models.js";

describe("parseSongInfo", () => {
  it("defaults metronome bpm to 120 and time signature to 4/4", () => {
    expect(parseSongInfo(undefined)).toEqual({
      bpm: DEFAULT_METRONOME_BPM,
      numerator: 4,
      denominator: 4,
      beats: [true, false, false, false]
    });
    expect(parseSongInfo({})).toEqual({
      bpm: 120,
      numerator: 4,
      denominator: 4,
      beats: [true, false, false, false]
    });
    expect(parseSongInfo({ bpm: 0 })).toEqual({
      bpm: 120,
      numerator: 4,
      denominator: 4,
      beats: [true, false, false, false]
    });
  });

  it("keeps optional metronome fields", () => {
    expect(
      parseSongInfo({
        bpm: 96,
        numerator: 9,
        denominator: 8,
        duration: 185,
        key: "D",
        scale: "MINOR",
        style: "SLOW",
        startMode: "SERBEST",
        notes: "wait for applause"
      })
    ).toEqual({
      bpm: 96,
      numerator: 9,
      denominator: 8,
      beats: [true, false, false, false, false, false, false, false, false],
      duration: 185,
      key: "D",
      scale: "MINOR",
      style: "SLOW",
      startMode: "SERBEST",
      notes: "wait for applause"
    });
  });

  it("keeps click beats and resizes them to the time signature", () => {
    expect(parseSongInfo({ numerator: 5, beats: [true, false, true] }).beats).toEqual([
      true,
      false,
      true,
      false,
      false
    ]);
    expect(parseSongInfo({ numerator: 3, beats: [true, false, true, true] }).beats).toEqual([
      true,
      false,
      true
    ]);
  });
});

describe("songInfoFromPlayback", () => {
  it("copies duration, tempo, key, scale, and style from song.json fields", () => {
    expect(
      songInfoFromPlayback({
        duration: 183.6,
        key: "D",
        scale: "MINOR",
        style: "MID",
        tempoMap: [{ time: 0, measure: 1, bpm: 132, numerator: 7, denominator: 8 }]
      })
    ).toEqual({
      bpm: 132,
      numerator: 7,
      denominator: 8,
      beats: [true, false, false, false, false, false, false],
      duration: 183.6,
      key: "D",
      scale: "MINOR",
      style: "MID"
    });
  });
});

describe("songDisplayName", () => {
  it("prefers the song title and composes Turkish letters", () => {
    expect(
      songDisplayName({
        title: "Evvel Zaman İçinde",
        folder: "Evvel Zaman Ic%CC%A7inde"
      })
    ).toBe("Evvel Zaman İçinde");
  });
});

describe("metronomeTempoMap", () => {
  it("builds a tempo map from View-mode settings", () => {
    expect(metronomeTempoMap({ bpm: 132, numerator: 4, denominator: 4, beats: [true, false, false, false] })).toEqual([
      { time: 0, measure: 1, bpm: 132, numerator: 4, denominator: 4 }
    ]);
  });
});
