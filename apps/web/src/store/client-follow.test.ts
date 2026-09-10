import { describe, expect, it } from "vitest";
import { followSyncSelection } from "./master-store";

function client(name: string, selectedEntryId: string | null) {
  return {
    deviceKind: "client" as const,
    clientSession: "stage" as const,
    syncConnected: true,
    stageName: name,
    selectedEntryId
  };
}

describe("followSyncSelection", () => {
  it("keeps Elif on her own song while she is live on stage", () => {
    expect(followSyncSelection(client("Elif", "elif-song"), "master-song")).toBe("elif-song");
  });

  it("snaps Serkan and other clients to the master's song", () => {
    expect(followSyncSelection(client("Serkan", "local-song"), "master-song")).toBe("master-song");
    expect(followSyncSelection(client("Ada", "local-song"), "master-song")).toBe("master-song");
  });

  it("snaps a disconnected or unnamed client to the master's song", () => {
    expect(
      followSyncSelection(
        {
          deviceKind: "client",
          clientSession: "practice",
          syncConnected: false,
          stageName: "Serkan",
          selectedEntryId: "local-song"
        },
        "master-song"
      )
    ).toBe("master-song");
  });
});
