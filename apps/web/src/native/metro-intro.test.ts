import { describe, expect, it } from "vitest";
import { bufferLooksLikeFlac, metroIntroFileName, metroIntroHttpUrls } from "./metro-intro";

describe("metroIntroFileName", () => {
  it("accepts only the two intro clicks", () => {
    expect(metroIntroFileName("/library/1.flac")).toBe("1.flac");
    expect(metroIntroFileName("/library/2.flac?t=1")).toBe("2.flac");
    expect(metroIntroFileName("/library/Click.flac")).toBeUndefined();
  });
});

describe("bufferLooksLikeFlac", () => {
  it("rejects empty pages and HTML fallbacks", () => {
    expect(bufferLooksLikeFlac(new ArrayBuffer(0))).toBe(false);
    expect(bufferLooksLikeFlac(new TextEncoder().encode("<!doctype html>").buffer)).toBe(false);
  });

  it("accepts a FLAC header", () => {
    const bytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0, 0]);
    expect(bufferLooksLikeFlac(bytes.buffer)).toBe(true);
  });
});

describe("metroIntroHttpUrls", () => {
  it("keeps /client from stealing the library path", () => {
    expect(metroIntroHttpUrls("1.flac", "http://localhost", "./")).toEqual([
      "http://localhost/library/1.flac",
      "http://localhost/client-library/1.flac"
    ]);
  });

  it("prefixes GitHub pages bases", () => {
    expect(metroIntroHttpUrls("2.flac", "https://example.github.io", "/dbk-stage-control/")).toEqual([
      "https://example.github.io/dbk-stage-control/library/2.flac",
      "https://example.github.io/dbk-stage-control/client-library/2.flac",
      "https://example.github.io/library/2.flac",
      "https://example.github.io/client-library/2.flac"
    ]);
  });
});
