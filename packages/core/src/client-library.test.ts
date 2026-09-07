import { describe, expect, it } from "vitest";
import { needsClientLibraryDownload, resolvePublishedSongId } from "./client-library.js";

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
