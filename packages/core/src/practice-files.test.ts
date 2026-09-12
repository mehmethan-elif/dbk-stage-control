import { describe, expect, it } from "vitest";
import {
  filterPracticeFiles,
  isMasterPracticeAudio,
  isPracticeFile,
  practiceClickAudio,
  practiceExportFolder,
  practiceFolderSlug,
  practiceMasterAudio,
  practiceSongFolder,
  samePracticeFolder
} from "./practice-files.js";

describe("practice files", () => {
  it("keeps charts and the Master mix, not Click.flac", () => {
    expect(
      filterPracticeFiles([
        "song.json",
        "settings.json",
        "nota.pdf",
        "guitar.musicxml",
        "lyrics.json",
        "Master.mp3",
        "Click.flac",
        "Bass.flac",
        "Drums.flac",
        "backing.wav"
      ])
    ).toEqual([
      "song.json",
      "settings.json",
      "nota.pdf",
      "guitar.musicxml",
      "lyrics.json",
      "Master.mp3"
    ]);
  });

  it("prefers Master.mp3 over flac", () => {
    expect(isMasterPracticeAudio("audio/Master.FLAC")).toBe(true);
    expect(practiceMasterAudio(["Master.flac", "Master.mp3"])).toBe("Master.mp3");
  });

  it("rejects Click.flac and stems from the client pack", () => {
    expect(isPracticeFile("Click.flac")).toBe(false);
    expect(practiceClickAudio(["Master.mp3", "Click.flac"])).toBe("Click.flac");
    expect(isPracticeFile("Kick.flac")).toBe(false);
  });

  it("reads the song folder from a zip path", () => {
    expect(practiceSongFolder("songs/Biz/song.json")).toBe("Biz");
    expect(practiceSongFolder("Biz/Master.mp3")).toBe("Biz");
  });

  it("slugs Turkish letters and spaces for zip folders", () => {
    expect(practiceFolderSlug("Evvel Zaman İçinde")).toBe("evvel_zaman_icinde");
    expect(practiceFolderSlug("Evvel Zaman İçinde")).toBe("evvel_zaman_icinde");
    expect(practiceExportFolder({ id: "evvel_zaman_i_c_inde", folder: "Evvel Zaman İçinde" })).toBe(
      "evvel_zaman_i_c_inde"
    );
    expect(practiceExportFolder({ id: "Biz", folder: "Biz" })).toBe("Biz");
    expect(samePracticeFolder("Evvel Zaman İçinde", "Evvel Zaman İçinde")).toBe(true);
  });
});
