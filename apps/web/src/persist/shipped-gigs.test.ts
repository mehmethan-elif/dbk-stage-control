import { describe, expect, it } from "vitest";
import { isPlaceholderSetlist, mergeShippedGigs, parsePackedGigs } from "./shipped-gigs";
import type { Gig, Song } from "@dbk/core";

const songs = [
  { id: "biz", title: "Biz", folder: "biz" },
  { id: "candan_ileri", title: "Candan İleri", folder: "candan_ileri" }
] as Song[];

const oba: Gig = {
  id: "gig_oba",
  name: "24 Eylül Oba Hotel",
  date: "2026-09-10",
  musicians: [],
  setlist: [
    { type: "song", entryId: "e1", songId: "biz" },
    { type: "song", entryId: "e2", songId: "Candan İleri" }
  ]
};

describe("parsePackedGigs", () => {
  it("reads the published gigs file", () => {
    expect(parsePackedGigs({ gigs: [oba] })).toEqual([oba]);
    expect(parsePackedGigs("<!doctype html>")).toEqual([]);
  });
});

describe("isPlaceholderSetlist", () => {
  it("drops the Istanbul seed that has no library songs", () => {
    expect(
      isPlaceholderSetlist(
        {
          id: "gig_2026_09_12",
          name: "Istanbul - 12 September",
          date: "",
          musicians: [],
          setlist: [{ type: "song", entryId: "e", songId: "song_001" }]
        },
        songs
      )
    ).toBe(true);
  });
});

describe("mergeShippedGigs", () => {
  it("replaces the empty iPad seed with the Mac setlist", () => {
    const seed: Gig = {
      id: "gig_2026_09_12",
      name: "Istanbul - 12 September",
      date: "",
      musicians: [],
      setlist: [{ type: "song", entryId: "e", songId: "song_001" }]
    };
    const merged = mergeShippedGigs([seed], [oba], songs);
    expect(merged.map((gig) => gig.name)).toEqual(["24 Eylül Oba Hotel"]);
    expect(merged[0]?.setlist.map((entry) => "songId" in entry && entry.songId)).toEqual([
      "biz",
      "candan_ileri"
    ]);
  });

  it("keeps a real iPad setlist and adds the missing Mac show", () => {
    const local: Gig = {
      id: "gig_local",
      name: "Rehearsal",
      date: "",
      musicians: [],
      setlist: [{ type: "song", entryId: "e", songId: "biz" }]
    };
    expect(mergeShippedGigs([local], [oba], songs).map((gig) => gig.name)).toEqual([
      "Rehearsal",
      "24 Eylül Oba Hotel"
    ]);
  });
});
