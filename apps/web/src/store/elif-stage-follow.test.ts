import { describe, expect, it } from "vitest";
import { PlaybackState, type Song } from "@dbk/core";
import {
  elifCanEditSetlist,
  followsSharedPlayhead,
  nextMasterEntryId,
  playingMarkEntryId,
  setlistLocked,
  showEntryId,
  showIsRunning,
  pageEntrySongId
} from "./master-store";

type StageState = Parameters<typeof followsSharedPlayhead>[0];

function song(id: string, key: string): Song {
  return {
    id,
    version: 1,
    title: id,
    key,
    info: { key, playMode: "PLAYBACK" },
    duration: 60,
    assets: [],
    tempoMap: [],
    sections: []
  } as unknown as Song;
}

/**
 * Elif joins the stage to reorder the setlist, which she does by selecting a row. These cover
 * that her selection stays an edit cursor while her pages keep showing the master's row, and
 * that the master's row can be an ELIF KONUSMA the set has stopped on.
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
    masterEntryId: "entry_playing",
    gigId: "gig_1",
    gigs: [
      {
        id: "gig_1",
        name: "Show",
        setlist: [
          { type: "song", entryId: "entry_playing", songId: "biz" },
          { type: "song", entryId: "entry_other", songId: "kale" }
        ],
        performanceMode: "FOLLOW_SONG_INFO"
      }
    ],
    songs: [song("biz", "Am"), song("kale", "Em")],
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

describe("showEntryId", () => {
  it("keeps a client on the master's row when its own selection has moved", () => {
    const state = stageState({ selectedEntryId: "entry_other" });
    expect(showEntryId(state)).toBe("entry_playing");
  });

  it("uses this device's selection on the master and off the stage", () => {
    expect(showEntryId(stageState({ deviceKind: "master", selectedEntryId: "entry_other" }))).toBe(
      "entry_other"
    );
    expect(
      showEntryId(stageState({ masterEntryId: null, selectedEntryId: "entry_other" }))
    ).toBe("entry_other");
  });
});

describe("playingMarkEntryId", () => {
  const clock = { setlistEntryId: "entry_playing", songId: "biz", time: 12 };

  it("marks the row the master has picked out when the click is what is sounding", () => {
    // A track played and stopped leaves its clock behind, and the metronome has none of its own.
    const state = stageState({
      metronomePlaying: true,
      masterEntryId: "entry_other",
      selectedEntryId: "entry_other",
      playback: { state: PlaybackState.Ready, clock }
    } as Partial<StageState>);
    expect(playingMarkEntryId(state)).toBe("entry_other");
  });

  it("marks the clock's row while a track is running", () => {
    const state = stageState({
      masterEntryId: "entry_other",
      selectedEntryId: "entry_other",
      playback: { state: PlaybackState.Playing, clock }
    } as Partial<StageState>);
    expect(playingMarkEntryId(state)).toBe("entry_playing");
  });

  it("falls back to the show's row with nothing sounding at all", () => {
    expect(playingMarkEntryId(stageState({ masterEntryId: "stop_1" }))).toBe("stop_1");
  });
});

describe("pageEntrySongId", () => {
  it("holds Elif's page on the playing song while her selection is elsewhere", () => {
    expect(pageEntrySongId(stageState({ ...playing, selectedEntryId: "entry_other" }))).toBe(
      "entry_playing"
    );
  });

  // The master's row is the selection too: `clientRowPatch` puts both on it when the master moves.
  it("opens the song an ELIF KONUSMA leads into", () => {
    const state = stageState({
      masterEntryId: "elif_key_entry_playing_entry_other",
      selectedEntryId: "elif_key_entry_playing_entry_other"
    });
    expect(pageEntrySongId(state)).toBe("entry_other");
  });

  it("opens the song a STOP leads into", () => {
    const gig = {
      id: "gig_1",
      name: "Show",
      setlist: [
        { type: "song", entryId: "entry_playing", songId: "biz" },
        { type: "talk", entryId: "stop_1", label: "STOP" },
        { type: "song", entryId: "entry_other", songId: "kale" }
      ],
      performanceMode: "FOLLOW_SONG_INFO"
    };
    const state = stageState({
      gigs: [gig],
      masterEntryId: "stop_1",
      selectedEntryId: "stop_1"
    } as unknown as Partial<StageState>);
    expect(pageEntrySongId(state)).toBe("entry_other");
  });
});

describe("nextMasterEntryId", () => {
  it("takes the row the master reports while it is playing", () => {
    expect(nextMasterEntryId("a", "b", true)).toBe("b");
  });

  it("leaves an ELIF KONUSMA in place when an idle packet trails the last song", () => {
    expect(nextMasterEntryId("elif_key_a_b", "a", false)).toBe("elif_key_a_b");
  });

  it("keeps what it has when a packet carries no row", () => {
    expect(nextMasterEntryId("a", undefined)).toBe("a");
  });
});

describe("setlistLocked", () => {
  const desk = { deviceKind: "master", syncPeers: [{ deviceKind: "client", deviceName: "Elif" }] };

  it("holds the master's list while a track or the click is sounding, stage or no stage", () => {
    expect(setlistLocked(stageState({ ...desk, ...playing } as Partial<StageState>))).toBe(true);
    expect(
      setlistLocked(stageState({ ...desk, metronomePlaying: true } as Partial<StageState>))
    ).toBe(true);
    expect(setlistLocked(stageState(desk as Partial<StageState>))).toBe(false);
  });

  it("leaves Elif free to reorder the set mid-number", () => {
    expect(setlistLocked(stageState(playing))).toBe(false);
    expect(setlistLocked(stageState({ metronomePlaying: true }))).toBe(false);
  });
});

describe("followsSharedPlayhead for Elif", () => {
  it("stays on the master's row whether or not the band is playing", () => {
    const idle = stageState({ selectedEntryId: "entry_other" });
    expect(followsSharedPlayhead(idle)).toBe(true);
    expect(followsSharedPlayhead(stageState({ ...playing, selectedEntryId: "entry_other" }))).toBe(
      true
    );
  });

  it("holds while only the metronome runs", () => {
    expect(
      followsSharedPlayhead(stageState({ metronomePlaying: true, selectedEntryId: "entry_other" }))
    ).toBe(true);
  });
});