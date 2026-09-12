import { describe, expect, it } from "vitest";
import { FinishMode, PlayMode, createId } from "./models.js";
import type { Gig, Song } from "./models.js";
import { checkGigReadiness } from "./readiness.js";
import {
  applyRemoteSetlist,
  canInsertElifAfter,
  effectiveFinishMode,
  shouldAutoStartMetronome,
  elifPlacementValid,
  estimateSetDuration,
  insertAfterSelected,
  insertElifAfterSelected,
  moveEntry,
  nextEndedSelectionId,
  songFollowedByElif,
  withKeyChangeElifs
} from "./setlist.js";
import { ELIF_KONUSMA_LABEL, isLockedElif } from "./models.js";

function song(partial: Partial<Song> & Pick<Song, "id" | "title">): Song {
  return {
    version: 1,
    duration: 10,
    assets: [],
    tempoMap: [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }],
    sections: [{ name: "INTRO", start: 0, end: 10 }],
    ...partial
  };
}

describe("checkGigReadiness", () => {
  it("only reports issues for songs on the gig setlist", () => {
    const ready = song({
      id: "a",
      title: "Ready",
      assets: [
        { id: "bk", kind: "audio", audioRole: "backing", path: "backing.wav", hash: "1" },
        { id: "ck", kind: "audio", audioRole: "click", path: "Click.flac", hash: "2" },
        { id: "lx", kind: "lyrics", path: "lyrics.json", hash: "3" },
        { id: "xml", kind: "musicxml", role: "guitar", path: "guitar.musicxml", hash: "4" }
      ]
    });
    const unusedBroken = song({ id: "b", title: "Broken", assets: [] });
    const gig: Gig = {
      id: "gig",
      name: "Test",
      date: "2026-09-12",
      musicians: [
        { musicianId: "m1", role: "vocal" },
        { musicianId: "m2", role: "guitar" }
      ],
      setlist: [{ type: "song", entryId: "e1", songId: "a", finishMode: FinishMode.Stop }]
    };
    const issues = checkGigReadiness(
      gig,
      new Map([
        ["a", ready],
        ["b", unusedBroken]
      ]),
      { a: ["backing.wav", "Click.flac", "lyrics.json", "guitar.musicxml"] }
    );
    expect(issues).toEqual([]);
  });

  it("reports a musician-friendly click message", () => {
    const missingClick = song({
      id: "a",
      title: "No Click",
      assets: [{ id: "bk", kind: "audio", audioRole: "backing", path: "backing.wav", hash: "1" }]
    });
    const gig: Gig = {
      id: "gig",
      name: "Test",
      date: "2026-09-12",
      musicians: [],
      setlist: [{ type: "song", entryId: "e1", songId: "a", finishMode: FinishMode.PlayNext }]
    };
    const issues = checkGigReadiness(gig, new Map([["a", missingClick]]));
    expect(issues.some((issue) => issue.message === "Click track missing.")).toBe(true);
  });
});

describe("setlist helpers", () => {
  it("reorders without losing entries", () => {
    const a = { type: "song" as const, entryId: "1", songId: "a", finishMode: FinishMode.Stop };
    const b = { type: "song" as const, entryId: "2", songId: "b", finishMode: FinishMode.PlayNext };
    const c = { type: "break" as const, entryId: "3", label: "BREAK" };
    const moved = moveEntry([a, b, c], 2, 0);
    expect(moved.map((entry) => entry.entryId)).toEqual(["3", "1", "2"]);
  });

  it("estimates PLAY_NEXT wall time using click duration", () => {
    const backing = [
      { id: "bk", kind: "audio" as const, audioRole: "backing" as const, path: "backing.wav", hash: "1" },
      { id: "ck", kind: "audio" as const, audioRole: "click" as const, path: "Click.flac", hash: "2" }
    ];
    const songs = new Map<string, Song>([
      ["a", song({ id: "a", title: "A", duration: 12, clickDuration: 8, assets: backing })],
      ["b", song({ id: "b", title: "B", duration: 10, clickDuration: 8, assets: backing })]
    ]);
    const gig: Gig = {
      id: "gig",
      name: "Test",
      date: "2026-09-12",
      musicians: [],
      setlist: [
        { type: "song", entryId: createId("e"), songId: "a", finishMode: FinishMode.PlayNext },
        { type: "song", entryId: createId("e"), songId: "b", finishMode: FinishMode.PlayNext }
      ]
    };
    expect(estimateSetDuration(gig, songs)).toBe(18);
  });

  it("estimates PLAY_NEXT wall time using nextSongAt when present", () => {
    const backing = [
      { id: "bk", kind: "audio" as const, audioRole: "backing" as const, path: "backing.wav", hash: "1" },
      { id: "ck", kind: "audio" as const, audioRole: "click" as const, path: "Click.flac", hash: "2" }
    ];
    const songs = new Map<string, Song>([
      ["a", song({ id: "a", title: "A", duration: 12, clickDuration: 8, nextSongAt: 4, assets: backing })],
      ["b", song({ id: "b", title: "B", duration: 10, clickDuration: 8, assets: backing })]
    ]);
    const gig: Gig = {
      id: "gig",
      name: "Test",
      date: "2026-09-12",
      musicians: [],
      setlist: [
        { type: "song", entryId: createId("e"), songId: "a", finishMode: FinishMode.PlayNext },
        { type: "song", entryId: createId("e"), songId: "b", finishMode: FinishMode.PlayNext }
      ]
    };
    expect(estimateSetDuration(gig, songs)).toBe(14);
  });

  it("keeps ELIF KONUSMA before the last song", () => {
    const a = { type: "song" as const, entryId: "1", songId: "a", finishMode: FinishMode.Stop };
    const b = { type: "song" as const, entryId: "2", songId: "b", finishMode: FinishMode.Stop };
    const talk = { type: "talk" as const, entryId: "3", label: ELIF_KONUSMA_LABEL };
    expect(elifPlacementValid([a, talk, b])).toBe(true);
    expect(elifPlacementValid([a, b, talk])).toBe(false);
    expect(canInsertElifAfter([a, b], "1")).toBe(true);
    expect(canInsertElifAfter([a, b], "2")).toBe(false);
    expect(canInsertElifAfter([a], "1")).toBe(false);
    expect(insertElifAfterSelected([a, b], "1", "elif").map((entry) => entry.entryId)).toEqual([
      "1",
      "elif",
      "2"
    ]);
    expect(insertElifAfterSelected([a, b], "1", "elif")[1]).toMatchObject({
      type: "talk",
      label: "STOP"
    });
    expect(insertElifAfterSelected([a, b], "2", "elif")).toEqual([a, b]);
    expect(insertElifAfterSelected([a, b], null, "elif")).toEqual([a, b]);
    expect(songFollowedByElif([a, talk, b], 0)).toBe(true);
    expect(songFollowedByElif([a, b], 0)).toBe(false);
    expect(songFollowedByElif([a, { ...b, skipped: true }, talk], 0)).toBe(true);
    expect(songFollowedByElif([a, { ...b, skipped: true }], 0)).toBe(false);
    expect(nextEndedSelectionId([a, { type: "talk", entryId: "stop", label: "STOP" }, b], 0)).toBe(
      "stop"
    );
    expect(nextEndedSelectionId([a, talk, b], 0)).toBe("2");
    expect(nextEndedSelectionId([a, b], 0)).toBe("2");
    expect(effectiveFinishMode(a, false, [a, { ...b, skipped: true }], 0)).toBe(FinishMode.Stop);
    expect(
      effectiveFinishMode(a, false, [a, { ...b, skipped: true }, { type: "song", entryId: "4", songId: "c" }], 0)
    ).toBe(FinishMode.PlayNext);
  });

  it("plays next into a VIEW song so the metronome can start over the tail", () => {
    const a = { type: "song" as const, entryId: "1", songId: "click", finishMode: FinishMode.PlayNext };
    const b = { type: "song" as const, entryId: "2", songId: "view", finishMode: FinishMode.Stop };
    const songs = new Map<string, Song>([
      [
        "click",
        song({
          id: "click",
          title: "Click",
          assets: [{ id: "ck", kind: "audio", audioRole: "click", path: "Click.flac", hash: "1" }],
          info: { bpm: 120, numerator: 4, denominator: 4, playMode: PlayMode.ClickOnly }
        })
      ],
      [
        "view",
        song({
          id: "view",
          title: "View",
          assets: [{ id: "ck", kind: "audio", audioRole: "click", path: "Click.flac", hash: "1" }],
          info: { bpm: 110, numerator: 4, denominator: 4, playMode: PlayMode.View }
        })
      ]
    ]);
    expect(effectiveFinishMode(a, false, [a, b], 0, songs)).toBe(FinishMode.PlayNext);
    expect(shouldAutoStartMetronome(songs.get("view"))).toBe(true);
  });

  it("does not auto-start a metronome whose START is SERBEST", () => {
    expect(
      shouldAutoStartMetronome(
        song({
          id: "view",
          title: "View",
          info: { bpm: 110, numerator: 4, denominator: 4, playMode: PlayMode.View, startMode: "SERBEST" }
        })
      )
    ).toBe(false);
    expect(
      shouldAutoStartMetronome(
        song({
          id: "packed",
          title: "Packed",
          info: { bpm: 110, numerator: 4, denominator: 4, playMode: PlayMode.View },
          sections: [{ name: "SERBEST", start: 0, end: 8 }]
        })
      )
    ).toBe(false);
    expect(
      shouldAutoStartMetronome(
        song({
          id: "count",
          title: "Count",
          info: { bpm: 110, numerator: 4, denominator: 4, playMode: PlayMode.View, startMode: "COUNT" }
        })
      )
    ).toBe(true);
  });

  it("inserts a locked ELIF KONUSMA when adjacent song keys change", () => {
    const a = { type: "song" as const, entryId: "1", songId: "a", finishMode: FinishMode.Stop };
    const b = { type: "song" as const, entryId: "2", songId: "b", finishMode: FinishMode.Stop };
    const talk = { type: "talk" as const, entryId: "3", label: ELIF_KONUSMA_LABEL };
    const songs = new Map<string, Song>([
      ["a", song({ id: "a", title: "A", info: { bpm: 120, numerator: 4, denominator: 4, key: "D" } })],
      ["b", song({ id: "b", title: "B", info: { bpm: 120, numerator: 4, denominator: 4, key: "B" } })]
    ]);
    const inserted = withKeyChangeElifs([a, b], songs);
    expect(inserted.map((entry) => entry.entryId)).toEqual(["1", "elif_key_1_2", "2"]);
    expect(inserted[1] && isLockedElif(inserted[1])).toBe(true);
    expect(withKeyChangeElifs([a, talk, b], songs).map((entry) => entry.entryId)).toEqual(["1", "3", "2"]);
    expect(songFollowedByElif([a, b], 0, songs)).toBe(true);
    expect(songFollowedByElif([a, talk, b], 0, songs)).toBe(true);
  });

  it("places locked ELIF KONUSMA from the next unskipped song", () => {
    const a = { type: "song" as const, entryId: "1", songId: "a" };
    const skipped = { type: "song" as const, entryId: "2", songId: "b", skipped: true };
    const c = { type: "song" as const, entryId: "3", songId: "c" };
    const songs = new Map<string, Song>([
      ["a", song({ id: "a", title: "A", info: { bpm: 120, numerator: 4, denominator: 4, key: "D" } })],
      ["b", song({ id: "b", title: "B", info: { bpm: 120, numerator: 4, denominator: 4, key: "B" } })],
      ["c", song({ id: "c", title: "C", info: { bpm: 120, numerator: 4, denominator: 4, key: "D" } })]
    ]);
    expect(withKeyChangeElifs([a, skipped, c], songs).map((entry) => entry.entryId)).toEqual([
      "1",
      "2",
      "3"
    ]);
    const otherKey = new Map(songs);
    otherKey.set(
      "c",
      song({ id: "c", title: "C", info: { bpm: 120, numerator: 4, denominator: 4, key: "A" } })
    );
    expect(withKeyChangeElifs([a, skipped, c], otherKey).map((entry) => entry.entryId)).toEqual([
      "1",
      "2",
      "elif_key_1_3",
      "3"
    ]);
    expect(songFollowedByElif([a, skipped, c], 0, songs)).toBe(false);
    expect(songFollowedByElif([a, skipped, c], 0, otherKey)).toBe(true);
  });

  it("inserts a song after the selected setlist entry", () => {
    const a = { type: "song" as const, entryId: "1", songId: "a", finishMode: FinishMode.Stop };
    const b = { type: "song" as const, entryId: "2", songId: "b", finishMode: FinishMode.Stop };
    const talk = { type: "talk" as const, entryId: "3", label: ELIF_KONUSMA_LABEL };
    const added = { type: "song" as const, entryId: "4", songId: "c", finishMode: FinishMode.Stop };
    expect(insertAfterSelected([a, b], "1", added).map((entry) => entry.entryId)).toEqual([
      "1",
      "4",
      "2"
    ]);
    expect(insertAfterSelected([a, talk, b], "3", added).map((entry) => entry.entryId)).toEqual([
      "1",
      "3",
      "4",
      "2"
    ]);
    expect(insertAfterSelected([a, b], "elif_key_1_2", added).map((entry) => entry.entryId)).toEqual([
      "1",
      "4",
      "2"
    ]);
    expect(insertAfterSelected([a, b], null, added).map((entry) => entry.entryId)).toEqual([
      "1",
      "2",
      "4"
    ]);
  });

  it("applies a remote setlist edit while keeping local song fields", () => {
    const a = { type: "song" as const, entryId: "1", songId: "a", finishMode: FinishMode.PlayNext };
    const b = { type: "song" as const, entryId: "2", songId: "b", finishMode: FinishMode.Stop };
    const added = { type: "song" as const, entryId: "3", songId: "c" };
    const next = applyRemoteSetlist(
      [a, b],
      [
        { ...b, skipped: true },
        a,
        added
      ]
    );
    expect(next.map((entry) => entry.entryId)).toEqual(["2", "1", "3"]);
    expect(next[0]).toMatchObject({ songId: "b", skipped: true, finishMode: FinishMode.Stop });
    expect(next[1]).toMatchObject({ songId: "a", finishMode: FinishMode.PlayNext });
    expect(next[2]).toMatchObject({ type: "song", songId: "c" });
  });

  it("keeps the current setlist when a remote edit arrives empty", () => {
    const a = { type: "song" as const, entryId: "1", songId: "a" };
    const skipped = { type: "song" as const, entryId: "2", songId: "b", skipped: true };
    expect(applyRemoteSetlist([a, skipped], [])).toEqual([a, skipped]);
  });

  it("puts an omitted skipped song back in its original slot", () => {
    const a = { type: "song" as const, entryId: "1", songId: "a" };
    const skipped = { type: "song" as const, entryId: "2", songId: "b", skipped: true };
    const c = { type: "song" as const, entryId: "3", songId: "c" };
    const next = applyRemoteSetlist([a, skipped, c], [a, c]);
    expect(next.map((entry) => entry.entryId)).toEqual(["1", "2", "3"]);
    expect(next[1]).toMatchObject({ songId: "b", skipped: true });
  });
});
