import { describe, expect, it } from "vitest";
import { followSyncSelection, nextJustJoinedStage } from "./master-store";

function client(name: string, selectedEntryId: string | null, justJoinedStage = false) {
  return {
    deviceKind: "client" as const,
    clientSession: "stage" as const,
    syncConnected: true,
    stageName: name,
    selectedEntryId,
    justJoinedStage
  };
}

describe("followSyncSelection", () => {
  it("keeps Elif on her own song while she is live on stage", () => {
    expect(followSyncSelection(client("Elif", "elif-song"), "master-song", true)).toBe("elif-song");
    expect(followSyncSelection(client("Elif", "elif-song"), "master-song", false)).toBe("elif-song");
  });

  it("snaps other live clients to the song that just started", () => {
    expect(followSyncSelection(client("Serkan", "local-song"), "master-song", true)).toBe("master-song");
    expect(followSyncSelection(client("Ada", "local-song"), "master-song", true)).toBe("master-song");
  });

  it("keeps the master's LoadSong selection when a later idle Position arrives", () => {
    expect(followSyncSelection(client("Serkan", "master-song"), "stale-clock-song", false)).toBe(
      "master-song"
    );
  });

  it("takes the incoming song when the client has no selection yet", () => {
    expect(followSyncSelection(client("Serkan", null), "master-song", false)).toBe("master-song");
  });

  it("snaps every client to the master song on join, including Elif", () => {
    expect(followSyncSelection(client("Elif", "elif-song", true), "master-song", true)).toBe(
      "master-song"
    );
    expect(followSyncSelection(client("Serkan", "local-song", true), "master-song", false)).toBe(
      "master-song"
    );
  });

  it("keeps the join snap open through idle Position so Elif can still take LoadSong", () => {
    expect(nextJustJoinedStage(true, false)).toBe(true);
    expect(nextJustJoinedStage(true, true)).toBe(false);
    expect(nextJustJoinedStage(false, true)).toBe(false);
    expect(followSyncSelection(client("Elif", "practice-song", true), "master-song", false)).toBe(
      "master-song"
    );
  });
});
