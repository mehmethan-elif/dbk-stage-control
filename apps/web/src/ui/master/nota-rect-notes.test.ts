import { describe, expect, it } from "vitest";
import {
  MEASURE_NOTE_GRID_HEIGHT,
  NOTE_GRID_GAP,
  NOTE_GRID_HEIGHT,
  NOTE_GRID_INSET,
  NOTE_GRID_WIDTH,
  bothNotesAnchor,
  notaMeasureGridStyle,
  notaRectNotesPlacement,
  notaRectsShareLine,
  notaStackedNotesPlacement,
  unionNotaRects
} from "./nota-rect-notes";

describe("notaMeasureGridStyle", () => {
  it("matches the rect width and sits under it", () => {
    expect(notaMeasureGridStyle({ x: 0.2, y: 0.1, w: 0.15, h: 0.08 })).toEqual({
      left: "20%",
      top: `calc(18% + ${NOTE_GRID_GAP}px)`,
      width: "15%",
      height: `${MEASURE_NOTE_GRID_HEIGHT}px`
    });
    expect(notaMeasureGridStyle({ x: 0.2, y: 0.1, w: 0.15, h: 0.08 }, 1).top).toBe(
      `calc(18% + ${NOTE_GRID_GAP + MEASURE_NOTE_GRID_HEIGHT + NOTE_GRID_GAP}px)`
    );
  });
});

describe("notaRectNotesPlacement", () => {
  const page = { width: 1000, height: 800 };

  it("matches the current rect width", () => {
    const placed = notaRectNotesPlacement(page, { left: 40, top: 100, width: 60, height: 80 });
    expect(placed).toEqual({
      left: 40,
      top: 180 + NOTE_GRID_GAP,
      width: 60,
      height: NOTE_GRID_HEIGHT
    });
  });

  it("keeps a wide current rect grid on the page", () => {
    const placed = notaRectNotesPlacement(page, { left: 900, top: 100, width: 180, height: 80 });
    expect(placed?.width).toBe(180);
    expect(placed?.left).toBe(1000 - NOTE_GRID_INSET - 180);
    expect((placed?.left ?? 0) + (placed?.width ?? 0)).toBeLessThanOrEqual(1000 - NOTE_GRID_INSET);
  });

  it("flips above the rect when it would leave the bottom of the page", () => {
    const placed = notaRectNotesPlacement(page, { left: 40, top: 770, width: 200, height: 28 });
    expect(placed?.top).toBe(770 - NOTE_GRID_GAP - NOTE_GRID_HEIGHT);
    expect((placed?.top ?? 0) + (placed?.height ?? 0)).toBeLessThanOrEqual(800 - NOTE_GRID_INSET);
  });

  it("stays with the rect instead of pinning to the page top", () => {
    const placed = notaRectNotesPlacement(page, { left: 40, top: 40, width: 200, height: 80 });
    expect(placed?.top).toBe(120 + NOTE_GRID_GAP);
    expect(placed?.left).toBe(40);
  });

  it("places the current grid above the rect when asked", () => {
    const placed = notaRectNotesPlacement(
      page,
      { left: 40, top: 200, width: 200, height: 80 },
      NOTE_GRID_HEIGHT,
      NOTE_GRID_INSET,
      "above"
    );
    expect(placed?.top).toBe(200 - NOTE_GRID_GAP - NOTE_GRID_HEIGHT);
    expect(placed?.left).toBe(40);
  });

  it("falls back under the rect when above would leave the page", () => {
    const placed = notaRectNotesPlacement(
      page,
      { left: 40, top: 10, width: 200, height: 80 },
      NOTE_GRID_HEIGHT,
      NOTE_GRID_INSET,
      "above"
    );
    expect(placed?.top).toBe(90 + NOTE_GRID_GAP);
  });
});

describe("notaStackedNotesPlacement", () => {
  const page = { width: 1000, height: 800 };

  it("stacks current above next and centers both on the pair of rects", () => {
    const union = unionNotaRects([
      { left: 100, top: 200, width: 180, height: 80 },
      { left: 300, top: 200, width: 180, height: 80 }
    ]);
    expect(union).toEqual({ left: 100, top: 200, width: 380, height: 80 });
    const stacked = notaStackedNotesPlacement(page, union!);
    expect(stacked?.current.left).toBe(100 + (380 - NOTE_GRID_WIDTH) / 2);
    expect(stacked?.next.left).toBe(stacked?.current.left);
    expect(stacked?.current.top).toBe(280 + NOTE_GRID_GAP);
    expect(stacked?.next.top).toBe((stacked?.current.top ?? 0) + NOTE_GRID_HEIGHT + NOTE_GRID_GAP);
  });

  it("keeps the shared stack on the page when the pair is near the right edge", () => {
    const union = unionNotaRects([
      { left: 780, top: 200, width: 120, height: 80 },
      { left: 910, top: 200, width: 80, height: 80 }
    ]);
    const stacked = notaStackedNotesPlacement(page, union!);
    expect(stacked?.current.left).toBe(1000 - NOTE_GRID_INSET - NOTE_GRID_WIDTH);
    expect(stacked?.next.left).toBe(stacked?.current.left);
    expect((stacked?.current.left ?? 0) + NOTE_GRID_WIDTH).toBeLessThanOrEqual(
      1000 - NOTE_GRID_INSET
    );
  });

  it("keeps the stack under the current measure when next wraps to another line", () => {
    const current = { left: 700, top: 80, width: 180, height: 80 };
    const next = { left: 40, top: 220, width: 180, height: 80 };
    expect(notaRectsShareLine(current, next)).toBe(false);
    const anchor = bothNotesAnchor(current, next);
    expect(anchor).toEqual({ box: current, center: false });
    const stacked = notaStackedNotesPlacement(page, anchor!.box, NOTE_GRID_HEIGHT, NOTE_GRID_HEIGHT, NOTE_GRID_INSET, false);
    expect(stacked?.current.left).toBe(700);
    expect(stacked?.next.left).toBe(700);
    expect(stacked?.current.top).toBe(160 + NOTE_GRID_GAP);
    expect(stacked?.next.top).toBe((stacked?.current.top ?? 0) + NOTE_GRID_HEIGHT + NOTE_GRID_GAP);
  });

  it("still treats side-by-side measures as one line", () => {
    expect(
      notaRectsShareLine(
        { left: 100, top: 200, width: 180, height: 80 },
        { left: 300, top: 200, width: 180, height: 80 }
      )
    ).toBe(true);
  });
});
