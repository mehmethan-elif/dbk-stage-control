import { describe, expect, it } from "vitest";
import { remoteBuildNeedsReload } from "./pwa";

describe("remoteBuildNeedsReload", () => {
  it("stays on the running build when the published stamp matches", () => {
    expect(remoteBuildNeedsReload("abc1234", "abc1234")).toBe(false);
  });

  it("takes the published build when the stamp changed", () => {
    expect(remoteBuildNeedsReload("abc1234", "def5678")).toBe(true);
  });

  it("keeps the cached page when version.json is missing", () => {
    expect(remoteBuildNeedsReload("abc1234", undefined)).toBe(false);
    expect(remoteBuildNeedsReload("abc1234", "")).toBe(false);
  });
});
