import { describe, expect, it } from "vitest";
import { currentEntryIdFromTitleTops, stageScrollTopForSpans } from "./stage-scroll";

describe("currentEntryIdFromTitleTops", () => {
  const titles = [
    { entryId: "evvel", top: 80 },
    { entryId: "elif_key", top: 400 },
    { entryId: "kara", top: 520 }
  ];

  it("keeps the current song until the next title crosses mid-view", () => {
    expect(currentEntryIdFromTitleTops(titles, 300)).toBe("evvel");
  });

  it("promotes the next title once it is at or above mid-view", () => {
    expect(currentEntryIdFromTitleTops(titles, 400)).toBe("elif_key");
    expect(currentEntryIdFromTitleTops(titles, 520)).toBe("kara");
  });

  it("falls back to the first title when none have reached the read line", () => {
    expect(currentEntryIdFromTitleTops(titles, 40)).toBe("evvel");
  });

  it("returns null when the page has no titles", () => {
    expect(currentEntryIdFromTitleTops([], 100)).toBeNull();
  });
});

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
