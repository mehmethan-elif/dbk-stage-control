import { describe, expect, it, vi } from "vitest";
import type { Gig, Song } from "@dbk/core";
import {
  applyMixerState,
  applyRemoteControl,
  applyRemoteMixer,
  enabledMixerChannels,
  mixerFilesForChannels,
  remoteGigEntries,
  stubSongsFromRemoteSetlist
} from "./soundcheck-remote";

const gig = {
  id: "gig",
  name: "Soundcheck",
  date: "",
  musicians: [],
  setlist: [
    { type: "song", entryId: "e1", songId: "biz" },
    { type: "talk", entryId: "elif", label: "ELIF KONUSMA" },
    { type: "song", entryId: "e2", songId: "telli", skipped: true }
  ]
} as Gig;

const songs = [
  { id: "biz", title: "Biz", folder: "Biz", duration: 179 },
  { id: "telli", title: "Telli Turnam", folder: "telli_turnam", duration: 240 }
] as Song[];

describe("remoteGigEntries", () => {
  it("sends song titles and durations so a phone can skip the library", () => {
    expect(remoteGigEntries(gig, songs)).toEqual([
      { type: "song", entryId: "e1", songId: "biz", title: "Biz", duration: 179 },
      { type: "talk", entryId: "elif", label: "ELIF KONUSMA" },
      {
        type: "song",
        entryId: "e2",
        songId: "telli",
        skipped: true,
        title: "Telli Turnam",
        duration: 240
      }
    ]);
  });
});

describe("stubSongsFromRemoteSetlist", () => {
  it("builds title-only songs from the master setlist snapshot", () => {
    const stubs = stubSongsFromRemoteSetlist([
      { type: "song", entryId: "e1", songId: "biz", title: "Biz", duration: 179 },
      { type: "talk", entryId: "elif", label: "ELIF KONUSMA" },
      { type: "song", entryId: "e2", songId: "biz", title: "Biz", duration: 179 }
    ]);
    expect(stubs).toHaveLength(1);
    expect(stubs[0]?.id).toBe("biz");
    expect(stubs[0]?.title).toBe("Biz");
    expect(stubs[0]?.duration).toBe(179);
  });
});

describe("applyRemoteControl", () => {
  function actions() {
    return {
      selectSetlistEntry: vi.fn(),
      playSelected: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      selectedEntryId: "e1",
      playing: false,
      playingEntryId: null as string | null
    };
  }

  it("selects, plays a different song, and ignores play on the song already running", () => {
    const next = actions();
    applyRemoteControl({ type: "RemoteControl", action: "select", setlistEntryId: "e2" }, next);
    expect(next.selectSetlistEntry).toHaveBeenCalledWith("e2");

    const play = actions();
    applyRemoteControl({ type: "RemoteControl", action: "play", setlistEntryId: "e2" }, play);
    expect(play.selectSetlistEntry).toHaveBeenCalledWith("e2");
    expect(play.playSelected).toHaveBeenCalled();

    const same = actions();
    same.playing = true;
    same.playingEntryId = "e1";
    applyRemoteControl({ type: "RemoteControl", action: "play", setlistEntryId: "e1" }, same);
    expect(same.playSelected).not.toHaveBeenCalled();
  });

  it("stops and seeks", () => {
    const next = actions();
    applyRemoteControl({ type: "RemoteControl", action: "stop" }, next);
    expect(next.stop).toHaveBeenCalled();
    applyRemoteControl({ type: "RemoteControl", action: "seek", time: 12.5 }, next);
    expect(next.seek).toHaveBeenCalledWith(12.5);
  });
});

describe("remote mixer helpers", () => {
  it("lists only stems that exist on the iPad", () => {
    expect(enabledMixerChannels(["Kick.flac", "Main.mp3", "Click.flac"])).toEqual([
      "Click",
      "Kick",
      "Main"
    ]);
    expect(mixerFilesForChannels(["Click", "Kick", "Main"])).toEqual(["Click.flac", "Kick.flac"]);
  });

  it("applies a mixer snapshot onto the phone without a library", () => {
    const next = applyMixerState(
      {
        type: "MixerState",
        busMix: { Main: { gainDb: -3, muted: false, solo: false } },
        metronomeVolume: 0.4,
        songId: "biz",
        songMix: { Kick: { gainDb: 2, muted: true, solo: false } },
        songChannels: ["Kick", "Main"]
      },
      { songMix: {}, fileIndex: {}, songs: [] }
    );
    expect(next.metronomeVolume).toBe(0.4);
    expect(next.busMix.Main.gainDb).toBe(-3);
    expect(next.songMix.biz?.Kick).toEqual({ gainDb: 2, muted: true, solo: false });
    expect(next.fileIndex.biz).toEqual(["Kick.flac"]);
    expect(next.remoteSongMixer).toBe(false);
  });

  it("marks a backing-track song so the phone shows stem faders", () => {
    const next = applyMixerState(
      {
        type: "MixerState",
        busMix: {},
        metronomeVolume: 0.7,
        songId: "Telli Turnam",
        playMode: "PLAYBACK",
        songMixer: true,
        songChannels: ["Kick", "Click", "Main"]
      },
      {
        songMix: {},
        fileIndex: {},
        songs: [{ id: "Telli Turnam", title: "Telli Turnam" } as Song]
      }
    );
    expect(next.remoteSongMixer).toBe(true);
    expect(next.fileIndex["Telli Turnam"]).toEqual(["Kick.flac", "Click.flac"]);
    expect(next.songs[0]?.info?.playMode).toBe("PLAYBACK");
  });

  it("routes phone mixer edits to the iPad engine", () => {
    const actions = {
      setSongMixStrip: vi.fn(),
      setBusMixStrip: vi.fn(),
      setMetronomeVolume: vi.fn()
    };
    applyRemoteMixer(
      { type: "RemoteMixer", target: "bus", channel: "Main", patch: { muted: true } },
      actions
    );
    expect(actions.setBusMixStrip).toHaveBeenCalledWith("Main", { muted: true });
    applyRemoteMixer(
      { type: "RemoteMixer", target: "song", songId: "biz", channel: "Kick", patch: { gainDb: -6 } },
      actions
    );
    expect(actions.setSongMixStrip).toHaveBeenCalledWith("biz", "Kick", { gainDb: -6 });
    applyRemoteMixer({ type: "RemoteMixer", target: "metro", volume: 0.2 }, actions);
    expect(actions.setMetronomeVolume).toHaveBeenCalledWith(0.2);
  });
});
