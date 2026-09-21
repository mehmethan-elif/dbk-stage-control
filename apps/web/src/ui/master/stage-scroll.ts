const AUTO_SCROLL_MS = 750;
const VIEW_SLOP = 12;
const VIEW_SLOP_BOTTOM = 36;

let frame = 0;
let pendingTo = Number.NaN;
let pendingStage: HTMLElement | null = null;

export function stopStageScroll() {
  cancelAnimationFrame(frame);
  frame = 0;
  pendingTo = Number.NaN;
  pendingStage = null;
}

export function scrollStageTo(stage: HTMLElement, top: number, ms = AUTO_SCROLL_MS) {
  const from = stage.scrollTop;
  const to = Math.max(0, top);
  const delta = to - from;
  if (Math.abs(delta) < 2) return;
  if (pendingStage === stage && Number.isFinite(pendingTo) && Math.abs(pendingTo - to) < 2) return;
  stopStageScroll();
  if (ms <= 0) {
    stage.scrollTop = to;
    return;
  }
  pendingStage = stage;
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
    stopStageScroll();
    stage.dispatchEvent(new Event("stagescrollend"));
  };
  frame = requestAnimationFrame(tick);
}

export function stageNodeIntersectsView(stage: HTMLElement, node: HTMLElement): boolean {
  const stageBox = stage.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  return box.bottom > stageBox.top + 1 && box.top < stageBox.bottom - 1;
}

export function stageLeadInNode(
  stage: HTMLElement,
  entryAttr: string,
  entryId?: string
): HTMLElement | null {
  const scoped = entryId
    ? stage.querySelector(`[${entryAttr}="${entryId}"][data-lead-in], [${entryAttr}="${entryId}"] [data-lead-in]`)
    : stage.querySelector("[data-lead-in]");
  return scoped instanceof HTMLElement ? scoped : null;
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

/** Played measure sits this far down the view, when the next section can stay on screen. */
export const CURRENT_VIEW_ANCHOR = 0.4;

function clampScroll(value: number, min: number, max: number): number {
  if (min > max) return value;
  return Math.min(max, Math.max(min, value));
}

function nearScroll(from: number, to: number): boolean {
  return Math.abs(to - from) < 2;
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
  const unionFits = union.bottom - union.top <= available;
  const pick = (value: number) => (nearScroll(scrollTop, value) ? null : value);

  // Put the played measure at 40% from the top, then back off only as much as needed
  // so the next section (when it still fits) or the measure itself stays on screen.
  if (stay) {
    const preferred = scrollTop + (stay.top - (viewTop + available * CURRENT_VIEW_ANCHOR));
    if (unionFits) return pick(clampScroll(preferred, toBottom(union), toTop(union)));
    if (stay.bottom - stay.top <= available) {
      return pick(clampScroll(preferred, toBottom(stay), toTop(stay)));
    }
  }

  if (unionFits) {
    if (inView(union)) return null;
    if (union.top < viewTop) return toTop(union);
    return toBottom(union);
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

export function stageSpanIntersectsView(
  span: StageSpan,
  viewTop: number,
  viewBottom: number
): boolean {
  return span.top < viewBottom - 1 && span.bottom > viewTop + 1;
}

/** Hand off to the next title only after the current span is already on screen. */
export function preferNextSongTitle(
  current: StageSpan | null,
  viewTop: number,
  viewBottom: number
): boolean {
  return !current || stageSpanIntersectsView(current, viewTop, viewBottom);
}

function stageSongTitleNode(from: HTMLElement): HTMLElement {
  const article = from.closest("article.lyrics-song");
  const root = article instanceof HTMLElement ? article : from;
  const title = root.querySelector(".lyrics-song-head > .direct-pass-mark, .lyrics-song-title");
  return title instanceof HTMLElement ? title : root;
}

/** Scroll so the next song title sits at or above the view midpoint. */
export function nextSongTitleScrollTop(opts: {
  viewTop: number;
  viewBottom: number;
  scrollTop: number;
  titleTop: number;
}): number | null {
  const available = opts.viewBottom - opts.viewTop;
  if (available <= 0) return null;
  const mid = opts.viewTop + available / 2;
  if (opts.titleTop >= opts.viewTop - 1 && opts.titleTop <= mid + 1) return null;
  const targetY = opts.titleTop < opts.viewTop - 1 ? opts.viewTop : mid;
  return opts.scrollTop + (opts.titleTop - targetY);
}

export function scrollStageToNextSongTitleInUpperHalf(stage: HTMLElement, from: HTMLElement) {
  const stageBox = stage.getBoundingClientRect();
  const pad = Number.parseFloat(getComputedStyle(stage).paddingTop) || 0;
  const top = nextSongTitleScrollTop({
    viewTop: stageBox.top + VIEW_SLOP + pad,
    viewBottom: stageBox.bottom - VIEW_SLOP_BOTTOM,
    scrollTop: stage.scrollTop,
    titleTop: stageSongTitleNode(from).getBoundingClientRect().top
  });
  if (top == null) return;
  scrollStageTo(stage, top);
}

export function scrollStageToNotaSectionMeasures(
  stage: HTMLElement,
  songRoot: HTMLElement,
  currentBoxes: ReadonlyArray<{ page: number; y: number; h: number }>,
  nextBoxes: ReadonlyArray<{ page: number; y: number; h: number }>,
  focusBoxes: ReadonlyArray<{ page: number; y: number; h: number }> = [],
  leadIn: HTMLElement | null = null,
  nextRoot: HTMLElement | null = null
) {
  const stageBox = stage.getBoundingClientRect();
  const pad = Number.parseFloat(getComputedStyle(stage).paddingTop) || 0;
  const current = spanForNotaBoxes(songRoot, currentBoxes);
  const next = spanForNotaBoxes(nextRoot ?? songRoot, nextBoxes) ?? spanForNode(leadIn);
  const top = stageScrollTopForSpans({
    viewTop: stageBox.top + VIEW_SLOP + pad,
    viewBottom: stageBox.bottom - VIEW_SLOP_BOTTOM,
    scrollTop: stage.scrollTop,
    current,
    next,
    focus: spanForNotaBoxes(songRoot, focusBoxes) ?? current
  });
  if (top == null) return;
  scrollStageTo(stage, top);
}

function spanForNode(node: Element | null | undefined): StageSpan | null {
  if (!(node instanceof HTMLElement)) return null;
  const box = node.getBoundingClientRect();
  return box.height < 1 ? null : { top: box.top, bottom: box.bottom };
}

/**
 * The same decision the score page makes: keep the played row, and try to hold the whole
 * next section (or the next song's first section) in view with it.
 */
export function scrollStageToFollowedRows(
  stage: HTMLElement,
  current: Element | null | undefined,
  next: Element | null | undefined,
  leadIn: HTMLElement | null = null
) {
  const stageBox = stage.getBoundingClientRect();
  const pad = Number.parseFloat(getComputedStyle(stage).paddingTop) || 0;
  const span = spanForNode(current);
  const top = stageScrollTopForSpans({
    viewTop: stageBox.top + VIEW_SLOP + pad,
    viewBottom: stageBox.bottom - VIEW_SLOP_BOTTOM,
    scrollTop: stage.scrollTop,
    current: span,
    next: spanForNode(next) ?? spanForNode(leadIn),
    focus: span
  });
  if (top == null) return;
  scrollStageTo(stage, top);
}

export function scrollStageToFullSectionsCentered(
  stage: HTMLElement,
  current: HTMLElement,
  next: HTMLElement | null
) {
  scrollStageToFollowedRows(stage, current, next);
}

/** Puts `target` at the top of the stage, clear of the stage's own top padding. */
export function scrollStageToNode(
  stage: HTMLElement | null,
  target: HTMLElement | null,
  ms = 280
) {
  if (!stage || !target) return;
  const pad = Number.parseFloat(getComputedStyle(stage).paddingTop) || 0;
  const top =
    target.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop - pad;
  scrollStageTo(stage, top, ms);
}

export function scrollStageToSongTitle(
  stage: HTMLElement | null,
  entrySelector: string,
  ms = 280
) {
  if (!stage) return;
  const article = stage.querySelector(entrySelector);
  if (!(article instanceof HTMLElement)) return;
  const title = article.querySelector(".lyrics-song-head > .direct-pass-mark, .lyrics-song-title");
  scrollStageToNode(stage, title instanceof HTMLElement ? title : article, ms);
}

/** Wait until the selected song has a real height and songs above it have stopped growing. */
export function songTitlePinReady(opts: {
  height: number;
  top: number;
  lastTop: number;
  stable: number;
}): { ready: boolean; nextStable: number } {
  if (opts.height < 16 || !Number.isFinite(opts.top)) return { ready: false, nextStable: 0 };
  const same = Number.isFinite(opts.lastTop) && Math.abs(opts.top - opts.lastTop) < 1;
  const nextStable = same ? opts.stable + 1 : 0;
  return { ready: nextStable >= 2, nextStable };
}

/** Pin again only when the title itself moved — not when the player scrolls the stage. */
export function shouldRepinSongTitle(opts: { height: number; top: number; lastTop: number }): boolean {
  if (opts.height < 16 || !Number.isFinite(opts.top)) return false;
  return !Number.isFinite(opts.lastTop) || Math.abs(opts.top - opts.lastTop) > 1;
}

const PIN_GROWTH_MS = 12000;

export function pinStageSongWhenReady(
  stageRef: { current: HTMLElement | null },
  entrySelector: string,
  tries = 36
): () => void {
  let cancelled = false;
  let lastTop = Number.NaN;
  const started = performance.now();
  const budget = Math.max(PIN_GROWTH_MS, tries * 16);
  let stable = 0;
  const run = () => {
    if (cancelled) return;
    const stage = stageRef.current;
    const article = stage?.querySelector(entrySelector);
    const title =
      article instanceof HTMLElement
        ? (article.querySelector(".lyrics-song-head > .direct-pass-mark, .lyrics-song-title") ?? article)
        : null;
    if (stage instanceof HTMLElement && title instanceof HTMLElement) {
      const height = article instanceof HTMLElement ? article.getBoundingClientRect().height : 0;
      const top =
        title.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop;
      const pin = songTitlePinReady({ height, top, lastTop, stable });
      stable = pin.nextStable;
      if (shouldRepinSongTitle({ height, top, lastTop })) {
        lastTop = top;
        scrollStageToNode(stage, title, 0);
      }
      // Lyrics is already laid out, so two steady frames is enough. A 12s measure
      // loop on that page is what made iPad setlist taps feel dead.
      if (pin.ready) return;
    }
    if (performance.now() - started < budget) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
  return () => {
    cancelled = true;
  };
}

export function scrollStageToSongTitleWhenReady(
  stage: HTMLElement | null,
  entrySelector: string,
  tries = 12
) {
  if (!stage) return;
  const ref = { current: stage };
  pinStageSongWhenReady(ref, entrySelector, tries);
}
