import { describe, expect, it } from "vitest";
import { FinishMode } from "./models.js";
import { MemoryLibraryRepository } from "./persistence.js";

describe("MemoryLibraryRepository", () => {
  it("persists gigs and musicians", async () => {
    const repo = new MemoryLibraryRepository({
      songs: [],
      musicians: [{ id: "m1", name: "Elif Avcı", defaultRole: "vocal" }],
      gigs: []
    });
    await repo.saveGig({
      id: "gig_1",
      name: "Test",
      date: "2026-09-12",
      musicians: [{ musicianId: "m1", role: "vocal" }],
      setlist: [{ type: "song", entryId: "e1", songId: "song_001", finishMode: FinishMode.Stop }]
    });
    const restored = MemoryLibraryRepository.fromJSON(repo.toJSON());
    const gig = await restored.getGig("gig_1");
    expect(gig?.setlist).toHaveLength(1);
    expect((await restored.listMusicians())[0]?.name).toBe("Elif Avcı");
  });
});
