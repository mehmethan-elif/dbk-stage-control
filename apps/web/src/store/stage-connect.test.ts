import { describe, expect, it } from "vitest";
import { stageConnectOn } from "./stage-connect";

describe("stageConnectOn", () => {
  it("is off for Elif in practice and on after she joins stage", () => {
    expect(
      stageConnectOn({
        deviceKind: "client",
        clientSession: "practice",
        syncConnected: false,
        syncPeers: []
      })
    ).toBe(false);
    expect(
      stageConnectOn({
        deviceKind: "client",
        clientSession: "stage",
        syncConnected: true,
        syncPeers: []
      })
    ).toBe(true);
  });

  it("is on for the soundcheck remote after it joins master", () => {
    expect(
      stageConnectOn({
        deviceKind: "remote",
        clientSession: "practice",
        syncConnected: false,
        syncPeers: []
      })
    ).toBe(false);
    expect(
      stageConnectOn({
        deviceKind: "remote",
        clientSession: "stage",
        syncConnected: true,
        syncPeers: []
      })
    ).toBe(true);
  });

  it("is on for master only when Elif is connected", () => {
    expect(
      stageConnectOn({
        deviceKind: "master",
        clientSession: "practice",
        syncConnected: true,
        syncPeers: []
      })
    ).toBe(false);
    expect(
      stageConnectOn({
        deviceKind: "master",
        clientSession: "practice",
        syncConnected: true,
        syncPeers: [{ deviceKind: "client", deviceName: "Elif" }]
      })
    ).toBe(true);
  });
});
