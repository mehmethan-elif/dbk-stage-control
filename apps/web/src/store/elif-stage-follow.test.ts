import { describe, expect, it } from "vitest";
import { PlaybackState } from "@dbk/core";
import {
  elifCanEditSetlist,
  elifLookingAhead,
  followsSharedPlayhead,
  showIsRunning
} from "./master-store";

type StageState = Parameters<typeof followsSharedPlayhead>[0];

/**
 * Elif joins the stage to edit the setlist, which she does by selecting a row. These cover
 * that selecting mid-number leaves the stage on the playing song, while selecting between
 * numbers still opens the song she picked.
 */
function stageState(over: Partial<StageState> = {}): StageState {
  return {
    deviceKind: "client",
    clientSession: "stage",
    syncConnected: true,
    stageName: "Elif",
    syncPeers: [],
    metronomePlaying: false,
    autoScroll: true,
    selectedEntryId: "entry_playing",
    gigId: "gig_1",
    gigs: [{ id: "gig_1", name: "Show", setlist: [], performanceMode: "FOLLOW_SONG_INFO" }],
    songs: [],
    fileIndex: {},
    playback: {
      state: PlaybackState.Ready,
      clock: { setlistEntryId: "entry_playing", songId: "biz", time: 0 }
    },
    ...over
  } as unknown as StageState;
}

const playing = {
  playback: {
    state: PlaybackState.Playing,
    clock: { setlistEntryId: "entry_playing", songId: "biz", time: 12 }
  }
} as Partial<StageState>;

describe("elifCanEditSetlist", () => {
  it("recognises Elif on a connected stage session", () => {
    expect(elifCanEditSetlist(stageState())).toBe(true);
  });

  it("does not apply to another band member", () => {
    expect(elifCanEditSetlist(stageState({ stageName: "Serkan" }))).toBe(false);
  });
});

describe("showIsRunning", () => {
  it("covers playback and the metronome", () => {
    expect(showIsRunning(stageState())).toBe(false);
    expect(showIsRunning(stageState(playing))).toBe(true);
    expect(showIsRunning(stageState({ metronomePlaying: true }))).toBe(true);
  });
});

describe("followsSharedPlayhead for Elif", () => {
  it("keeps her on the playing song when she selects another row mid-number", () => {
    const state = stageState({ ...playing, selectedEntryId: "entry_other" });
    expect(followsSharedPlayhead(state)).toBe(true);
    expect(elifLookingAhead(state)).toBe(false);
  });

  it("still follows while only the metronome runs", () => {
    const state = stageState({ metronomePlaying: true, selectedEntryId: "entry_other" });
    expect(followsSharedPlayhead(state)).toBe(true);
  });

  it("lets her read a song she picks between numbers", () => {
    const state = stageState({ selectedEntryId: "entry_other" });
    expect(followsSharedPlayhead(state)).toBe(false);
    expect(elifLookingAhead(state)).toBe(true);
  });

  it("does not treat the playing row as looking ahead", () => {
    expect(elifLookingAhead(stageState())).toBe(false);
  });
});
