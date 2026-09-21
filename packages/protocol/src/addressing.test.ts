import { describe, expect, it } from "vitest";
import { syncMessageWantedBy, type SyncMessage } from "./index";

const mixerState: SyncMessage = {
  type: "MixerState",
  busMix: {},
  metronomeVolume: 0.8
};

const position: SyncMessage = {
  type: "Position",
  songId: "biz",
  setlistEntryId: "entry_1",
  time: 12,
  measure: 4,
  beat: 2,
  playing: true
};

describe("syncMessageWantedBy", () => {
  it("keeps the mixer off the band's copies", () => {
    // They drop it on arrival, and it is the largest routine packet on the wire.
    expect(syncMessageWantedBy(mixerState, "client")).toBe(false);
  });

  it("still sends the mixer to the soundcheck remote", () => {
    expect(syncMessageWantedBy(mixerState, "remote")).toBe(true);
  });

  it("holds the mixer back from a peer that has not said hello", () => {
    expect(syncMessageWantedBy(mixerState, undefined)).toBe(false);
  });

  it("sends everything else to everyone", () => {
    for (const kind of ["client", "remote", "master", undefined] as const) {
      expect(syncMessageWantedBy(position, kind)).toBe(true);
      expect(syncMessageWantedBy({ type: "Heartbeat" }, kind)).toBe(true);
      expect(syncMessageWantedBy({ type: "Stop" }, kind)).toBe(true);
    }
  });
});
