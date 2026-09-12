import { describe, expect, it } from "vitest";
import { PlaybackState, PlayMode, SetlistPerformanceMode, type Song } from "@dbk/core";
import {
  clientPracticeMode,
  clientStageLive,
  showsTitlePositionSlider,
  stageHasLiveClients,
  followsMasterMetroVisuals,
  liveSongIsBackingTracks,
  practiceAudioKind,
  practiceBlocksSongSelect,
  practicePlaysMasterMix,
  practiceShouldPlayNext,
  songShowsPositionSlider,
  usesContinuousMetroTransport,
  usesFreeMetroTransport,
  followsFreeMasterClicks,
  metronomeVisualNow,
  remoteMetronomeVisualAt,
  takeRemoteMetronomeSeq
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
    info: { playMode, bpm: 120, numerator: 4, denominator: 4 }
  };
}

function practiceState(options: {
  performanceMode?: SetlistPerformanceMode;
  playMode?: PlayMode;
  nextPlayMode?: PlayMode;
  files?: string[];
  nextFiles?: string[];
  deviceKind?: "client" | "master";
  clientSession?: "practice" | "stage";
  syncConnected?: boolean;
  playing?: boolean;
  metronomePlaying?: boolean;
  selectedEntryId?: string;
  playingEntryId?: string;
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
    gigId: "gig",
    selectedEntryId: options.selectedEntryId ?? "e1",
    metronomePlaying: options.metronomePlaying ?? false,
    playback: {
      state: options.playing ? PlaybackState.Playing : PlaybackState.Idle,
      clock: options.playingEntryId
        ? {
            songId: options.playingEntryId === "e2" ? "s2" : "s1",
            setlistEntryId: options.playingEntryId,
            time: 0,
            measure: 1,
            beat: 1,
            playing: true
          }
        : null
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

  it("shows the title slider only when the stage is unlinked", () => {
    expect(
      showsTitlePositionSlider({
        deviceKind: "master",
        clientSession: "practice",
        syncConnected: true,
        syncPeers: []
      })
    ).toBe(true);
    expect(
      stageHasLiveClients({
        deviceKind: "master",
        syncConnected: true,
        syncPeers: [{ deviceKind: "client", deviceName: "Serkan" }]
      })
    ).toBe(true);
    expect(
      showsTitlePositionSlider({
        deviceKind: "master",
        clientSession: "practice",
        syncConnected: true,
        syncPeers: [{ deviceKind: "client", deviceName: "Serkan" }]
      })
    ).toBe(false);
    expect(
      showsTitlePositionSlider({
        deviceKind: "client",
        clientSession: "practice",
        syncConnected: false,
        syncPeers: []
      })
    ).toBe(true);
    expect(
      showsTitlePositionSlider({
        deviceKind: "client",
        clientSession: "stage",
        syncConnected: true,
        syncPeers: []
      })
    ).toBe(false);
  });

  it("hides the position slider on metronome songs, even with leftover sections", () => {
    const leftover = [{ name: "A", start: 0, end: 8 }];
    const fakeMetro: Song = {
      ...song("metro", PlayMode.View),
      sections: leftover
    };
    const backing: Song = {
      ...song("biz", PlayMode.Playback),
      sections: leftover
    };
    const files = ["Vocals.flac"];

    expect(songShowsPositionSlider(fakeMetro, files, SetlistPerformanceMode.FollowSongInfo)).toBe(
      false
    );
    expect(songShowsPositionSlider(fakeMetro, [], SetlistPerformanceMode.FollowSongInfo)).toBe(false);
    expect(
      songShowsPositionSlider(backing, files, SetlistPerformanceMode.MetronomeContinuous)
    ).toBe(false);
    expect(songShowsPositionSlider(backing, files, SetlistPerformanceMode.FollowSongInfo)).toBe(true);
    expect(songShowsPositionSlider(backing, ["Master.mp3"], SetlistPerformanceMode.FollowSongInfo)).toBe(
      true
    );
    expect(songShowsPositionSlider(song("empty", PlayMode.View), files)).toBe(false);
  });

  it("uses practice when disconnected and follows master when live", () => {
    expect(
      clientPracticeMode({
        deviceKind: "client",
        clientSession: "practice",
        syncConnected: false
      })
    ).toBe(true);
    expect(
      clientPracticeMode({
        deviceKind: "client",
        clientSession: "stage",
        syncConnected: false
      })
    ).toBe(true);
    expect(
      clientPracticeMode({
        deviceKind: "client",
        clientSession: "stage",
        syncConnected: true
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
    expect(practiceAudioKind(followPlayback)).toBe("master");
    expect(practicePlaysMasterMix(followPlayback)).toBe(true);
    expect(usesContinuousMetroTransport(followPlayback)).toBe(false);
    expect(usesFreeMetroTransport(followPlayback)).toBe(false);

    const playbackWithClick = practiceState({
      performanceMode: SetlistPerformanceMode.FollowSongInfo,
      playMode: PlayMode.Playback,
      files: ["Master.mp3", "Click.flac"]
    });
    expect(practiceAudioKind(playbackWithClick)).toBe("master");
    expect(practicePlaysMasterMix(playbackWithClick)).toBe(true);

    const followView = practiceState({
      performanceMode: SetlistPerformanceMode.FollowSongInfo,
      playMode: PlayMode.View
    });
    expect(practicePlaysMasterMix(followView)).toBe(false);
    expect(usesContinuousMetroTransport(followView)).toBe(true);
    expect(usesFreeMetroTransport(followView)).toBe(false);

    const followFree = practiceState({
      performanceMode: SetlistPerformanceMode.FollowSongInfo,
      playMode: PlayMode.Free,
      files: ["Master.mp3", "Click.flac"]
    });
    expect(practiceAudioKind(followFree)).toBeNull();
    expect(practicePlaysMasterMix(followFree)).toBe(false);
    expect(usesFreeMetroTransport(followFree)).toBe(false);
    expect(usesContinuousMetroTransport(followFree)).toBe(true);
  });

  it("treats saved Click Only as Backing Tracks", () => {
    const songClick = practiceState({
      performanceMode: SetlistPerformanceMode.FollowSongInfo,
      playMode: PlayMode.ClickOnly,
      files: ["Master.mp3", "Click.flac"]
    });
    expect(practiceAudioKind(songClick)).toBe("master");
    expect(practicePlaysMasterMix(songClick)).toBe(true);
    expect(usesContinuousMetroTransport(songClick)).toBe(false);

    const clickOnlyFiles = practiceState({
      performanceMode: SetlistPerformanceMode.FollowSongInfo,
      playMode: PlayMode.ClickOnly,
      files: ["Click.flac"]
    });
    expect(practiceAudioKind(clickOnlyFiles)).toBeNull();
    expect(practicePlaysMasterMix(clickOnlyFiles)).toBe(false);

    const legacySetlistClick = practiceState({
      performanceMode: SetlistPerformanceMode.ClickOnly,
      playMode: PlayMode.Playback,
      files: ["Master.mp3", "Click.flac"]
    });
    expect(practiceAudioKind(legacySetlistClick)).toBe("master");
    expect(practicePlaysMasterMix(legacySetlistClick)).toBe(true);
  });

  it("does not play Master in Metronome setlist mode", () => {
    const metro = practiceState({
      performanceMode: SetlistPerformanceMode.MetronomeContinuous,
      playMode: PlayMode.Playback
    });
    expect(practicePlaysMasterMix(metro)).toBe(false);
    expect(usesContinuousMetroTransport(metro)).toBe(true);
    expect(usesFreeMetroTransport(metro)).toBe(false);

    const legacyFree = practiceState({
      performanceMode: SetlistPerformanceMode.Free,
      playMode: PlayMode.Playback
    });
    expect(practicePlaysMasterMix(legacyFree)).toBe(true);
    expect(usesFreeMetroTransport(legacyFree)).toBe(false);
    expect(usesContinuousMetroTransport(legacyFree)).toBe(false);
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
    expect(followsMasterMetroVisuals(live)).toBe(true);
  });

  it("does not use metro when the live playing song is Backing Tracks", () => {
    const liveBacking = practiceState({
      performanceMode: SetlistPerformanceMode.FollowSongInfo,
      playMode: PlayMode.Playback,
      files: ["Master.mp3"],
      clientSession: "stage",
      syncConnected: true,
      playing: true,
      playingEntryId: "e1"
    });
    expect(liveSongIsBackingTracks(liveBacking)).toBe(true);
    expect(followsMasterMetroVisuals(liveBacking)).toBe(false);

    const lookingAtMetro = practiceState({
      performanceMode: SetlistPerformanceMode.FollowSongInfo,
      playMode: PlayMode.Playback,
      nextPlayMode: PlayMode.View,
      files: ["Master.mp3"],
      nextFiles: [],
      clientSession: "stage",
      syncConnected: true,
      playing: true,
      playingEntryId: "e1",
      selectedEntryId: "e2"
    });
    expect(liveSongIsBackingTracks(lookingAtMetro)).toBe(true);
    expect(followsMasterMetroVisuals(lookingAtMetro)).toBe(false);
  });

  it("does not follow master metro visuals unless the client is live on a metronome song", () => {
    expect(
      followsMasterMetroVisuals(
        practiceState({
          performanceMode: SetlistPerformanceMode.MetronomeContinuous,
          clientSession: "stage",
          syncConnected: false
        })
      )
    ).toBe(false);
    expect(
      followsMasterMetroVisuals(
        practiceState({
          performanceMode: SetlistPerformanceMode.FollowSongInfo,
          playMode: PlayMode.Playback,
          files: ["Bass.flac", "Master.mp3"],
          clientSession: "stage",
          syncConnected: true
        })
      )
    ).toBe(false);
    expect(
      followsMasterMetroVisuals(
        practiceState({
          performanceMode: SetlistPerformanceMode.FollowSongInfo,
          playMode: PlayMode.View,
          clientSession: "stage",
          syncConnected: true
        })
      )
    ).toBe(true);
    expect(
      followsMasterMetroVisuals(
        practiceState({
          performanceMode: SetlistPerformanceMode.FollowSongInfo,
          playMode: PlayMode.Free,
          clientSession: "stage",
          syncConnected: true
        })
      )
    ).toBe(true);
    expect(
      usesFreeMetroTransport(
        practiceState({
          performanceMode: SetlistPerformanceMode.FollowSongInfo,
          playMode: PlayMode.Free,
          deviceKind: "master"
        })
      )
    ).toBe(false);
    expect(
      followsMasterMetroVisuals(
        practiceState({
          performanceMode: SetlistPerformanceMode.MetronomeContinuous,
          clientSession: "practice"
        })
      )
    ).toBe(false);
  });

  it("follows only newer master pulse ids", () => {
    expect(takeRemoteMetronomeSeq(null, 1)).toBe(1);
    expect(takeRemoteMetronomeSeq(1, 1)).toBeNull();
    expect(takeRemoteMetronomeSeq(1, 2)).toBe(2);
    expect(takeRemoteMetronomeSeq(4, 3)).toBeNull();
    expect(takeRemoteMetronomeSeq(null, undefined)).toBeNull();
  });

  it("schedules a remote click after the remaining delay instead of painting immediately", () => {
    const now = metronomeVisualNow();
    const at = remoteMetronomeVisualAt(0.08);
    expect(at).toBeGreaterThanOrEqual(now + 0.079);
    expect(at).toBeLessThan(now + 0.1);
    expect(remoteMetronomeVisualAt()).toBeGreaterThanOrEqual(now);
    expect(remoteMetronomeVisualAt(-1)).toBeGreaterThanOrEqual(now);
  });

  it("does not follow master free clicks after Free play mode was removed", () => {
    expect(
      followsFreeMasterClicks(
        practiceState({
          performanceMode: SetlistPerformanceMode.FollowSongInfo,
          playMode: PlayMode.Free,
          deviceKind: "master"
        })
      )
    ).toBe(false);
    expect(
      usesFreeMetroTransport(
        practiceState({
          performanceMode: SetlistPerformanceMode.FollowSongInfo,
          playMode: PlayMode.View
        })
      )
    ).toBe(false);
    expect(
      followsFreeMasterClicks(
        practiceState({
          performanceMode: SetlistPerformanceMode.Free,
          clientSession: "practice",
          syncConnected: false
        })
      )
    ).toBe(false);
    expect(
      followsFreeMasterClicks(
        practiceState({
          performanceMode: SetlistPerformanceMode.FollowSongInfo,
          playMode: PlayMode.View,
          clientSession: "stage",
          syncConnected: true
        })
      )
    ).toBe(false);
  });
});

describe("practice setlist lock and play next", () => {
  it("blocks picking another song while practice is playing", () => {
    expect(practiceBlocksSongSelect(practiceState({}))).toBe(false);
    expect(practiceBlocksSongSelect(practiceState({ playing: true }))).toBe(true);
    expect(practiceBlocksSongSelect(practiceState({ metronomePlaying: true }))).toBe(true);
  });

  it("does not play next into a Click.flac-only song", () => {
    expect(
      practiceShouldPlayNext(
        practiceState({
          playMode: PlayMode.ClickOnly,
          files: ["Click.flac"],
          nextPlayMode: PlayMode.ClickOnly,
          nextFiles: ["Click.flac"],
          playing: true
        })
      )
    ).toBe(false);
    expect(
      practiceShouldPlayNext(
        practiceState({
          playMode: PlayMode.ClickOnly,
          files: ["Click.flac"],
          nextPlayMode: PlayMode.View,
          playing: true
        })
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
          performanceMode: SetlistPerformanceMode.MetronomeContinuous,
          nextPlayMode: PlayMode.Playback,
          playing: true
        })
      )
    ).toBe(false);
  });
});

