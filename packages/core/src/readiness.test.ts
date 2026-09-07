import { describe, expect, it } from "vitest";
import { FinishMode, createId } from "./models.js";
import type { Gig, Song } from "./models.js";
import { checkGigReadiness } from "./readiness.js";
import {
  canInsertElifAfter,
  elifPlacementValid,
  estimateSetDuration,
  insertAfterSelected,
  moveEntry,
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
    expect(songFollowedByElif([a, talk, b], 0)).toBe(true);
    expect(songFollowedByElif([a, b], 0)).toBe(false);
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
});
