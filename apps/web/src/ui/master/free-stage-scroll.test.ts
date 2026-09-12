import { describe, expect, it } from "vitest";
import { nextSongTitleScrollTop, preferNextSongTitle, stageScrollTopForSpans } from "./stage-scroll";

describe("stageScrollTopForSpans", () => {
  const view = { viewTop: 100, viewBottom: 500, scrollTop: 0 };

  it("does not move when current and next already fit in view", () => {
    expect(
      stageScrollTopForSpans({
        ...view,
        current: { top: 120, bottom: 220 },
        next: { top: 230, bottom: 320 }
      })
    ).toBeNull();
  });

  it("scrolls to fit both sections when they fit together", () => {
    expect(
      stageScrollTopForSpans({
        ...view,
        current: { top: 480, bottom: 560 },
        next: { top: 570, bottom: 650 }
      })
    ).toBe(150);
  });

  it("pins the current section to the top when both sections do not fit", () => {
    expect(
      stageScrollTopForSpans({
        ...view,
        current: { top: 80, bottom: 360 },
        next: { top: 370, bottom: 720 }
      })
    ).toBe(-20);
  });

  it("nudges down when the next section is only clipped at the bottom", () => {
    expect(
      stageScrollTopForSpans({
        ...view,
        current: { top: 140, bottom: 420 },
        next: { top: 430, bottom: 540 },
        focus: { top: 300, bottom: 360 }
      })
    ).toBe(40);
  });

  it("scrolls up to the next section when it wraps to the first line", () => {
    expect(
      stageScrollTopForSpans({
        viewTop: 100,
        viewBottom: 500,
        scrollTop: 700,
        current: { top: 380, bottom: 470 },
        next: { top: -620, bottom: -520 }
      })
    ).toBe(-20);
  });

  it("stays when the wrapped next section is already in view", () => {
    expect(
      stageScrollTopForSpans({
        ...view,
        current: { top: 360, bottom: 470 },
        next: { top: 120, bottom: 200 }
      })
    ).toBeNull();
  });

  it("does not yank an arrived next rect from the bottom up to the top", () => {
    expect(
      stageScrollTopForSpans({
        viewTop: 100,
        viewBottom: 500,
        scrollTop: 240,
        current: { top: 420, bottom: 490 },
        next: { top: 800, bottom: 1180 }
      })
    ).toBeNull();
  });
});

describe("nextSongTitleScrollTop", () => {
  const view = { viewTop: 100, viewBottom: 500, scrollTop: 240 };

  it("does not move when the title is already in the upper half", () => {
    expect(nextSongTitleScrollTop({ ...view, titleTop: 180 })).toBeNull();
    expect(nextSongTitleScrollTop({ ...view, titleTop: 300 })).toBeNull();
  });

  it("scrolls a title below the midpoint up into the upper half", () => {
    expect(nextSongTitleScrollTop({ ...view, titleTop: 800 })).toBe(740);
  });

  it("pulls a title above the view down to the top", () => {
    expect(nextSongTitleScrollTop({ ...view, titleTop: 40 })).toBe(180);
  });
});

describe("preferNextSongTitle", () => {
  it("hands off when the current span is already on screen", () => {
    expect(preferNextSongTitle({ top: 120, bottom: 220 }, 100, 500)).toBe(true);
  });

  it("keeps following when the current span is still off-screen", () => {
    expect(preferNextSongTitle({ top: 800, bottom: 920 }, 100, 500)).toBe(false);
  });

  it("hands off when there is no current span", () => {
    expect(preferNextSongTitle(null, 100, 500)).toBe(true);
  });
});
