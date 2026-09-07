import { describe, expect, it } from "vitest";
import {
  DEFAULT_METRONOME_VOLUME,
  emptyMixerBank,
  gigMixerState,
  parseMetronomeVolume,
  parseMixerBank
} from "./mixer.js";

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
