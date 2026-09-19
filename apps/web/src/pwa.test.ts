import { describe, expect, it } from "vitest";
import { nextBuildReloadAttempt, publishedBuildAction, remoteBuildNeedsReload } from "./pwa";

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

describe("publishedBuildAction", () => {
  it("waits when the stamp moved but the hashed files are not up yet", () => {
    expect(
      publishedBuildAction("abc1234", { build: "def5678", shell: ["./assets/index.js"] }, false)
    ).toBe("wait");
    expect(
      publishedBuildAction("abc1234", { build: "def5678", shell: ["./assets/index.js"] }, true)
    ).toBe("take");
  });

  it("takes an older version.json that has no shell list", () => {
    expect(publishedBuildAction("abc1234", { build: "def5678" }, false)).toBe("take");
  });

  it("stays when the running build already matches", () => {
    expect(publishedBuildAction("def5678", { build: "def5678", shell: ["./assets/index.js"] }, true)).toBe(
      "current"
    );
  });
});

describe("nextBuildReloadAttempt", () => {
  it("retries the same published stamp until the running app matches", () => {
    expect(nextBuildReloadAttempt("def5678", null, 0)).toBe(1);
    expect(nextBuildReloadAttempt("def5678", "def5678", 1)).toBe(2);
    expect(nextBuildReloadAttempt("def5678", "def5678", 2)).toBe(3);
    expect(nextBuildReloadAttempt("def5678", "def5678", 3)).toBeNull();
  });

  it("starts over when a newer stamp appears", () => {
    expect(nextBuildReloadAttempt("fff0000", "def5678", 3)).toBe(1);
  });
});
