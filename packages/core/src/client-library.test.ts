import { describe, expect, it } from "vitest";
import { needsClientLibraryDownload } from "./client-library.js";

describe("needsClientLibraryDownload", () => {
  it("downloads missing files and hash changes", () => {
    expect(needsClientLibraryDownload(undefined, { size: 10, hash: "a" })).toBe(true);
    expect(needsClientLibraryDownload({ size: 10, hash: "a" }, { size: 10, hash: "a" })).toBe(false);
    expect(needsClientLibraryDownload({ size: 10, hash: "a" }, { size: 10, hash: "b" })).toBe(true);
    expect(needsClientLibraryDownload({ size: 8 }, { size: 10, hash: "a" })).toBe(true);
    expect(needsClientLibraryDownload({ size: 10 }, { size: 10, hash: "a" })).toBe(false);
  });
});
