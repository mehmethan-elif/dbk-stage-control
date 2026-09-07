const AUTO_SCROLL_MS = 1100;
const VIEW_SLOP = 12;

let frame = 0;
let pendingTo = Number.NaN;

export function scrollStageTo(stage: HTMLElement, top: number, ms = AUTO_SCROLL_MS, force = false) {
  const from = stage.scrollTop;
  const to = Math.max(0, top);
  const delta = to - from;
  if (Math.abs(delta) < 2) return;
  if (!force && Number.isFinite(pendingTo) && Math.abs(pendingTo - to) < 2) return;
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
  };
  frame = requestAnimationFrame(tick);
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

export function scrollStageToFullSections(
  stage: HTMLElement,
  current: HTMLElement,
  next: HTMLElement | null
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
  next: HTMLElement | null
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
