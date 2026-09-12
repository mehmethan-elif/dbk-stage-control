import { describe, expect, it } from "vitest";
import {
  DEFAULT_METRONOME_BPM,
  metronomeTempoMap,
  normalizeSong,
  normalizeUserPlayMode,
  parseSongInfo,
  PlayMode,
  songDisplayName,
  songInfoFromPlayback
} from "./models.js";

describe("parseSongInfo", () => {
  it("defaults metronome bpm to 120 and time signature to 4/4", () => {
    expect(parseSongInfo(undefined)).toEqual({
      bpm: DEFAULT_METRONOME_BPM,
      numerator: 4,
      denominator: 4
    });
    expect(parseSongInfo({})).toEqual({
      bpm: 120,
      numerator: 4,
      denominator: 4
    });
    expect(parseSongInfo({ bpm: 0 })).toEqual({
      bpm: 120,
      numerator: 4,
      denominator: 4
    });
  });

  it("keeps a single-digit kita including 0", () => {
    expect(parseSongInfo({ kita: 0 }).kita).toBe(0);
    expect(parseSongInfo({ kita: "7" }).kita).toBe(7);
    expect(parseSongInfo({ kita: 10 }).kita).toBeUndefined();
  });

  it("keeps click-only on disk for panic mixes", () => {
    expect(parseSongInfo({ playMode: PlayMode.ClickOnly }).playMode).toBe(
      PlayMode.ClickOnly
    );
  });

  it("keeps free play mode on disk for older files", () => {
    expect(parseSongInfo({ playMode: PlayMode.Free }).playMode).toBe(PlayMode.Free);
  });

  it("maps removed play modes to Backing Tracks or Metronome", () => {
    expect(normalizeUserPlayMode(PlayMode.ClickOnly)).toBe(PlayMode.Playback);
    expect(normalizeUserPlayMode(PlayMode.Playback)).toBe(PlayMode.Playback);
    expect(normalizeUserPlayMode(PlayMode.Free)).toBe(PlayMode.View);
    expect(normalizeUserPlayMode(PlayMode.View)).toBe(PlayMode.View);
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
        kita: 2,
        startMode: "SERBEST",
        notes: "wait for applause",
        playMode: PlayMode.Playback,
        startAt: 8,
        pageNotes: { lyrics: "Audience sings", drums: "Half time" },
        metroNotes: { lyrics: "verse one", drums: "D D t k" }
      })
    ).toEqual({
      bpm: 96,
      numerator: 9,
      denominator: 8,
      duration: 185,
      key: "D",
      scale: "MINOR",
      style: "SLOW",
      kita: 2,
      startMode: "SERBEST",
      notes: "wait for applause",
      playMode: PlayMode.Playback,
      startAt: 8,
      pageNotes: { lyrics: "Audience sings", drums: "Half time" },
      metroNotes: { lyrics: "verse one", drums: "D D t k" }
    });
  });

  it("ignores a stored click pattern", () => {
    expect(parseSongInfo({ numerator: 5, beats: [true, false, true] })).toEqual({
      bpm: DEFAULT_METRONOME_BPM,
      numerator: 5,
      denominator: 4
    });
  });
});

describe("normalizeSong", () => {
  it("fills missing tempo, assets, and identity from a stub song.json", () => {
    const song = normalizeSong({ info: { bpm: 120, numerator: 4, denominator: 4 } }, "Karahisar Kalesi");
    expect(song.id).toBe("Karahisar Kalesi");
    expect(song.title).toBe("Karahisar Kalesi");
    expect(song.duration).toBe(0);
    expect(song.assets).toEqual([]);
    expect(song.sections).toEqual([]);
    expect(song.tempoMap).toEqual([
      { time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }
    ]);
  });

  it("snaps rounded section and lyric times onto the tempo-map barline", () => {
    const bar = 240 / 114;
    const song = normalizeSong({
      duration: 188,
      tempoMap: [
        { time: 0, measure: 1, bpm: 114, numerator: 4, denominator: 4 },
        { time: 181.052632, measure: 87, bpm: 107, numerator: -1, denominator: -1 }
      ],
      sections: [
        { name: "ARA", start: 94.736842, end: 122.105434 },
        { name: "SAN A", start: 122.105434, end: 138.94754 }
      ],
      lyrics: [
        { time: 122.105434, end: 124.2107, text: "near" },
        { time: 122.105434 + 0.8, end: 124.2107, text: "pickup" }
      ]
    });
    expect(song.tempoMap[1]).toMatchObject({ numerator: 4, denominator: 4, bpm: 107 });
    expect(song.sections[1]?.start).toBeCloseTo(58 * bar, 9);
    expect(song.sections[0]?.end).toBe(song.sections[1]?.start);
    expect(song.lyrics?.[0]?.time).toBeCloseTo(58 * bar, 9);
    expect(song.lyrics?.[1]?.time).toBeCloseTo(122.105434 + 0.8, 9);
  });
});

describe("songInfoFromPlayback", () => {
  it("copies duration, tempo, key, scale, style, and kita from song.json fields", () => {
    expect(
      songInfoFromPlayback({
        duration: 183.6,
        key: "D",
        scale: "MINOR",
        style: "MID",
        kita: 3,
        tempoMap: [{ time: 0, measure: 1, bpm: 132, numerator: 7, denominator: 8 }]
      })
    ).toEqual({
      bpm: 132,
      numerator: 7,
      denominator: 8,
      duration: 183.6,
      key: "D",
      scale: "MINOR",
      style: "MID",
      kita: 3
    });
  });

  it("uses metronome defaults when tempoMap is missing", () => {
    expect(songInfoFromPlayback({ duration: 0, tempoMap: undefined as never })).toEqual({
      bpm: DEFAULT_METRONOME_BPM,
      numerator: 4,
      denominator: 4
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
    expect(metronomeTempoMap({ bpm: 132, numerator: 4, denominator: 4 })).toEqual([
      { time: 0, measure: 1, bpm: 132, numerator: 4, denominator: 4 }
    ]);
  });
});
