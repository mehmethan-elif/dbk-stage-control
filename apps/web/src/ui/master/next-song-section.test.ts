import { describe, expect, it } from "vitest";
import { ELIF_KONUSMA_LABEL, STOP_LABEL, withKeyChangeElifs, type SetlistEntry, type Song } from "@dbk/core";
import {
  isPlayingLastSection,
  isUpcomingLeadInTime,
  nextSetlistSongEntry,
  nextTransportEntry,
  nextTransportSongEntry,
  songLeadInSection,
  upcomingSongLeadIn
} from "./next-song-section";

function song(id: string, sections: Song["sections"]): Song {
  return {
    id,
    version: 1,
    title: id,
    duration: sections.at(-1)?.end ?? 0,
    assets: [],
    tempoMap: [],
    sections
  };
}

describe("upcomingSongLeadIn", () => {
  const biz = song("biz", [
    { name: "COUNT", start: 0, end: 2 },
    { name: "SAN", start: 2, end: 170 },
    { name: "FINAL", start: 170, end: 176 }
  ]);
  const telli = song("telli_turnam", [
    { name: "COUNT", start: 0, end: 2 },
    { name: "ARA 1", start: 2, end: 14 }
  ]);
  const entries: SetlistEntry[] = [
    { type: "song", entryId: "e1", songId: "biz" },
    { type: "song", entryId: "e2", songId: "telli_turnam" }
  ];

  it("is false until the last section starts", () => {
    expect(isPlayingLastSection(biz, 169.9)).toBe(false);
    expect(isPlayingLastSection(biz, 170)).toBe(true);
  });

  it("skips skipped songs and stops before ELIF KONUSMA", () => {
    expect(nextSetlistSongEntry(entries, "e1")?.entryId).toBe("e2");
    expect(
      nextSetlistSongEntry(
        [
          { type: "song", entryId: "e1", songId: "biz" },
          { type: "song", entryId: "e2", songId: "telli_turnam", skipped: true },
          { type: "song", entryId: "e3", songId: "evvel" }
        ],
        "e1"
      )?.songId
    ).toBe("evvel");
    expect(
      nextSetlistSongEntry(
        [
          { type: "song", entryId: "e1", songId: "biz" },
          { type: "talk", entryId: "elif", label: ELIF_KONUSMA_LABEL },
          { type: "song", entryId: "e2", songId: "telli_turnam" }
        ],
        "e1"
      )
    ).toBeUndefined();
  });

  it("skips ELIF KONUSMA when finding the next transport song", () => {
    const withElif: SetlistEntry[] = [
      { type: "song", entryId: "e1", songId: "biz" },
      { type: "talk", entryId: "elif", label: ELIF_KONUSMA_LABEL },
      { type: "song", entryId: "e2", songId: "telli_turnam" }
    ];
    expect(nextTransportSongEntry(withElif, "e1")?.songId).toBe("telli_turnam");
    expect(nextTransportSongEntry(withElif, "e2")).toBeUndefined();
  });

  it("surfaces ELIF KONUSMA as the next transport entry", () => {
    const withElif: SetlistEntry[] = [
      { type: "song", entryId: "e1", songId: "biz" },
      { type: "talk", entryId: "elif", label: ELIF_KONUSMA_LABEL },
      { type: "song", entryId: "e2", songId: "telli_turnam" }
    ];
    expect(nextTransportEntry(withElif, "e1")?.entryId).toBe("elif");
    expect(nextTransportEntry(entries, "e1")?.entryId).toBe("e2");
  });

  it("treats a manual STOP like ELIF KONUSMA", () => {
    const withStop: SetlistEntry[] = [
      { type: "song", entryId: "e1", songId: "biz" },
      { type: "talk", entryId: "stop", label: STOP_LABEL },
      { type: "song", entryId: "e2", songId: "telli_turnam" }
    ];
    expect(nextTransportEntry(withStop, "e1")?.entryId).toBe("stop");
    expect(nextSetlistSongEntry(withStop, "e1")).toBeUndefined();
    expect(nextTransportSongEntry(withStop, "e1")?.songId).toBe("telli_turnam");
  });

  it("treats a key-change ELIF KONUSMA as next", () => {
    const evvel = {
      ...song("evvel", []),
      info: { bpm: 110, numerator: 4, denominator: 4, key: "D" }
    };
    const kara = {
      ...song("kara", []),
      info: { bpm: 120, numerator: 4, denominator: 4, key: "G" }
    };
    const displayed = withKeyChangeElifs(
      [
        { type: "song", entryId: "e1", songId: "evvel" },
        { type: "song", entryId: "e2", songId: "kara" }
      ],
      [evvel, kara]
    );
    const next = nextTransportEntry(displayed, "e1");
    expect(next && "label" in next ? next.label : undefined).toBe(ELIF_KONUSMA_LABEL);
  });

  it("returns the next song first section near the end of the last section", () => {
    expect(upcomingSongLeadIn(entries, [biz, telli], "e1", biz, 20)).toBeUndefined();
    const lead = upcomingSongLeadIn(entries, [biz, telli], "e1", biz, 171);
    expect(lead?.entryId).toBe("e2");
    expect(lead?.section.name).toBe("COUNT");
  });

  it("does not hand off at the start of a long last section", () => {
    const longFinal = song("long_final", [
      { name: "COUNT", start: 0, end: 2 },
      { name: "SAN", start: 2, end: 100 },
      { name: "FINAL", start: 100, end: 190 }
    ]);
    expect(isPlayingLastSection(longFinal, 100)).toBe(true);
    expect(isUpcomingLeadInTime(longFinal, 100)).toBe(false);
    expect(upcomingSongLeadIn(entries, [longFinal, telli], "e1", longFinal, 100)).toBeUndefined();
    expect(isUpcomingLeadInTime(longFinal, 183)).toBe(true);
    expect(upcomingSongLeadIn(entries, [longFinal, telli], "e1", longFinal, 183)?.entryId).toBe("e2");
  });

  it("treats a sectionless next song as one whole-song section", () => {
    const kerkuk = song("kerkuk_zindani", []);
    expect(songLeadInSection(kerkuk)).toEqual({
      name: "kerkuk_zindani",
      start: 0,
      end: 1
    });
    const setlist: SetlistEntry[] = [
      { type: "song", entryId: "e1", songId: "biz" },
      { type: "song", entryId: "e2", songId: "kerkuk_zindani" }
    ];
    expect(upcomingSongLeadIn(setlist, [biz, kerkuk], "e1", biz, 20)).toBeUndefined();
    const lead = upcomingSongLeadIn(setlist, [biz, kerkuk], "e1", biz, 171);
    expect(lead?.entryId).toBe("e2");
    expect(lead?.section).toEqual({ name: "kerkuk_zindani", start: 0, end: 1 });
  });
});
