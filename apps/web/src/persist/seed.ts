import { createId } from "@dbk/core";
import type { Gig } from "@dbk/core";

export function seedGig(): Gig {
  return {
    id: "gig_2026_09_12",
    name: "Istanbul - 12 September",
    date: "2026-09-12",
    venue: "",
    musicians: [],
    setlist: [
      { type: "song", entryId: createId("entry"), songId: "song_001" },
      { type: "song", entryId: createId("entry"), songId: "song_002" },
      { type: "song", entryId: createId("entry"), songId: "song_006" },
      { type: "song", entryId: createId("entry"), songId: "song_004" }
    ]
  };
}
