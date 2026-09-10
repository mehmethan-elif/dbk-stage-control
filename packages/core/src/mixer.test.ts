import { describe, expect, it } from "vitest";
import { FinishMode, type Song } from "./models.js";
import {
  DEFAULT_METRONOME_VOLUME,
  emptyMixerBank,
  gigMixerState,
  parseMetronomeVolume,
  parseMixerBank,
  songWithMixerStems
} from "./mixer.js";
import { effectiveFinishMode } from "./setlist.js";

describe("parseMixerBank", () => {
  it("fills missing strips with defaults", () => {
    expect(parseMixerBank(undefined)).toEqual(emptyMixerBank());
    expect(parseMixerBank({ Kick: { gainDb: -3, muted: true, solo: false } }).Kick).toEqual({
      gainDb: -3,
      muted: true,
      solo: false
    });
    expect(parseMixerBank({ Kick: { gainDb: -3, muted: true, solo: false } }).Main).toEqual({
      gainDb: 0,
      muted: false,
      solo: false
    });
  });

  it("reads a strips wrapper", () => {
    expect(parseMixerBank({ strips: { Main: { gainDb: 6, muted: false, solo: true } } }).Main).toEqual({
      gainDb: 6,
      muted: false,
      solo: true
    });
  });
});

describe("gigMixerState", () => {
  it("defaults metronome volume and bus mix", () => {
    expect(parseMetronomeVolume(undefined)).toBe(DEFAULT_METRONOME_VOLUME);
    expect(parseMetronomeVolume(2)).toBe(1);
    expect(gigMixerState(undefined).metronomeVolume).toBe(DEFAULT_METRONOME_VOLUME);
    expect(gigMixerState({ metronomeVolume: 0.4, busMix: { Main: { gainDb: -1, muted: false, solo: false } } })).toEqual({
      busMix: parseMixerBank({ Main: { gainDb: -1, muted: false, solo: false } }),
      metronomeVolume: 0.4
    });
  });
});

describe("songWithMixerStems", () => {
  it("lets PLAY_NEXT see disk stems when song.json assets are empty", () => {
    const bare = (id: string): Song => ({
      id,
      version: 1,
      title: id,
      duration: 10,
      assets: [],
      tempoMap: [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }],
      sections: []
    });
    const files = ["Click.flac", "Bass.flac", "Master.mp3"];
    const setlist = [
      { type: "song" as const, entryId: "e1", songId: "biz" },
      { type: "song" as const, entryId: "e2", songId: "telli" }
    ];
    const empty = new Map([
      ["biz", bare("biz")],
      ["telli", bare("telli")]
    ]);
    const hydrated = new Map([
      ["biz", songWithMixerStems(bare("biz"), files)],
      ["telli", songWithMixerStems(bare("telli"), files)]
    ]);

    expect(effectiveFinishMode(setlist[0]!, false, setlist, 0, empty)).toBe(FinishMode.Stop);
    expect(effectiveFinishMode(setlist[0]!, false, setlist, 0, hydrated)).toBe(FinishMode.PlayNext);
    expect(hydrated.get("telli")?.assets.some((asset) => asset.path === "Click.flac")).toBe(true);
  });
});
