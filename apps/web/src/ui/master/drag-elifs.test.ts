import { describe, expect, it } from "vitest";
import { ELIF_KONUSMA_LABEL, type SetlistEntry } from "@dbk/core";
import { frozenElifs, withFrozenElifs } from "./drag-elifs";

function song(entryId: string): SetlistEntry {
  return { type: "song", entryId, songId: entryId };
}

function lockedElif(entryId: string): SetlistEntry {
  return { type: "talk", entryId, label: ELIF_KONUSMA_LABEL, locked: true };
}

function talk(entryId: string): SetlistEntry {
  return { type: "talk", entryId, label: ELIF_KONUSMA_LABEL };
}

const ids = (entries: readonly SetlistEntry[]) => entries.map((entry) => entry.entryId);

describe("frozenElifs", () => {
  it("remembers each locked row against the row it follows", () => {
    const displayed = [song("a"), lockedElif("k1"), song("b"), song("c"), lockedElif("k2")];
    expect(frozenElifs(displayed)).toEqual([
      { after: "a", entry: lockedElif("k1") },
      { after: "c", entry: lockedElif("k2") }
    ]);
  });

  it("leaves manual talk entries alone", () => {
    expect(frozenElifs([song("a"), talk("t1"), song("b")])).toEqual([]);
  });

  it("marks a leading locked row as having nothing before it", () => {
    expect(frozenElifs([lockedElif("k1"), song("a")])).toEqual([
      { after: null, entry: lockedElif("k1") }
    ]);
  });
});

describe("withFrozenElifs", () => {
  it("puts the rows back behind the same entries after a reorder", () => {
    const frozen = frozenElifs([song("a"), lockedElif("k1"), song("b")]);
    expect(ids(withFrozenElifs([song("b"), song("a")], frozen))).toEqual(["b", "a", "k1"]);
  });

  it("keeps the row in place when the order does not change", () => {
    const displayed = [song("a"), lockedElif("k1"), song("b")];
    const frozen = frozenElifs(displayed);
    expect(ids(withFrozenElifs([song("a"), song("b")], frozen))).toEqual(ids(displayed));
  });

  it("drops a row whose anchor has gone", () => {
    const frozen = frozenElifs([song("a"), lockedElif("k1"), song("b")]);
    expect(ids(withFrozenElifs([song("b")], frozen))).toEqual(["b"]);
  });

  it("returns the order untouched when nothing was frozen", () => {
    expect(ids(withFrozenElifs([song("a"), song("b")], []))).toEqual(["a", "b"]);
  });

  it("keeps a leading row at the front", () => {
    const frozen = frozenElifs([lockedElif("k1"), song("a")]);
    expect(ids(withFrozenElifs([song("a")], frozen))).toEqual(["k1", "a"]);
  });
});
