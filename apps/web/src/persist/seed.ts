import { createId, FinishMode } from "@dbk/core";
import type { Gig } from "@dbk/core";

export function seedGig(): Gig {
  return {
    id: "gig_2026_09_12",
    name: "Istanbul - 12 September",
    date: "2026-09-12",
    venue: "",
    musicians: [],
    setlist: [
      { type: "song", entryId: createId("entry"), songId: "song_001", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: createId("entry"), songId: "song_002", finishMode: FinishMode.PlayNext },
      { type: "song", entryId: createId("entry"), songId: "song_006", finishMode: FinishMode.Stop },
      { type: "song", entryId: createId("entry"), songId: "song_004", finishMode: FinishMode.Stop }
    ]
  };
}
