import { describe, expect, it } from "vitest";
import { clientPracticeMode, clientStageLive, usesContinuousMetroTransport } from "./master-store";

describe("client offline mode", () => {
  it("is live only after a client is on stage and synced", () => {
    expect(
      clientStageLive({
        deviceKind: "client",
        clientSession: "stage",
        syncConnected: false
      })
    ).toBe(false);
    expect(
      clientStageLive({
        deviceKind: "client",
        clientSession: "stage",
        syncConnected: true
      })
    ).toBe(true);
    expect(
      clientStageLive({
        deviceKind: "master",
        clientSession: "stage",
        syncConnected: true
      })
    ).toBe(false);
  });

  it("uses practice only when disconnected and PRACTICE is selected", () => {
    expect(
      clientPracticeMode({
        deviceKind: "client",
        clientSession: "practice",
        syncConnected: false,
        clientOfflineMode: "free"
      })
    ).toBe(false);
    expect(
      clientPracticeMode({
        deviceKind: "client",
        clientSession: "practice",
        syncConnected: false,
        clientOfflineMode: "practice"
      })
    ).toBe(true);
    expect(
      clientPracticeMode({
        deviceKind: "client",
        clientSession: "stage",
        syncConnected: true,
        clientOfflineMode: "practice"
      })
    ).toBe(false);
  });
});

