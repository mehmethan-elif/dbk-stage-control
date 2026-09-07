import { describe, expect, it } from "vitest";
import {
  filterPracticeFiles,
  isMasterPracticeAudio,
  isPracticeFile,
  practiceMasterAudio,
  practiceSongFolder
} from "./practice-files.js";

describe("practice files", () => {
  it("keeps charts and the Master mix only", () => {
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
    ).toEqual(["song.json", "settings.json", "nota.pdf", "guitar.musicxml", "lyrics.json", "Master.mp3"]);
  });

  it("prefers Master.mp3 over flac", () => {
    expect(isMasterPracticeAudio("audio/Master.FLAC")).toBe(true);
    expect(practiceMasterAudio(["Master.flac", "Master.mp3"])).toBe("Master.mp3");
  });

  it("rejects stems and click", () => {
    expect(isPracticeFile("Click.flac")).toBe(false);
    expect(isPracticeFile("Kick.flac")).toBe(false);
  });

  it("reads the song folder from a zip path", () => {
    expect(practiceSongFolder("songs/Biz/song.json")).toBe("Biz");
    expect(practiceSongFolder("Biz/Master.mp3")).toBe("Biz");
  });
});
