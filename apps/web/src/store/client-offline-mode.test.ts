import { describe, expect, it } from "vitest";
import { PlaybackState, PlayMode, SetlistPerformanceMode, type Song } from "@dbk/core";
import {
  clientPracticeMode,
  clientStageLive,
  practiceBlocksSongSelect,
  practicePlaysMasterMix,
  practiceShouldPlayNext,
  usesContinuousMetroTransport,
  usesFreeMetroTransport
} from "./master-store";

type TransportState = Parameters<typeof practicePlaysMasterMix>[0];

function song(id: string, playMode: PlayMode): Song {
  return {
    id,
    version: 1,
    title: id,
    duration: 60,
    assets: [],
    tempoMap: [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }],
    sections: [],
    info: { playMode, bpm: 120, numerator: 4, denominator: 4, beats: [true, false, false, false] }
  };
}

function practiceState(options: {
  performanceMode?: SetlistPerformanceMode;
  playMode?: PlayMode;
  nextPlayMode?: PlayMode;
  files?: string[];
  nextFiles?: string[];
  offlineMode?: "practice" | "free";
  deviceKind?: "client" | "master";
  clientSession?: "practice" | "stage";
  syncConnected?: boolean;
  playing?: boolean;
  metronomePlaying?: boolean;
}): TransportState {
  const playMode = options.playMode ?? PlayMode.Playback;
  const songs = [song("s1", playMode)];
  const setlist: Array<{ type: "song"; entryId: string; songId: string }> = [
    { type: "song", entryId: "e1", songId: "s1" }
  ];
  const fileIndex: Record<string, string[]> = { s1: options.files ?? ["Master.mp3"] };
  if (options.nextPlayMode) {
    songs.push(song("s2", options.nextPlayMode));
    setlist.push({ type: "song", entryId: "e2", songId: "s2" });
    fileIndex.s2 = options.nextFiles ?? ["Master.mp3"];
  }
  return {
    deviceKind: options.deviceKind ?? "client",
    clientSession: options.clientSession ?? "practice",
    syncConnected: options.syncConnected ?? false,
    clientOfflineMode: options.offlineMode ?? "practice",
    gigId: "gig",
    selectedEntryId: "e1",
    metronomePlaying: options.metronomePlaying ?? false,
    playback: {
      state: options.playing ? PlaybackState.Playing : PlaybackState.Idle
    },
    songs,
    fileIndex,
    gigs: [
      {
        id: "gig",
        name: "Show",
        date: "",
        musicians: [],
        setlist,
        performanceMode: options.performanceMode ?? SetlistPerformanceMode.FollowSongInfo
      }
    ]
  } as TransportState;
}

describe("client offline mode", () => {
  it("is live only after a client is on stage and synced", () => {
    expect(
      clientStageLive({
        deviceKind: "client",
        clientSession: "stage",
        syncConnected: false
      })
    ).toBe(false);
    expect(
      clientStageLive({
        deviceKind: "client",
        clientSession: "stage",
        syncConnected: true
      })
    ).toBe(true);
    expect(
      clientStageLive({
        deviceKind: "master",
        clientSession: "stage",
        syncConnected: true
      })
    ).toBe(false);
  });

  it("uses practice only when disconnected and PRACTICE is selected", () => {
    expect(
      clientPracticeMode({
        deviceKind: "client",
        clientSession: "practice",
        syncConnected: false,
        clientOfflineMode: "free"
      })
    ).toBe(false);
    expect(
      clientPracticeMode({
        deviceKind: "client",
        clientSession: "practice",
        syncConnected: false,
        clientOfflineMode: "practice"
      })
    ).toBe(true);
    expect(
      clientPracticeMode({
        deviceKind: "client",
        clientSession: "stage",
        syncConnected: true,
        clientOfflineMode: "practice"
      })
    ).toBe(false);
  });
});

describe("practice follows setlist performance modes", () => {
  it("plays Master.mp3 only when Follow Song Info asks for Playback", () => {
    const followPlayback = practiceState({
      performanceMode: SetlistPerformanceMode.FollowSongInfo,
      playMode: PlayMode.Playback
    });
    expect(practicePlaysMasterMix(followPlayback)).toBe(true);
    expect(usesContinuousMetroTransport(followPlayback)).toBe(false);
    expect(usesFreeMetroTransport(followPlayback)).toBe(false);

    const followView = practiceState({
      performanceMode: SetlistPerformanceMode.FollowSongInfo,
      playMode: PlayMode.View
    });
    expect(practicePlaysMasterMix(followView)).toBe(false);
    expect(usesContinuousMetroTransport(followView)).toBe(true);
    expect(usesFreeMetroTransport(followView)).toBe(false);
  });

  it("does not play Master in Click Only, Metronome, or Free", () => {
    const clickOnly = practiceState({
      performanceMode: SetlistPerformanceMode.ClickOnly,
      playMode: PlayMode.Playback
    });
    expect(practicePlaysMasterMix(clickOnly)).toBe(false);
    expect(usesContinuousMetroTransport(clickOnly)).toBe(false);
    expect(usesFreeMetroTransport(clickOnly)).toBe(false);

    const metro = practiceState({
      performanceMode: SetlistPerformanceMode.MetronomeContinuous,
      playMode: PlayMode.Playback
    });
    expect(practicePlaysMasterMix(metro)).toBe(false);
    expect(usesContinuousMetroTransport(metro)).toBe(true);
    expect(usesFreeMetroTransport(metro)).toBe(false);

    const free = practiceState({
      performanceMode: SetlistPerformanceMode.Free,
      playMode: PlayMode.Playback
    });
    expect(practicePlaysMasterMix(free)).toBe(false);
    expect(usesFreeMetroTransport(free)).toBe(true);
    expect(usesContinuousMetroTransport(free)).toBe(true);
  });

  it("keeps the FREE button as a local free override", () => {
    const freeButton = practiceState({
      performanceMode: SetlistPerformanceMode.FollowSongInfo,
      playMode: PlayMode.Playback,
      offlineMode: "free"
    });
    expect(practicePlaysMasterMix(freeButton)).toBe(false);
    expect(usesFreeMetroTransport(freeButton)).toBe(true);
    expect(usesContinuousMetroTransport(freeButton)).toBe(true);
  });

  it("does not drive metro on a live stage client", () => {
    const live = practiceState({
      performanceMode: SetlistPerformanceMode.MetronomeContinuous,
      clientSession: "stage",
      syncConnected: true
    });
    expect(clientPracticeMode(live)).toBe(false);
    expect(practicePlaysMasterMix(live)).toBe(false);
    expect(usesContinuousMetroTransport(live)).toBe(false);
    expect(usesFreeMetroTransport(live)).toBe(false);
  });
});

describe("practice setlist lock and play next", () => {
  it("blocks picking another song while practice is playing", () => {
    expect(practiceBlocksSongSelect(practiceState({}))).toBe(false);
    expect(practiceBlocksSongSelect(practiceState({ playing: true }))).toBe(true);
    expect(practiceBlocksSongSelect(practiceState({ metronomePlaying: true }))).toBe(true);
    expect(
      practiceBlocksSongSelect(
        practiceState({ playing: true, offlineMode: "free" })
      )
    ).toBe(false);
  });

  it("plays next only into another Follow Song Info Master mix", () => {
    expect(
      practiceShouldPlayNext(
        practiceState({
          nextPlayMode: PlayMode.Playback,
          playing: true
        })
      )
    ).toBe(true);
    expect(
      practiceShouldPlayNext(
        practiceState({
          nextPlayMode: PlayMode.View,
          playing: true
        })
      )
    ).toBe(false);
    expect(practiceShouldPlayNext(practiceState({ playing: true }))).toBe(false);
    expect(
      practiceShouldPlayNext(
        practiceState({
          performanceMode: SetlistPerformanceMode.ClickOnly,
          nextPlayMode: PlayMode.Playback,
          playing: true
        })
      )
    ).toBe(false);
  });
});

