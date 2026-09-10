import { describe, expect, it } from "vitest";
import { createLogger, memorySink, type LogEvent } from "@dbk/logger";
import { FakeAudioEngine } from "./fake-audio-engine.js";
import { ELIF_KONUSMA_LABEL, FinishMode, PlaybackState, PlayMode } from "./models.js";
import type { AssetRef, Gig, LoadedBuffers, Song } from "./models.js";
import { PlaybackController } from "./playback-controller.js";

function audioAsset(id: string, audioRole: "backing" | "click", path: string): AssetRef {
  return {
    id,
    kind: "audio",
    audioRole,
    path,
    hash: id,
    bus: audioRole === "click" ? "CUE" : "MAIN",
    label: audioRole === "click" ? "Click" : "Backing"
  };
}

function makeSong(
  id: string,
  title: string,
  backing: number,
  click: number
): Song {
  return {
    id,
    version: 1,
    title,
    duration: Math.max(backing, click),
    clickDuration: click,
    assets: [audioAsset(`${id}_bk`, "backing", "backing.wav"), audioAsset(`${id}_ck`, "click", "click.wav")],
    tempoMap: [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }],
    sections: [
      { name: "INTRO", start: 0, end: Math.min(4, backing) },
      { name: "VERSE 1", start: Math.min(4, backing), end: backing }
    ]
  };
}

function buffers(song: Song): LoadedBuffers {
  return {
    tracks: song.assets
      .filter((asset) => asset.kind === "audio")
      .map((asset) => ({
        id: asset.id,
        asset,
        duration: asset.audioRole === "click" ? (song.clickDuration ?? 0) : song.duration
      }))
  };
}

function makeGig(entries: Gig["setlist"]): Gig {
  return {
    id: "gig_test",
    name: "Test Gig",
    date: "2026-09-12",
    musicians: [],
    setlist: entries
  };
}

async function setup(songs: Song[], gig: Gig) {
  const events: LogEvent[] = [];
  const engine = new FakeAudioEngine();
  const controller = new PlaybackController({
    engine,
    logger: createLogger(memorySink(events)),
    loadBuffers: async (song) => buffers(song)
  });
  await controller.setShow(gig, songs);
  return { engine, controller, events };
}

describe("PlaybackController", () => {
  const songA = makeSong("song_a", "Song A", 12, 8);
  const songB = makeSong("song_b", "Song B", 10, 8);
  const songC = makeSong("song_c", "Song C", 6, 4);

  it("STOP waits for the longest track then stops", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA], gig);
    await controller.selectIndex(0);
    await controller.play();

    engine.advance(8);
    expect(controller.getSnapshot().state).toBe(PlaybackState.Playing);
    expect(controller.getSnapshot().clock?.songId).toBe("song_a");

    engine.advance(4);
    const snap = controller.getSnapshot();
    expect(snap.state).toBe(PlaybackState.Ready);
    expect(snap.clock?.playing).toBe(false);
  });

  it("PLAY_NEXT starts the next song at click EOF and keeps the tail", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller, events } = await setup([songA, songB], gig);
    await controller.selectIndex(0);
    await controller.play();
    expect(controller.getSnapshot().preloadedSongId).toBe("song_b");

    engine.advance(7.99);
    expect(controller.getSnapshot().state).toBe(PlaybackState.Playing);
    expect(controller.getSnapshot().clock?.songId).toBe("song_a");
    expect(engine.getDeck("A")?.isPlaying).toBe(true);
    expect(engine.getDeck("B")?.isPlaying).toBe(false);

    engine.advance(0.02);
    const mid = controller.getSnapshot();
    expect(mid.state).toBe(PlaybackState.Transitioning);
    expect(mid.clock?.songId).toBe("song_b");
    expect(engine.getDeck("A")?.isPlaying).toBe(true);
    expect(engine.getDeck("B")?.isPlaying).toBe(true);
    expect(events.some((event) => event.event === "play_next")).toBe(true);

    engine.advance(3.98);
    expect(engine.getDeck("A")?.isPlaying).toBe(true);

    engine.advance(0.02);
    const afterTail = controller.getSnapshot();
    expect(afterTail.state).toBe(PlaybackState.Playing);
    expect(afterTail.clock?.songId).toBe("song_b");
    expect(engine.getDeck("A")?.isLoaded).toBe(false);
    expect(engine.getDeck("B")?.isPlaying).toBe(true);
    expect(events.some((event) => event.event === "deck_released")).toBe(true);
  });

  it("PLAY_NEXT starts the next song at nextSongAt when the NEXT marker is set", async () => {
    const markedA = { ...makeSong("song_a", "Song A", 12, 8), nextSongAt: 4 };
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller, events } = await setup([markedA, songB], gig);
    await controller.selectIndex(0);
    await controller.play();

    engine.advance(3.99);
    expect(controller.getSnapshot().clock?.songId).toBe("song_a");
    expect(engine.getDeck("B")?.isPlaying).toBe(false);

    engine.advance(0.02);
    const mid = controller.getSnapshot();
    expect(mid.state).toBe(PlaybackState.Transitioning);
    expect(mid.clock?.songId).toBe("song_b");
    expect(engine.getDeck("A")?.isPlaying).toBe(true);
    expect(engine.getDeck("B")?.isPlaying).toBe(true);
    expect(events.some((event) => event.event === "play_next")).toBe(true);
  });

  it("PLAY_NEXT continues when click and backing end together", async () => {
    const shortA = makeSong("song_a", "Song A", 8, 8);
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([shortA, songB], gig);
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(8.02);
    expect(controller.getSnapshot().clock?.songId).toBe("song_b");
    expect(engine.getDeck("B")?.isPlaying).toBe(true);
  });

  it("PLAY_NEXT continues from a CLICK_ONLY song", async () => {
    const clickOnly = {
      ...makeSong("click_only", "Click Only", 8, 8),
      assets: [audioAsset("click_only_ck", "click", "Click.flac")],
      info: {
        bpm: 120,
        numerator: 4,
        denominator: 4,
        playMode: PlayMode.ClickOnly
      }
    };
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: clickOnly.id },
      { type: "song", entryId: "e2", songId: "song_b" }
    ]);
    const { engine, controller } = await setup([clickOnly, songB], gig);
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(8.02);
    expect(controller.getSnapshot().clock?.songId).toBe("song_b");
    expect(engine.getDeck("B")?.isPlaying).toBe(true);
  });

  it("preloads the following song after a PLAY_NEXT transition", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e3", songId: "song_c", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA, songB, songC], gig);
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(12);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getSnapshot().clock?.songId).toBe("song_b");
    expect(controller.getSnapshot().preloadedSongId).toBe("song_c");
  });

  it("treats PLAY_NEXT on the final song as STOP", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext }
    ]);
    const { engine, controller } = await setup([songA], gig);
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(8);
    expect(controller.getSnapshot().state).toBe(PlaybackState.Playing);
    engine.advance(4);
    expect(controller.getSnapshot().state).toBe(PlaybackState.Ready);
    expect(controller.getSnapshot().clock?.playing).toBe(false);
  });

  it("STOP button halts both decks immediately", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA, songB], gig);
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(2);
    controller.stopImmediate();
    expect(controller.getSnapshot().state).toBe(PlaybackState.Ready);
    expect(engine.getDeck("A")?.isPlaying).toBe(false);
    expect(engine.getDeck("B")?.isPlaying).toBe(false);
  });

  it("fails PLAY_NEXT with a musician-friendly message when click is missing", async () => {
    const noClick: Song = {
      ...songA,
      id: "song_nc",
      clickDuration: undefined,
      assets: [audioAsset("bk", "backing", "backing.wav")]
    };
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_nc", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { controller } = await setup([noClick, songB], gig);
    await controller.selectIndex(0);
    await controller.play();
    expect(controller.getSnapshot().state).toBe(PlaybackState.Error);
    expect(controller.getSnapshot().errorMessage).toBe("Song cannot play: Click track missing.");
  });

  it("seek sets the play position before play", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA], gig);
    await controller.selectIndex(0);
    controller.seek(3);
    expect(controller.getSnapshot().clock?.time).toBeCloseTo(3);

    await controller.play();
    engine.advance(1);
    expect(controller.getSnapshot().clock?.time).toBeCloseTo(4, 1);
  });

  it("holds backing playback at the start of a middle SERBEST section", async () => {
    const song = {
      ...songA,
      sections: [
        { name: "COUNT", start: 0, end: 2 },
        { name: "ARA", start: 2, end: 4 },
        { name: "SERBEST", start: 4, end: 6 },
        { name: "SAN", start: 6, end: 12 }
      ]
    };
    const gig = makeGig([
      {
        type: "song",
        entryId: "e1",
        songId: song.id,
        finishMode: FinishMode.Stop,
        playMode: PlayMode.Playback
      }
    ]);
    const { engine, controller } = await setup([song], gig);
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(4.05);
    const snap = controller.tick();
    expect(snap.state).toBe(PlaybackState.Ready);
    expect(snap.clock?.playing).toBe(false);
    expect(snap.clock?.section).toBe("SERBEST");
    expect(snap.clock?.time).toBeCloseTo(4);
  });

  it("holds before automatically chaining into a song that starts with SERBEST", async () => {
    const markedSong = { ...songA, nextSongAt: 8 };
    const serbestSong = {
      ...songB,
      sections: [
        { name: "SERBEST", start: 0, end: 2 },
        { name: "COUNT", start: 2, end: 4 },
        { name: "SAN", start: 4, end: 10 }
      ]
    };
    const gig = makeGig([
      {
        type: "song",
        entryId: "e1",
        songId: markedSong.id,
        finishMode: FinishMode.PlayNext,
        playMode: PlayMode.Playback
      },
      {
        type: "song",
        entryId: "e2",
        songId: serbestSong.id,
        finishMode: FinishMode.Stop,
        playMode: PlayMode.Playback
      }
    ]);
    const { engine, controller } = await setup([markedSong, serbestSong], gig);
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(8.05);
    expect(controller.getSnapshot().clock?.songId).toBe(serbestSong.id);
    expect(controller.getSnapshot().state).toBe(PlaybackState.Transitioning);
    expect(engine.getDeck("A")?.isPlaying).toBe(true);
    expect(engine.getDeck("B")?.isPlaying).toBe(false);

    engine.advance(4);
    expect(controller.getSnapshot().state).toBe(PlaybackState.Ready);
    expect(engine.getDeck("B")?.isPlaying).toBe(false);
  });

  it("PLAY_NEXT starts the next backing song after its BOS count-in", async () => {
    const next = {
      ...songB,
      sections: [
        { name: "BOS", start: 0, end: 2 },
        { name: "ARA", start: 2, end: 10 }
      ]
    };
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA, next], gig);
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(8.02);
    expect(controller.getSnapshot().clock?.songId).toBe("song_b");
    expect(controller.getSnapshot().clock?.time).toBeCloseTo(2, 1);
    expect(engine.getDeck("B")?.getPosition()).toBeCloseTo(2, 1);
  });

  it("stops instead of PLAY_NEXT when the next song has no backing track", async () => {
    const viewOnly = {
      ...songB,
      assets: []
    };
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA, viewOnly], gig);
    let endedTo: string | null = null;
    controller.subscribe((snap) => {
      if (snap.endedToEntryId) endedTo = snap.endedToEntryId;
    });
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(12.02);
    expect(controller.getSnapshot().clock?.songId).toBe("song_a");
    expect(controller.getSnapshot().clock?.playing).toBe(false);
    expect(endedTo).toBe("e2");
    expect(engine.getDeck("B")?.isPlaying).toBe(false);
  });

  it("ends from the last section and hands off a VIEW song", async () => {
    const clickSong = {
      ...songA,
      duration: 24,
      clickDuration: 24,
      nextSongAt: 24,
      sections: [
        { name: "SAN B", start: 0, end: 20 },
        { name: "ARA", start: 20, end: 24 }
      ]
    };
    const viewOnly = {
      ...songB,
      info: { bpm: 110, numerator: 4, denominator: 4, playMode: PlayMode.View }
    };
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([clickSong, viewOnly], gig);
    let endedTo: string | null = null;
    controller.subscribe((snap) => {
      if (snap.endedToEntryId) endedTo = snap.endedToEntryId;
    });
    await controller.selectIndex(0);
    controller.seek(20);
    await controller.play();
    engine.advance(4.02);
    expect(controller.getSnapshot().clock?.playing).toBe(false);
    expect(endedTo).toBe("e2");
    expect(engine.getDeck("B")?.isPlaying).toBe(false);
  });

  it("stops instead of PLAY_NEXT when the next song is VIEW", async () => {
    const viewOnly = {
      ...songB,
      info: { bpm: 120, numerator: 4, denominator: 4, playMode: PlayMode.View }
    };
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA, viewOnly], gig);
    let endedTo: string | null = null;
    controller.subscribe((snap) => {
      if (snap.endedToEntryId) endedTo = snap.endedToEntryId;
    });
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(12.02);
    expect(controller.getSnapshot().clock?.songId).toBe("song_a");
    expect(controller.getSnapshot().clock?.playing).toBe(false);
    expect(endedTo).toBe("e2");
    expect(engine.getDeck("B")?.isPlaying).toBe(false);
  });

  it("plays the next backing track when a song ends", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.Stop },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA, songB], gig);
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(8.02);
    expect(controller.getSnapshot().clock?.songId).toBe("song_b");
    expect(engine.getDeck("B")?.isPlaying).toBe(true);
  });

  it("selects the next song without playing when the next song key changes", async () => {
    const inD = { ...songA, info: { bpm: 120, numerator: 4, denominator: 4, key: "D" } };
    const inB = { ...songB, info: { bpm: 120, numerator: 4, denominator: 4, key: "B" } };
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([inD, inB], gig);
    let endedTo: string | null = null;
    controller.subscribe((snap) => {
      if (snap.endedToEntryId) endedTo = snap.endedToEntryId;
    });
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(12.02);
    expect(controller.getSnapshot().state).toBe(PlaybackState.Ready);
    expect(controller.getSnapshot().clock?.playing).toBe(false);
    expect(endedTo).toBe("e2");
    expect(engine.getDeck("B")?.isPlaying).toBe(false);
  });

  it("keeps playing when a song is inserted into the setlist", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA, songB, songC], gig);
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(2);
    controller.replaceSongs([songA, songB, songC]);
    controller.replaceShow(
      makeGig([
        { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
        { type: "song", entryId: "e3", songId: "song_c", finishMode: FinishMode.PlayNext },
        { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
      ])
    );
    const snap = controller.getSnapshot();
    expect(snap.state).toBe(PlaybackState.Playing);
    expect(snap.clock?.setlistEntryId).toBe("e1");
    expect(snap.clock?.songId).toBe("song_a");
    expect(snap.currentIndex).toBe(0);
    expect(engine.getDeck("A")?.isPlaying).toBe(true);
  });

  it("remaps the playing index when a song is inserted before it", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.Stop },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA, songB, songC], gig);
    await controller.selectIndex(1);
    await controller.play();
    controller.replaceShow(
      makeGig([
        { type: "song", entryId: "e3", songId: "song_c", finishMode: FinishMode.Stop },
        { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.Stop },
        { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
      ])
    );
    const snap = controller.getSnapshot();
    expect(snap.state).toBe(PlaybackState.Playing);
    expect(snap.currentIndex).toBe(2);
    expect(snap.clock?.setlistEntryId).toBe("e2");
    expect(engine.getDeck("A")?.isPlaying).toBe(true);
  });

  it("PLAY_NEXT jumps over a skipped song", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.PlayNext, skipped: true },
      { type: "song", entryId: "e3", songId: "song_c", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA, songB, songC], gig);
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(8.02);
    expect(controller.getSnapshot().clock?.songId).toBe("song_c");
    expect(engine.getDeck("B")?.isPlaying).toBe(true);
  });

  it("stops PLAY_NEXT when every later song is skipped", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop, skipped: true }
    ]);
    const { engine, controller } = await setup([songA, songB], gig);
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(12.02);
    const snap = controller.getSnapshot();
    expect(snap.state).toBe(PlaybackState.Ready);
    expect(snap.clock?.songId).toBe("song_a");
    expect(snap.clock?.playing).toBe(false);
    expect(engine.getDeck("B")?.isPlaying).toBe(false);
  });

  it("stops PLAY_NEXT when a skipped song is followed by ELIF KONUSMA", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.PlayNext, skipped: true },
      { type: "talk", entryId: "elif1", label: ELIF_KONUSMA_LABEL },
      { type: "song", entryId: "e3", songId: "song_c", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA, songB, songC], gig);
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(12.02);
    const snap = controller.getSnapshot();
    expect(snap.state).toBe(PlaybackState.Ready);
    expect(snap.clock?.songId).toBe("song_a");
    expect(snap.clock?.playing).toBe(false);
    expect(engine.getDeck("B")?.isPlaying).toBe(false);
  });

  it("selects the next song without playing when ELIF KONUSMA follows", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "talk", entryId: "elif1", label: ELIF_KONUSMA_LABEL },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA, songB], gig);
    let endedTo: string | null = null;
    controller.subscribe((snap) => {
      if (snap.endedToEntryId) endedTo = snap.endedToEntryId;
    });
    await controller.selectIndex(0);
    await controller.play();
    engine.advance(12.02);
    const snap = controller.getSnapshot();
    expect(snap.state).toBe(PlaybackState.Ready);
    expect(snap.clock?.songId).toBe("song_a");
    expect(snap.clock?.playing).toBe(false);
    expect(endedTo).toBe("e2");
    expect(engine.getDeck("B")?.isPlaying).toBe(false);
  });

  it("keeps loaded buffers when selecting the same song again", async () => {
    const gig = makeGig([{ type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.Stop }]);
    let loads = 0;
    const events: LogEvent[] = [];
    const engine = new FakeAudioEngine();
    const controller = new PlaybackController({
      engine,
      logger: createLogger(memorySink(events)),
      loadBuffers: async (song) => {
        loads += 1;
        return buffers(song);
      }
    });
    await controller.setShow(gig, [songA]);
    await controller.selectIndex(0);
    await controller.play();
    await controller.selectIndex(0);
    expect(loads).toBe(1);
    expect(controller.getSnapshot().state).toBe(PlaybackState.Playing);
  });

  it("updates a loaded song when the library changes", async () => {
    const gig = makeGig([{ type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.Stop }]);
    const { engine, controller } = await setup([songA], gig);
    await controller.selectIndex(0);
    controller.replaceSongs([{ ...songA, info: { playMode: PlayMode.ClickOnly } }]);
    expect(engine.getDeck("A")?.state.song?.info).toEqual({ playMode: PlayMode.ClickOnly });
  });

  it("preview play stays on the selected song instead of PLAY_NEXT", async () => {
    const gig = makeGig([
      { type: "song", entryId: "e1", songId: "song_a", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: "e2", songId: "song_b", finishMode: FinishMode.Stop }
    ]);
    const { engine, controller } = await setup([songA, songB], gig);
    await controller.selectIndex(0);
    await controller.play({ chain: false });
    engine.advance(8.02);
    expect(controller.getSnapshot().clock?.songId).toBe("song_a");
    expect(controller.getSnapshot().state).toBe(PlaybackState.Playing);
  });
});
