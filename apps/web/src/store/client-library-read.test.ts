import { describe, expect, it } from "vitest";
import { PlaybackState, type Song } from "@dbk/core";
import {
  followsSharedPlayhead,
  masterRowPatch,
  readingOffShow,
  pageEntryId,
  pageEntrySongId,
  showEntryId
} from "./master-store";
import { librarySongsNotOnSetlist, songOnSetlist } from "./song-library";

type StageState = Parameters<typeof followsSharedPlayhead>[0];

function song(id: string, folder?: string): Song {
  return {
    id,
    folder,
    version: 1,
    title: id,
    key: "Am",
    info: { key: "Am", playMode: "PLAYBACK" },
    duration: 60,
    assets: [],
    tempoMap: [],
    sections: []
  } as unknown as Song;
}

/**
 * A band member on the stage can look a song up out of the library mid-set. These cover that the
 * page goes to what they opened, stops following the playhead while they read, and is handed back
 * to the show the moment the master moves.
 */
function stageState(over: Partial<StageState> = {}): StageState {
  return {
    deviceKind: "client",
    clientSession: "stage",
    syncConnected: true,
    stageName: "Serkan",
    syncPeers: [],
    metronomePlaying: false,
    autoScroll: true,
    selectedEntryId: "entry_playing",
    masterEntryId: "entry_playing",
    readingEntryId: null,
    gigId: "gig_1",
    gigs: [
      {
        id: "gig_1",
        name: "Show",
        setlist: [{ type: "song", entryId: "entry_playing", songId: "biz" }],
        performanceMode: "FOLLOW_SONG_INFO"
      }
    ],
    songs: [song("biz"), song("kale")],
    fileIndex: {},
    playback: {
      state: PlaybackState.Playing,
      clock: { setlistEntryId: "entry_playing", songId: "biz", time: 12 }
    },
    ...over
  } as unknown as StageState;
}

describe("reading a song out of the library", () => {
  it("puts the page on what was opened while the show stays where the master left it", () => {
    const state = stageState({ readingEntryId: "practice_kale" });
    expect(readingOffShow(state)).toBe(true);
    expect(pageEntryId(state)).toBe("practice_kale");
    expect(pageEntrySongId(state)).toBe("practice_kale");
    expect(showEntryId(state)).toBe("entry_playing");
  });

  it("stops following the playhead so the show cannot scroll it away", () => {
    expect(followsSharedPlayhead(stageState())).toBe(true);
    expect(followsSharedPlayhead(stageState({ readingEntryId: "practice_kale" }))).toBe(false);
  });

  it("leaves the master's own page alone", () => {
    const state = stageState({ deviceKind: "master", readingEntryId: "practice_kale" });
    expect(pageEntryId(state)).toBe("entry_playing");
  });
});

describe("masterRowPatch", () => {
  it("hands the page back to the show when the master moves", () => {
    expect(
      masterRowPatch({ masterEntryId: "entry_playing", readingEntryId: "practice_kale" }, "entry_two")
    ).toEqual({ masterEntryId: "entry_two", readingEntryId: null });
  });

  it("keeps the read song while the master stays put", () => {
    expect(
      masterRowPatch(
        { masterEntryId: "entry_playing", readingEntryId: "practice_kale" },
        "entry_playing"
      )
    ).toEqual({ masterEntryId: "entry_playing", readingEntryId: "practice_kale" });
  });

  it("keeps the read song when an idle packet trails the last song", () => {
    expect(
      masterRowPatch({ masterEntryId: "elif_1", readingEntryId: "practice_kale" }, "entry_playing", false)
    ).toEqual({ masterEntryId: "elif_1", readingEntryId: "practice_kale" });
  });
});

describe("songOnSetlist", () => {
  it("matches a song named by its folder as well as its id", () => {
    const listed = song("song_1", "biz-bize");
    const entries = [{ type: "song" as const, entryId: "e1", songId: "biz-bize" }];
    expect(songOnSetlist(listed, entries)).toBe(true);
    expect(songOnSetlist(song("song_2"), entries)).toBe(false);
    expect(librarySongsNotOnSetlist([listed, song("song_2")], entries).map((s) => s.id)).toEqual([
      "song_2"
    ]);
  });
});
