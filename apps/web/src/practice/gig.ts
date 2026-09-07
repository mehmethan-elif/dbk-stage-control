import { FinishMode, type Gig, type Song } from "@dbk/core";

export const PRACTICE_GIG_ID = "practice";

export function practiceEntryId(songId: string): string {
  return `practice_${songId}`;
}

export function practiceGig(songs: Song[]): Gig {
  return {
    id: PRACTICE_GIG_ID,
    name: "Practice",
    date: "",
    musicians: [],
    setlist: songs.map((song) => ({
      type: "song" as const,
      entryId: practiceEntryId(song.id),
      songId: song.id,
      finishMode: FinishMode.Stop
    }))
  };
}
