import { describe, expect, it } from "vitest";
import {
  destinationChannelCount,
  looksLikeMultiOutInterface,
  outputRoutingPlan
} from "./web-audio-engine.js";

describe("outputRoutingPlan", () => {
  it("routes mode 1 to stereo outputs", () => {
    expect(outputRoutingPlan(1, 2)).toEqual({
      channels: 2,
      mainChannels: [0, 1],
      cueChannels: [0, 1],
      mainMono: false
    });
  });

  it("routes mode 2 cue to output 3", () => {
    expect(outputRoutingPlan(2, 4)).toEqual({
      channels: 3,
      mainChannels: [0, 1],
      cueChannels: [2],
      mainMono: false
    });
    expect(outputRoutingPlan(2, 2)).toBeNull();
    expect(outputRoutingPlan(2, 3)).toEqual({
      channels: 3,
      mainChannels: [0, 1],
      cueChannels: [2],
      mainMono: false
    });
  });

  it("raises the destination to the hardware max when the browser allows it", () => {
    const dest = { maxChannelCount: 4, channelCount: 2 };
    expect(destinationChannelCount(dest)).toBe(4);
    expect(dest.channelCount).toBe(4);
    expect(looksLikeMultiOutInterface("M4")).toBe(true);
    expect(looksLikeMultiOutInterface("MacBook Pro Speakers")).toBe(false);
  });

  it("routes mode 3 to separate mono outputs", () => {
    expect(outputRoutingPlan(3, 2)).toEqual({
      channels: 2,
      mainChannels: [0],
      cueChannels: [1],
      mainMono: true
    });
  });
});
