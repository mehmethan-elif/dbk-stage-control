import { describe, expect, it } from "vitest";
import { PlayMode, type Song } from "@dbk/core";
import {
  SONG_LIBRARY_GIG_ID,
  SONG_LIBRARY_NAME,
  findSongByRef,
  librarySongsNotOnSetlist,
  listedGigs,
  overlayHostSongMeta,
  pickLibraryEntryId,
  selectedLibraryEntries,
  setlistNameTaken,
  withSelectedLibrarySong,
  songLibraryEntryId,
  songLibraryGig
} from "./song-library";

describe("songLibraryGig", () => {
  it("creates deterministic order-only entries for indexed songs", () => {
    const songs = [
      { id: "biz", title: "Biz" },
      { id: "telli-turnam", title: "Telli Turnam" }
    ] as Song[];

    const gig = songLibraryGig(songs);

    expect(gig.id).toBe(SONG_LIBRARY_GIG_ID);
    expect(gig.name).toBe(SONG_LIBRARY_NAME);
    expect(gig.setlist).toEqual([
      { type: "song", entryId: songLibraryEntryId("biz"), songId: "biz" },
      {
        type: "song",
        entryId: songLibraryEntryId("telli-turnam"),
        songId: "telli-turnam"
      }
    ]);
  });
});

describe("listedGigs", () => {
  it("returns the same Song Library and list when the inputs are unchanged", () => {
    const songs = [{ id: "biz", title: "Biz" }] as Song[];
    const show = {
      id: "gig-1",
      name: "Show",
      date: "",
      musicians: [],
      setlist: []
    };
    const gigs = [show];
    expect(songLibraryGig(songs)).toBe(songLibraryGig(songs));
    expect(listedGigs(gigs, songs)).toBe(listedGigs(gigs, songs));
  });

  it("always puts Song Library first and keeps saved setlists after it", () => {
    const songs = [{ id: "biz", title: "Biz" }] as Song[];
    const show = {
      id: "gig-1",
      name: "Show",
      date: "",
      musicians: [],
      setlist: []
    };
    const listed = listedGigs([show], songs);
    expect(listed.map((gig) => gig.id)).toEqual([SONG_LIBRARY_GIG_ID, "gig-1"]);
    expect(listed[0]?.setlist).toEqual([
      { type: "song", entryId: songLibraryEntryId("biz"), songId: "biz" }
    ]);
  });

  it("keeps Song Library performance mode when the catalog is rebuilt", () => {
    const songs = [{ id: "biz", title: "Biz" }] as Song[];
    const show = {
      id: "gig-1",
      name: "Show",
      date: "",
      musicians: [],
      setlist: []
    };
    const library = { ...songLibraryGig(songs), performanceMode: "FREE" as const };
    const listed = listedGigs([library, show], songs);
    expect(listed[0]?.performanceMode).toBe("FREE");
  });
});

describe("setlistNameTaken", () => {
  const show = {
    id: "gig-1",
    name: "Show",
    date: "",
    musicians: [],
    setlist: []
  };

  it("rejects Song Library and duplicate names", () => {
    expect(setlistNameTaken([show], "Song Library")).toBe(true);
    expect(setlistNameTaken([show], "show")).toBe(true);
    expect(setlistNameTaken([show], "Show", "gig-1")).toBe(false);
    expect(setlistNameTaken([show], "Rehearsal")).toBe(false);
  });
});

describe("selectedLibraryEntries", () => {
  it("keeps only the selected library song for the stage", () => {
    const entries = songLibraryGig([
      { id: "biz", title: "Biz" },
      { id: "telli", title: "Telli" }
    ] as Song[]).setlist;
    expect(selectedLibraryEntries(entries, songLibraryEntryId("telli"))).toEqual([
      entries[1]
    ]);
    expect(selectedLibraryEntries(entries, null)).toEqual([entries[0]]);
  });
});

describe("pickLibraryEntryId", () => {
  const songs = [
    { id: "biz", title: "Biz" },
    { id: "telli", folder: "telli_turnam", title: "Telli" }
  ] as Song[];

  it("prefers the remembered library song, then the prior setlist song", () => {
    expect(pickLibraryEntryId(songs, "telli", "biz")).toBe(songLibraryEntryId("telli"));
    expect(pickLibraryEntryId(songs, "missing", "telli_turnam")).toBe(
      songLibraryEntryId("telli")
    );
    expect(pickLibraryEntryId(songs, null, null)).toBe(songLibraryEntryId("biz"));
  });
});

describe("findSongByRef", () => {
  it("matches a published slug to the library song id", () => {
    const songs = [
      { id: "Telli Turnam", folder: "telli_turnam", title: "Telli Turnam" }
    ] as Song[];
    expect(findSongByRef(songs, "telli_turnam")?.title).toBe("Telli Turnam");
  });
});

describe("librarySongsNotOnSetlist", () => {
  it("keeps leftover library songs that are not on the gig", () => {
    const songs = [
      { id: "biz", folder: "biz", title: "Biz" },
      { id: "karahisar_kalesi", folder: "karahisar_kalesi", title: "Karahisar Kalesi" }
    ] as Song[];
    const leftover = librarySongsNotOnSetlist(songs, [
      { type: "song", entryId: "e1", songId: "Biz" }
    ]);
    expect(leftover.map((song) => song.id)).toEqual(["karahisar_kalesi"]);
  });

  it("does not treat a skipped setlist song as leftover library", () => {
    const songs = [
      { id: "biz", folder: "biz", title: "Biz" },
      { id: "telli_turnam", folder: "telli_turnam", title: "Telli Turnam" }
    ] as Song[];
    const leftover = librarySongsNotOnSetlist(songs, [
      { type: "song", entryId: "e1", songId: "biz" },
      { type: "song", entryId: "e2", songId: "telli_turnam", skipped: true }
    ]);
    expect(leftover.map((song) => song.id)).toEqual([]);
  });
});

describe("withSelectedLibrarySong", () => {
  it("appends a leftover library song selected by practice entry id", () => {
    const songs = [
      { id: "Karahisar Kalesi", folder: "karahisar_kalesi", title: "Karahisar Kalesi" }
    ] as Song[];
    const next = withSelectedLibrarySong([], songs, "practice_karahisar_kalesi");
    expect(next).toEqual([
      {
        type: "song",
        entryId: "practice_Karahisar Kalesi",
        songId: "Karahisar Kalesi"
      }
    ]);
  });
});

describe("overlayHostSongMeta", () => {
  it("copies declared play mode from the host when the client has no stems", () => {
    const practice = {
      id: "biz",
      folder: "biz",
      title: "Biz",
      version: 1,
      duration: 60,
      assets: [],
      tempoMap: [],
      sections: [],
      info: { bpm: 120, numerator: 4, denominator: 4, beats: [true, false, false, false] }
    } as Song;
    const host = {
      ...practice,
      id: "Biz",
      folder: "Biz",
      key: "D",
      info: {
        bpm: 132,
        numerator: 4,
        denominator: 4,
        beats: [true, false, false, false],
        playMode: PlayMode.Playback,
        key: "D",
        pageNotes: { drums: "fill" }
      }
    } as Song;

    const [merged] = overlayHostSongMeta([practice], [host]);

    expect(merged?.info?.playMode).toBe(PlayMode.Playback);
    expect(merged?.info?.pageNotes?.drums).toBe("fill");
    expect(merged?.key).toBe("D");
    expect(merged?.title).toBe("Biz");
  });

  it("fills empty practice sections from the host chart", () => {
    const practice = {
      id: "telli_turnam",
      folder: "telli_turnam",
      title: "Telli Turnam",
      version: 1,
      duration: 0,
      assets: [],
      tempoMap: [],
      sections: [],
      info: { bpm: 120, numerator: 4, denominator: 4, beats: [true, false, false, false] }
    } as Song;
    const host = {
      ...practice,
      id: "Telli Turnam",
      folder: "Telli Turnam",
      duration: 195,
      sections: [
        { name: "COUNT", start: 0, end: 2 },
        { name: "NAK 1", start: 74, end: 86 }
      ],
      tempoMap: [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }]
    } as Song;

    const [merged] = overlayHostSongMeta([practice], [host]);

    expect(merged?.duration).toBe(195);
    expect(merged?.sections.map((section) => section.name)).toEqual(["COUNT", "NAK 1"]);
  });
});
