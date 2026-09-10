const AUTO_SCROLL_MS = 750;
const VIEW_SLOP = 12;
const VIEW_SLOP_BOTTOM = 36;

let frame = 0;
let pendingTo = Number.NaN;

export function scrollStageTo(stage: HTMLElement, top: number, ms = AUTO_SCROLL_MS, force = false) {
  const from = stage.scrollTop;
  const to = Math.max(0, top);
  const delta = to - from;
  if (Math.abs(delta) < 2) return;
  if (Number.isFinite(pendingTo) && Math.abs(pendingTo - to) < 2) return;
  cancelAnimationFrame(frame);
  pendingTo = to;
  const started = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - started) / ms);
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    stage.scrollTop = from + delta * eased;
    if (t < 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    pendingTo = Number.NaN;
    stage.dispatchEvent(new Event("stagescrollend"));
  };
  frame = requestAnimationFrame(tick);
}

export function isStageScrollAnimating(): boolean {
  return Number.isFinite(pendingTo);
}

export function currentEntryIdFromTitleTops(
  titles: ReadonlyArray<{ entryId: string; top: number }>,
  readLine: number
): string | null {
  if (titles.length === 0) return null;
  let current: string | null = null;
  for (const title of titles) {
    if (title.top <= readLine) current = title.entryId;
  }
  return current ?? titles[0]?.entryId ?? null;
}

export function stageTitleReadLine(stage: HTMLElement): number {
  const box = stage.getBoundingClientRect();
  return box.top + box.height / 2;
}

export function currentEntryIdFromStageTitles(stage: HTMLElement, attr: string): string | null {
  const nodes = [...stage.querySelectorAll<HTMLElement>(`[${attr}]`)];
  if (nodes.length === 0) return null;
  return currentEntryIdFromTitleTops(
    nodes.flatMap((node) => {
      const entryId = node.getAttribute(attr);
      if (!entryId) return [];
      const title =
        node.querySelector(".lyrics-song-title") ?? node.querySelector(".stage-finish-row");
      const el = title instanceof HTMLElement ? title : node;
      return [{ entryId, top: el.getBoundingClientRect().top }];
    }),
    stageTitleReadLine(stage)
  );
}

export function stageNodeInView(stage: HTMLElement, node: HTMLElement): boolean {
  const stageBox = stage.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  return box.bottom > stageBox.top + VIEW_SLOP && box.top < stageBox.bottom - VIEW_SLOP;
}

export function scrollStageToSections(
  stage: HTMLElement,
  current: HTMLElement,
  next: HTMLElement | null
) {
  const currentIn = stageNodeInView(stage, current);
  const nextIn = !next || stageNodeInView(stage, next);
  if (currentIn && nextIn) return;
  const pad = Number.parseFloat(getComputedStyle(stage).paddingTop) || 0;
  const stageBox = stage.getBoundingClientRect();
  const target = !currentIn ? current : next;
  if (!target) return;
  const box = target.getBoundingClientRect();
  if (box.bottom <= stageBox.top + VIEW_SLOP) {
    scrollStageTo(stage, box.top - stageBox.top + stage.scrollTop - pad);
    return;
  }
  if (box.top >= stageBox.bottom - VIEW_SLOP) {
    scrollStageTo(stage, box.bottom - stageBox.top + stage.scrollTop - stage.clientHeight + pad);
  }
}

export function stageNodeFullyInView(stage: HTMLElement, node: HTMLElement): boolean {
  const stageBox = stage.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const top = stageBox.top + VIEW_SLOP;
  const bottom = stageBox.bottom - VIEW_SLOP;
  const available = bottom - top;
  if (box.height > available) {
    return box.top <= top && box.bottom >= bottom;
  }
  return box.top >= top && box.bottom <= bottom;
}

export type StageSpan = { top: number; bottom: number };

export function unionStageSpan(spans: readonly StageSpan[]): StageSpan | null {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const span of spans) {
    top = Math.min(top, span.top);
    bottom = Math.max(bottom, span.bottom);
  }
  if (!Number.isFinite(top) || bottom < top) return null;
  return { top, bottom };
}

export function stageScrollTopForSpans(opts: {
  viewTop: number;
  viewBottom: number;
  scrollTop: number;
  current: StageSpan | null;
  next: StageSpan | null;
  focus?: StageSpan | null;
}): number | null {
  const { viewTop, viewBottom, scrollTop, current, next, focus } = opts;
  const available = viewBottom - viewTop;
  if (available <= 0) return null;
  const union = unionStageSpan([current, next].filter((span): span is StageSpan => Boolean(span)));
  if (!union) return null;
  const inView = (span: StageSpan) => span.top >= viewTop - 1 && span.bottom <= viewBottom + 1;
  const toTop = (span: StageSpan) => scrollTop + (span.top - viewTop);
  const toBottom = (span: StageSpan) => scrollTop + (span.bottom - viewBottom);
  const stay = focus ?? current;
  const from = stay ?? current;
  const nextAbove = Boolean(from && next && next.top + 1 < from.top);

  if (nextAbove && next) {
    if (inView(next)) return null;
    return toTop(next);
  }

  if (union.bottom - union.top <= available) {
    if (inView(union)) return null;
    if (union.top < viewTop) return toTop(union);
    return toBottom(union);
  }
  if (next && next.bottom > viewBottom + 1) {
    const delta = next.bottom - viewBottom;
    if (!stay || stay.top - delta >= viewTop - 1) return scrollTop + delta;
  }
  if (current && current.bottom - current.top <= available) {
    if (inView(current) && (!next || inView(next))) return null;
    if (current.top < viewTop - 1) return toTop(current);
    if (current.bottom > viewBottom + 1) return toBottom(current);
    return null;
  }
  const pin = stay && stay.bottom - stay.top <= available ? stay : current ?? union;
  if (inView(pin)) return null;
  if (pin.top < viewTop) return toTop(pin);
  if (pin.bottom > viewBottom) return toBottom(pin);
  return toTop(pin);
}

export function spanForNotaBoxes(
  songRoot: HTMLElement,
  boxes: ReadonlyArray<{ page: number; y: number; h: number }>
): StageSpan | null {
  const spans: StageSpan[] = [];
  for (const box of boxes) {
    const page = songRoot.querySelector(`[data-nota-page="${box.page}"]`);
    if (!(page instanceof HTMLElement)) continue;
    const bounds = page.getBoundingClientRect();
    if (bounds.height < 1) continue;
    const top = bounds.top + box.y * bounds.height;
    const bottom = bounds.top + (box.y + box.h) * bounds.height;
    spans.push({ top, bottom });
  }
  return unionStageSpan(spans);
}

export function scrollStageToNotaSectionMeasures(
  stage: HTMLElement,
  songRoot: HTMLElement,
  currentBoxes: ReadonlyArray<{ page: number; y: number; h: number }>,
  nextBoxes: ReadonlyArray<{ page: number; y: number; h: number }>,
  focusBoxes: ReadonlyArray<{ page: number; y: number; h: number }> = [],
  leadIn: HTMLElement | null = null
) {
  const stageBox = stage.getBoundingClientRect();
  const pad = Number.parseFloat(getComputedStyle(stage).paddingTop) || 0;
  const current = spanForNotaBoxes(songRoot, currentBoxes);
  const next =
    spanForNotaBoxes(songRoot, nextBoxes) ??
    (leadIn
      ? {
          top: leadIn.getBoundingClientRect().top,
          bottom: leadIn.getBoundingClientRect().bottom
        }
      : null);
  const wrap = Boolean(current && next && next.top + 1 < current.top);
  const top = stageScrollTopForSpans({
    viewTop: stageBox.top + VIEW_SLOP + pad,
    viewBottom: stageBox.bottom - VIEW_SLOP_BOTTOM,
    scrollTop: stage.scrollTop,
    current,
    next,
    focus: spanForNotaBoxes(songRoot, focusBoxes)
  });
  if (top == null) return;
  scrollStageTo(stage, top, AUTO_SCROLL_MS, wrap);
}

export function scrollStageToFullSections(
  stage: HTMLElement,
  current: HTMLElement,
  next: HTMLElement | null,
  preferNext = false
) {
  const currentIn = stageNodeFullyInView(stage, current);
  const nextIn = !next || stageNodeFullyInView(stage, next);
  const stageBox = stage.getBoundingClientRect();
  const available = stageBox.height - VIEW_SLOP * 2;
  const combinedHeight = next
    ? Math.max(current.getBoundingClientRect().bottom, next.getBoundingClientRect().bottom) -
      Math.min(current.getBoundingClientRect().top, next.getBoundingClientRect().top)
    : 0;
  const bothFit = !next || combinedHeight <= available;
  if (preferNext && next && !nextIn) {
    const box = next.getBoundingClientRect();
    const pad = Number.parseFloat(getComputedStyle(stage).paddingTop) || 0;
    scrollStageTo(stage, box.bottom - stageBox.top + stage.scrollTop - stage.clientHeight + pad);
    return;
  }
  if (currentIn && (nextIn || !bothFit)) return;

  const target = !currentIn ? current : next;
  if (!target) return;
  const box = target.getBoundingClientRect();
  const pad = Number.parseFloat(getComputedStyle(stage).paddingTop) || 0;
  if (box.height > available || box.top < stageBox.top + VIEW_SLOP) {
    scrollStageTo(stage, box.top - stageBox.top + stage.scrollTop - pad);
    return;
  }
  if (box.bottom > stageBox.bottom - VIEW_SLOP) {
    scrollStageTo(stage, box.bottom - stageBox.top + stage.scrollTop - stage.clientHeight + pad);
  }
}

export function scrollStageToFullSectionsCentered(
  stage: HTMLElement,
  current: HTMLElement,
  next: HTMLElement | null,
  preferNext = false
) {
  const currentIn = stageNodeFullyInView(stage, current);
  const nextIn = !next || stageNodeFullyInView(stage, next);
  const stageBox = stage.getBoundingClientRect();
  const available = stageBox.height - VIEW_SLOP * 2;
  const currentBox = current.getBoundingClientRect();
  const combinedHeight = next
    ? Math.max(currentBox.bottom, next.getBoundingClientRect().bottom) -
      Math.min(currentBox.top, next.getBoundingClientRect().top)
    : 0;
  const bothFit = !next || combinedHeight <= available;
  if (preferNext && next && !nextIn) {
    const box = next.getBoundingClientRect();
    const pad = Number.parseFloat(getComputedStyle(stage).paddingTop) || 0;
    scrollStageTo(stage, box.bottom - stageBox.top + stage.scrollTop - stage.clientHeight + pad);
    return;
  }
  if (currentIn && (nextIn || !bothFit)) return;

  scrollStageTo(
    stage,
    currentBox.top -
      stageBox.top +
      stage.scrollTop -
      (stage.clientHeight * 0.4 - currentBox.height / 2)
  );
}

export function scrollStageToSongTitle(stage: HTMLElement | null, entrySelector: string) {
  if (!stage) return;
  const article = stage.querySelector(entrySelector);
  if (!(article instanceof HTMLElement)) return;
  const title = article.querySelector(".lyrics-song-title");
  const target = title instanceof HTMLElement ? title : article;
  const pad = Number.parseFloat(getComputedStyle(stage).paddingTop) || 0;
  const top =
    target.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop - pad;
  scrollStageTo(stage, top, 280, true);
}
