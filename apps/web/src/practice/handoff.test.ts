import { describe, expect, it } from "vitest";
import { practiceHandoff, practicePlayNextDue, shouldRewindHtmlAudioStart } from "./handoff";

describe("practicePlayNextDue", () => {
  it("starts the next song at the PLAY_NEXT cue so the current tail can keep ringing", () => {
    expect(
      practicePlayNextDue({
        ended: false,
        time: 173.94,
        cue: 173.94,
        shouldPlayNext: true,
        already: false
      })
    ).toBe(true);
    expect(
      practicePlayNextDue({
        ended: false,
        time: 173.91,
        cue: 173.94,
        shouldPlayNext: true,
        already: false
      })
    ).toBe(false);
    expect(
      practicePlayNextDue({
        ended: false,
        time: 170,
        cue: 173.94,
        shouldPlayNext: true,
        already: false
      })
    ).toBe(false);
  });

  it("still hands off when the file ends, once", () => {
    expect(
      practicePlayNextDue({
        ended: true,
        time: 177.5,
        cue: 173.94,
        shouldPlayNext: true,
        already: false
      })
    ).toBe(true);
    expect(
      practicePlayNextDue({
        ended: true,
        time: 177.5,
        cue: 173.94,
        shouldPlayNext: true,
        already: true
      })
    ).toBe(false);
  });

  it("does not hand off when the setlist would stop", () => {
    expect(
      practicePlayNextDue({
        ended: true,
        time: 177.5,
        cue: 173.94,
        shouldPlayNext: false,
        already: false
      })
    ).toBe(false);
  });
});

describe("practiceHandoff", () => {
  it("plays the tail past the PLAY_NEXT cue when the setlist stops or talks", () => {
    expect(
      practiceHandoff({
        ended: false,
        time: 178.18,
        cue: 178.18,
        shouldPlayNext: false,
        already: false
      })
    ).toBeNull();
    expect(
      practiceHandoff({
        ended: true,
        time: 180.9,
        cue: 178.18,
        shouldPlayNext: false,
        already: false
      })
    ).toBe("land");
  });
});

describe("shouldRewindHtmlAudioStart", () => {
  it("puts back a first-beat jump on WebKit", () => {
    expect(shouldRewindHtmlAudioStart(0.48, 0)).toBe(true);
    expect(shouldRewindHtmlAudioStart(0.01, 0)).toBe(false);
    expect(shouldRewindHtmlAudioStart(2.01, 2)).toBe(false);
  });
});
