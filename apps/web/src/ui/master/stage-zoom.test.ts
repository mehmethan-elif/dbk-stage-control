import { describe, expect, it } from "vitest";
import {
  PDF_CANVAS_MAX,
  pdfRenderScale,
  pinchZoomFromDistances,
  scrollTopAfterZoom
} from "./stage-zoom";

describe("pinchZoomFromDistances", () => {
  it("scales from the gesture start", () => {
    expect(pinchZoomFromDistances(1, 100, 140)).toBeCloseTo(1.4);
    expect(pinchZoomFromDistances(1.2, 80, 40)).toBeCloseTo(0.6);
  });

  it("ignores a broken pair", () => {
    expect(pinchZoomFromDistances(1.1, 0, 40)).toBe(1.1);
    expect(pinchZoomFromDistances(1.1, 40, 0)).toBe(1.1);
  });
});

describe("scrollTopAfterZoom", () => {
  it("keeps the same midpoint when the page doubles", () => {
    expect(
      scrollTopAfterZoom({ prevTop: 200, prevHeight: 1000, nextHeight: 2000, viewHeight: 400 })
    ).toBe(600);
  });
});

describe("pdfRenderScale", () => {
  it("caps device pixels so Android does not allocate huge canvases", () => {
    const scale = pdfRenderScale(2000, 800, 3);
    expect(800 * scale).toBeLessThanOrEqual(PDF_CANVAS_MAX);
    expect(scale).toBeLessThanOrEqual((2000 / 800) * 2);
  });
});
