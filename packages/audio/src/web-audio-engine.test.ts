import { describe, expect, it } from "vitest";
import { outputRoutingPlan } from "./web-audio-engine.js";

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
