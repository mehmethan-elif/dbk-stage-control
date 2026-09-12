import { describe, expect, it } from "vitest";
import { hasClickFlac } from "./audio-engine.js";
import { PlayMode, SetlistPerformanceMode, type Song } from "./models.js";
import {
  effectivePlayMode,
  hidesLeftoverNotaRects,
  isFakeMetronomeTrack,
  bandRoster,
  isFreeSetlistMode,
  isVocalBandName,
  lanRosterState,
  mergeStageNames,
  padStageNames,
  parseSetlistPerformanceMode,
  setlistModeIsSilent,
  setlistPlayModeIcon,
  songsForcedClickOnly,
  songsForSetlistPerformance
} from "./setlist-performance.js";

function song(id: string, playMode: PlayMode, files: string[] = []): Song {
  return {
    id,
    version: 1,
    title: id,
    duration: 60,
    assets: files.map((path, index) => ({
      id: `${id}_${index}`,
      kind: "audio",
      path,
      hash: path,
      audioRole: path === "Click.flac" ? "click" : "stem"
    })),
    tempoMap: [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }],
    sections: [],
    info: { playMode, bpm: 120, numerator: 4, denominator: 4 }
  };
}

describe("setlist performance mode", () => {
  it("defaults to follow song info", () => {
    expect(parseSetlistPerformanceMode(undefined)).toBe(SetlistPerformanceMode.FollowSongInfo);
    expect(parseSetlistPerformanceMode("nope")).toBe(SetlistPerformanceMode.FollowSongInfo);
  });

  it("maps removed free and click-only setlist modes to follow song info", () => {
    expect(parseSetlistPerformanceMode("FREE")).toBe(SetlistPerformanceMode.FollowSongInfo);
    expect(parseSetlistPerformanceMode("CLICK_ONLY")).toBe(SetlistPerformanceMode.FollowSongInfo);
    expect(isFreeSetlistMode(SetlistPerformanceMode.Free)).toBe(false);
    expect(setlistModeIsSilent(SetlistPerformanceMode.Free)).toBe(false);
    expect(setlistModeIsSilent(SetlistPerformanceMode.MetronomeContinuous)).toBe(false);
  });

  it("maps removed metronome modes to continuous", () => {
    expect(parseSetlistPerformanceMode("METRONOME_AUTO_STOP")).toBe(
      SetlistPerformanceMode.MetronomeContinuous
    );
    expect(parseSetlistPerformanceMode("METRONOME_VISUAL_ONLY")).toBe(
      SetlistPerformanceMode.MetronomeContinuous
    );
  });

  it("follows each song unless metronome overlay applies", () => {
    const click = song("a", PlayMode.Playback, ["Click.flac", "Bass.flac"]);
    const files = ["Click.flac", "Bass.flac"];
    expect(hasClickFlac(click, files)).toBe(true);
    expect(effectivePlayMode(click, files, SetlistPerformanceMode.FollowSongInfo)).toBe(
      PlayMode.Playback
    );
    expect(effectivePlayMode(click, files, SetlistPerformanceMode.ClickOnly)).toBe(
      PlayMode.Playback
    );
    expect(effectivePlayMode(click, files, SetlistPerformanceMode.MetronomeContinuous)).toBe(
      PlayMode.View
    );
    expect(effectivePlayMode(click, files, SetlistPerformanceMode.Free)).toBe(PlayMode.Playback);
  });

  it("keeps backing-track rects when the client only has Master.mp3", () => {
    const backing = {
      ...song("biz", PlayMode.Playback, ["Master.mp3"]),
      sections: [{ name: "SAN", start: 0, end: 8 }]
    };
    expect(hidesLeftoverNotaRects(backing)).toBe(false);
    expect(isFakeMetronomeTrack(backing, ["Master.mp3"])).toBe(true);
    expect(
      hidesLeftoverNotaRects(
        { ...backing, info: { ...backing.info, playMode: PlayMode.View } }
      )
    ).toBe(true);
    expect(
      hidesLeftoverNotaRects(backing, SetlistPerformanceMode.MetronomeContinuous)
    ).toBe(true);
  });

  it("treats a backing song in metronome mode as a fake metro track", () => {
    const backing = song("biz", PlayMode.View, ["Bass.flac", "Master.mp3"]);
    const files = ["Bass.flac", "Master.mp3"];
    expect(isFakeMetronomeTrack(backing, files)).toBe(true);
    expect(
      isFakeMetronomeTrack(
        { ...backing, info: { ...backing.info, playMode: PlayMode.Playback } },
        files
      )
    ).toBe(false);
    expect(isFakeMetronomeTrack(song("stub", PlayMode.View), [])).toBe(false);
    expect(
      isFakeMetronomeTrack(
        song("biz", PlayMode.Playback, ["Bass.flac"]),
        ["Bass.flac"],
        SetlistPerformanceMode.MetronomeContinuous
      )
    ).toBe(true);
  });

  it("treats click-only audio as backing tracks", () => {
    const click = song("a", PlayMode.Playback, ["Click.flac"]);
    expect(effectivePlayMode(click, ["Click.flac"], SetlistPerformanceMode.FollowSongInfo)).toBe(
      PlayMode.Playback
    );
    expect(effectivePlayMode(click, ["Master.mp3"], SetlistPerformanceMode.FollowSongInfo)).toBe(
      PlayMode.View
    );
  });

  it("maps a saved free song to metronome", () => {
    const free = song("f", PlayMode.Free, ["Click.flac", "Bass.flac"]);
    const files = ["Click.flac", "Bass.flac"];
    expect(effectivePlayMode(free, files, SetlistPerformanceMode.FollowSongInfo)).toBe(
      PlayMode.View
    );
    expect(setlistPlayModeIcon(free, files, SetlistPerformanceMode.FollowSongInfo)).toEqual({
      playMode: PlayMode.View,
      color: "#ffffff"
    });
  });

  it("does not apply a click-only overlay after that setlist mode was removed", () => {
    const original = song("a", PlayMode.Playback, ["Click.flac"]);
    const overlay = songsForSetlistPerformance(
      [original],
      { a: ["Click.flac"] },
      SetlistPerformanceMode.ClickOnly
    );
    expect(overlay[0]?.info?.playMode).toBe(PlayMode.Playback);
    expect(original.info?.playMode).toBe(PlayMode.Playback);
  });

  it("can force click-only on backing-track songs for panic", () => {
    const original = song("a", PlayMode.Playback, ["Click.flac", "Bass.flac"]);
    const overlay = songsForcedClickOnly([original], { a: ["Click.flac", "Bass.flac"] });
    expect(overlay[0]?.info?.playMode).toBe(PlayMode.ClickOnly);
    expect(original.info?.playMode).toBe(PlayMode.Playback);
  });

  it("keeps declared play-mode icons when stems are not on the client", () => {
    const playback = song("a", PlayMode.Playback, ["Master.mp3"]);
    const click = song("b", PlayMode.ClickOnly, ["Master.mp3"]);
    const view = song("c", PlayMode.View, ["Master.mp3"]);
    const files = ["Master.mp3"];
    expect(setlistPlayModeIcon(playback, files, SetlistPerformanceMode.FollowSongInfo).playMode).toBe(
      PlayMode.Playback
    );
    expect(setlistPlayModeIcon(click, files, SetlistPerformanceMode.FollowSongInfo).playMode).toBe(
      PlayMode.Playback
    );
    expect(setlistPlayModeIcon(view, files, SetlistPerformanceMode.ClickOnly)).toEqual({
      playMode: PlayMode.View,
      color: "#ffffff"
    });
    expect(setlistPlayModeIcon(playback, files, SetlistPerformanceMode.ClickOnly)).toEqual({
      playMode: PlayMode.Playback,
      color: "#ffffff"
    });
  });

  it("colors overlay icons and leaves follow-mode icons white", () => {
    const click = song("a", PlayMode.Playback, ["Click.flac", "Bass.flac"]);
    const files = ["Click.flac", "Bass.flac"];
    expect(setlistPlayModeIcon(click, files, SetlistPerformanceMode.FollowSongInfo)).toEqual({
      playMode: PlayMode.Playback,
      color: "#ffffff"
    });
    expect(setlistPlayModeIcon(click, files, SetlistPerformanceMode.ClickOnly).color).toBe(
      "#ffffff"
    );
    expect(
      setlistPlayModeIcon(click, files, SetlistPerformanceMode.MetronomeContinuous).color
    ).toBe("#8b5cf6");
    expect(setlistPlayModeIcon(click, files, SetlistPerformanceMode.Free).color).toBe("#ffffff");
  });

  it("pads six on-stage names", () => {
    expect(padStageNames(["Ada", "Can"])).toEqual(["Ada", "Can", "", "", "", ""]);
  });

  it("keeps previous extras when a connect payload has no stage names", () => {
    expect(mergeStageNames(undefined, ["Serkan"])).toEqual(["Serkan", "", "", "", "", ""]);
    expect(mergeStageNames(["", "", "", "", "", ""], ["Serkan"])).toEqual([
      "Serkan",
      "",
      "",
      "",
      "",
      ""
    ]);
    expect(mergeStageNames(["Ada"], ["Serkan"])).toEqual(["Ada", "", "", "", "", ""]);
  });

  it("keeps Mehmethan first and Elif second, then extras", () => {
    expect(bandRoster({ stageNames: ["Ada", "Elif", ""] })).toEqual(["Mehmethan", "Elif", "Ada"]);
  });

  it("treats Elif as the vocal name", () => {
    expect(isVocalBandName("Elif")).toBe(true);
    expect(isVocalBandName(" elif ")).toBe(true);
    expect(isVocalBandName("Serkan")).toBe(false);
  });

  it("turns LAN green when the master is online and every other name has one client", () => {
    const roster = bandRoster({ stageNames: ["Ada"] });
    const peers = [
      { deviceKind: "client", deviceName: "Elif" },
      { deviceKind: "client", deviceName: "Ada" }
    ];
    expect(lanRosterState(roster, peers, true, true)).toBe("ready");
    expect(lanRosterState(roster, peers, true, false)).toBe("waiting");
    expect(lanRosterState(roster, peers.slice(0, 1), true, true)).toBe("waiting");
    expect(lanRosterState(roster, peers, false, true)).toBe("problem");
    expect(
      lanRosterState(roster, [...peers, { deviceKind: "client", deviceName: "iPad" }], true, true)
    ).toBe("problem");
    expect(
      lanRosterState(roster, [...peers, { deviceKind: "remote", deviceName: "REMOTE" }], true, true)
    ).toBe("ready");
  });
});
