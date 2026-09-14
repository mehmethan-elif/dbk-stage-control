import { describe, expect, it } from "vitest";
import { PlaybackState, type Song } from "@dbk/core";
import {
  followsSharedPlayhead,
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

describe("pageEntryId on a stage client", () => {
  const idle = { playback: { state: PlaybackState.Ready, clock: null } } as Partial<StageState>;

  it("holds the page on the master's row mid-number, wherever Elif's selection is", () => {
    expect(pageEntryId(stageState({ selectedEntryId: "entry_other" }))).toBe("entry_playing");
    expect(
      pageEntryId(stageState({ ...idle, metronomePlaying: true, selectedEntryId: "entry_other" }))
    ).toBe("entry_playing");
  });

  it("goes where the selection goes once the set is stopped", () => {
    expect(pageEntryId(stageState({ ...idle, selectedEntryId: "entry_other" }))).toBe("entry_other");
  });
});

describe("a STOP the show has landed on", () => {
  const stopped = {
    playback: { state: PlaybackState.Ready, clock: null },
    gigs: [
      {
        id: "gig_1",
        name: "Show",
        setlist: [
          { type: "song", entryId: "entry_playing", songId: "biz" },
          { type: "talk", entryId: "stop_1", label: "STOP" },
          { type: "song", entryId: "entry_other", songId: "kale" }
        ],
        performanceMode: "FOLLOW_SONG_INFO"
      }
    ]
  } as unknown as Partial<StageState>;

  it("scrolls the desk to the STOP itself and opens the song under it", () => {
    const state = stageState({
      ...stopped,
      deviceKind: "master",
      selectedEntryId: "stop_1"
    } as Partial<StageState>);
    expect(pageEntryId(state)).toBe("stop_1");
    expect(pageEntrySongId(state)).toBe("entry_other");
  });

  it("scrolls a band member to the STOP the same way", () => {
    const state = stageState({ ...stopped, masterEntryId: "stop_1", selectedEntryId: "stop_1" });
    expect(pageEntryId(state)).toBe("stop_1");
    expect(pageEntrySongId(state)).toBe("entry_other");
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
