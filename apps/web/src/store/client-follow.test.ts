import { describe, expect, it } from "vitest";
import { clientRowPatch, nextJustJoinedStage, nextMasterEntryId } from "./master-store";

function client(masterEntryId: string | null, selectedEntryId: string | null) {
  return { masterEntryId, selectedEntryId, readingEntryId: null };
}

describe("clientRowPatch", () => {
  it("puts every device on the song the master has just moved to", () => {
    expect(clientRowPatch(client("master-song", "local-song"), "next-song")).toEqual({
      masterEntryId: "next-song",
      selectedEntryId: "next-song",
      readingEntryId: null
    });
  });

  it("takes a browsing device back when the master presses play on the row it was already on", () => {
    // Play is the move, not the change of row: nothing else would tell the band the song has begun.
    expect(clientRowPatch(client("master-song", "local-song"), "master-song")).toEqual({
      masterEntryId: "master-song",
      selectedEntryId: "master-song",
      readingEntryId: null
    });
  });

  it("leaves a local selection alone when a packet only reports the row it is already on", () => {
    expect(
      clientRowPatch(client("master-song", "local-song"), "master-song", { reporting: true })
    ).toEqual({
      masterEntryId: "master-song",
      selectedEntryId: "local-song",
      readingEntryId: null
    });
  });

  it("keeps the master's row when a later idle Position trails the last song", () => {
    expect(
      clientRowPatch(client("master-song", "local-song"), "stale-clock-song", {
        playing: false,
        reporting: true
      })
    ).toEqual({
      masterEntryId: "master-song",
      selectedEntryId: "local-song",
      readingEntryId: null
    });
  });

  it("takes a changed row off a Position packet, which is the set advancing by itself", () => {
    expect(
      clientRowPatch(client("master-song", "local-song"), "next-song", { reporting: true })
    ).toEqual({
      masterEntryId: "next-song",
      selectedEntryId: "next-song",
      readingEntryId: null
    });
  });

  it("snaps a device that has just joined, its master row still empty", () => {
    expect(clientRowPatch(client(null, "practice-song"), "master-song")).toEqual({
      masterEntryId: "master-song",
      selectedEntryId: "master-song",
      readingEntryId: null
    });
  });

  it("closes a song opened out of the library when the master moves, not on a report", () => {
    const reading = { masterEntryId: "master-song", selectedEntryId: "master-song", readingEntryId: "practice_kale" };
    expect(clientRowPatch(reading, "master-song", { reporting: true }).readingEntryId).toBe(
      "practice_kale"
    );
    expect(clientRowPatch(reading, "master-song").readingEntryId).toBe(null);
    expect(clientRowPatch(reading, "next-song", { reporting: true }).readingEntryId).toBe(null);
  });

  it("holds what it has when a packet carries no row at all", () => {
    expect(clientRowPatch(client("master-song", "local-song"), undefined)).toEqual({
      masterEntryId: "master-song",
      selectedEntryId: "local-song",
      readingEntryId: null
    });
  });
});

describe("nextMasterEntryId", () => {
  it("takes the row the master reports while it is playing", () => {
    expect(nextMasterEntryId("a", "b", true)).toBe("b");
  });

  it("leaves an ELIF KONUSMA in place when an idle packet trails the last song", () => {
    expect(nextMasterEntryId("elif_key_a_b", "a", false)).toBe("elif_key_a_b");
  });
});

describe("nextJustJoinedStage", () => {
  it("keeps the join snap open through idle Position and closes it on LoadSong", () => {
    expect(nextJustJoinedStage(true, false)).toBe(true);
    expect(nextJustJoinedStage(true, true)).toBe(false);
    expect(nextJustJoinedStage(false, true)).toBe(false);
  });
});
