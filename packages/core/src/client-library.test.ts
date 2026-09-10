import { describe, expect, it } from "vitest";
import {
  dropMissingSetlistSongs,
  localFoldersNotOnRemote,
  needsClientLibraryDownload,
  publishedSongTitle,
  resolvePublishedSongId
} from "./client-library.js";
import { FinishMode, type Gig } from "./models.js";

describe("needsClientLibraryDownload", () => {
  it("downloads missing files and hash changes", () => {
    expect(needsClientLibraryDownload(undefined, { size: 10, hash: "a" })).toBe(true);
    expect(needsClientLibraryDownload({ size: 10, hash: "a" }, { size: 10, hash: "a" })).toBe(false);
    expect(needsClientLibraryDownload({ size: 10, hash: "a" }, { size: 10, hash: "b" })).toBe(true);
    expect(needsClientLibraryDownload({ size: 8 }, { size: 10, hash: "a" })).toBe(true);
    expect(needsClientLibraryDownload({ size: 10 }, { size: 10, hash: "a" })).toBe(false);
  });
});

describe("resolvePublishedSongId", () => {
  const songs = [
    { id: "tanridan_diledim", title: "Tanrıdan Diledim", folder: "tanridan_diledim" },
    { id: "karahisar_kalesi", title: "Karahisar Kalesi", folder: "karahisar_kalesi" }
  ];

  it("matches spaced and damaged ids to library folders", () => {
    expect(resolvePublishedSongId("Karahisar Kalesi", songs)).toBe("karahisar_kalesi");
    expect(resolvePublishedSongId("tanr\uFFFD_dan_diledim", songs)).toBe("tanridan_diledim");
  });
});

describe("localFoldersNotOnRemote", () => {
  it("drops folders that GitHub no longer publishes", () => {
    expect(localFoldersNotOnRemote(["biz", "telli_turnam", "old_song"], ["biz", "telli_turnam"])).toEqual([
      "old_song"
    ]);
  });
});

describe("dropMissingSetlistSongs", () => {
  it("removes setlist entries whose songs left the library", () => {
    const gig: Gig = {
      id: "gig",
      name: "Show",
      date: "2026-09-07",
      musicians: [],
      setlist: [
        { type: "song", entryId: "a", songId: "biz", finishMode: FinishMode.Stop },
        { type: "song", entryId: "b", songId: "gone", finishMode: FinishMode.Stop }
      ]
    };
    expect(dropMissingSetlistSongs([gig], ["biz"])[0]?.setlist.map((entry) => entry.entryId)).toEqual(["a"]);
  });

  it("keeps a skipped song even when the published id needs remapping", () => {
    const gig: Gig = {
      id: "gig",
      name: "Show",
      date: "2026-09-07",
      musicians: [],
      setlist: [
        { type: "song", entryId: "a", songId: "biz" },
        { type: "song", entryId: "b", songId: "telli_turnam", skipped: true }
      ]
    };
    const next = dropMissingSetlistSongs([gig], [
      { id: "biz", folder: "biz" },
      { id: "Telli Turnam", folder: "telli_turnam", title: "Telli Turnam" }
    ]);
    expect(next[0]?.setlist.map((entry) => entry.entryId)).toEqual(["a", "b"]);
    expect(next[0]?.setlist[1]).toMatchObject({ songId: "telli_turnam", skipped: true });
  });
});

describe("publishedSongTitle", () => {
  it("prefers the master name when the published folder is a slug", () => {
    expect(
      publishedSongTitle({ id: "Karahisar Kalesi", folder: "karahisar_kalesi" })
    ).toBe("Karahisar Kalesi");
    expect(publishedSongTitle({ id: "biz", folder: "biz", title: "Biz" })).toBe("Biz");
    expect(
      publishedSongTitle({ id: "karahisar_kalesi", folder: "karahisar_kalesi" })
    ).toBe("Karahisar Kalesi");
  });
});
