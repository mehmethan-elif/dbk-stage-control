import { describe, expect, it } from "vitest";
import { isRemotePeer, masterSessionUpdate } from "./index.js";

describe("masterSessionUpdate", () => {
  it("stores the first master session without treating it as a restart", () => {
    expect(masterSessionUpdate(null, "boot-1")).toEqual({ sessionId: "boot-1", restarted: false });
  });

  it("keeps a reconnect with the same session", () => {
    expect(masterSessionUpdate("boot-1", "boot-1")).toEqual({
      sessionId: "boot-1",
      restarted: false
    });
  });

  it("marks a refreshed master as a new session", () => {
    expect(masterSessionUpdate("boot-1", "boot-2")).toEqual({ sessionId: "boot-2", restarted: true });
  });

  it("ignores a Hello with no session id", () => {
    expect(masterSessionUpdate("boot-1", undefined)).toEqual({
      sessionId: "boot-1",
      restarted: false
    });
  });
});

describe("isRemotePeer", () => {
  it("counts only the remote device kind, not a band tablet name", () => {
    expect(isRemotePeer({ deviceKind: "remote", deviceName: "REMOTE" })).toBe(true);
    expect(isRemotePeer({ deviceKind: "client", deviceName: "REMOTE" })).toBe(false);
    expect(isRemotePeer({ deviceKind: "client", deviceName: "Elif" })).toBe(false);
  });
});

