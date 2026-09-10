export const NOTE_GRID_WIDTH = 256;
export const NOTE_GRID_HEIGHT = 20;
export const MEASURE_NOTE_GRID_HEIGHT = NOTE_GRID_HEIGHT / 2;
export const NOTE_GRID_GAP = 2;
export const NOTE_GRID_INSET = 8;

export interface NotaRectNotesBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type NoteGridSide = "under" | "above";

export function unionNotaRects(rects: readonly NotaRectNotesBox[]): NotaRectNotesBox | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }
  return { left, top, width: right - left, height: bottom - top };
}

function clampGridLeft(
  page: { width: number },
  preferred: number,
  width: number,
  inset: number
): number {
  const areaLeft = inset;
  const areaRight = page.width - inset;
  const maxLeft = areaRight - width;
  return maxLeft < areaLeft ? areaLeft : Math.min(Math.max(preferred, areaLeft), maxLeft);
}

export function notaRectsShareLine(a: NotaRectNotesBox, b: NotaRectNotesBox): boolean {
  const overlap = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return overlap > Math.min(a.height, b.height) * 0.5;
}

export function bothNotesAnchor(
  current: NotaRectNotesBox | null,
  next: NotaRectNotesBox | null
): { box: NotaRectNotesBox; center: boolean } | null {
  if (current && next && notaRectsShareLine(current, next)) {
    const box = unionNotaRects([current, next]);
    return box ? { box, center: true } : null;
  }
  if (current) return { box: current, center: false };
  if (next) return { box: next, center: false };
  return null;
}

export function notaStackedNotesPlacement(
  page: { width: number; height: number },
  union: NotaRectNotesBox,
  currentHeight = NOTE_GRID_HEIGHT,
  nextHeight = NOTE_GRID_HEIGHT,
  inset = NOTE_GRID_INSET,
  center = true
): { current: NotaRectNotesBox; next: NotaRectNotesBox } | null {
  const areaTop = inset;
  const areaBottom = page.height - inset;
  const areaWidth = page.width - inset * 2;
  const areaHeight = areaBottom - areaTop;
  if (areaWidth < 1 || areaHeight < 1) return null;

  const width = Math.min(NOTE_GRID_WIDTH, areaWidth);
  const nowH = Math.min(Math.max(currentHeight, NOTE_GRID_HEIGHT), areaHeight);
  const nextH = Math.min(Math.max(nextHeight, NOTE_GRID_HEIGHT), Math.max(NOTE_GRID_HEIGHT, areaHeight - nowH));
  const preferred = center ? union.left + (union.width - width) / 2 : union.left;
  const left = clampGridLeft(page, preferred, width, inset);
  const stack = nowH + NOTE_GRID_GAP + nextH;
  const under = union.top + union.height + NOTE_GRID_GAP;
  const above = union.top - NOTE_GRID_GAP - stack;
  let top = under;
  if (under + stack <= areaBottom) top = under;
  else if (above >= areaTop) top = above;
  else top = Math.min(Math.max(under, areaTop), areaBottom - stack);

  if (top + stack < 0 || top > page.height) return null;
  return {
    current: { left, top, width, height: nowH },
    next: { left, top: top + nowH + NOTE_GRID_GAP, width, height: nextH }
  };
}

export function notaMeasureGridStyle(
  box: { x: number; y: number; w: number; h: number },
  line = 0
): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  const offset = NOTE_GRID_GAP + line * (MEASURE_NOTE_GRID_HEIGHT + NOTE_GRID_GAP);
  return {
    left: `${box.x * 100}%`,
    top: `calc(${(box.y + box.h) * 100}% + ${offset}px)`,
    width: `${box.w * 100}%`,
    height: `${MEASURE_NOTE_GRID_HEIGHT}px`
  };
}

export function notaRectNotesPlacement(
  page: { width: number; height: number },
  rect: NotaRectNotesBox,
  gridHeight = NOTE_GRID_HEIGHT,
  inset = NOTE_GRID_INSET,
  side: NoteGridSide = "under"
): NotaRectNotesBox | null {
  const areaLeft = inset;
  const areaTop = inset;
  const areaBottom = page.height - inset;
  const areaRight = page.width - inset;
  const areaWidth = areaRight - areaLeft;
  const areaHeight = areaBottom - areaTop;
  if (areaWidth < 1 || areaHeight < 1) return null;

  const width = Math.min(Math.max(rect.width, 0), areaWidth);
  const height = Math.min(Math.max(gridHeight, NOTE_GRID_HEIGHT), areaHeight);
  const left = clampGridLeft(page, rect.left, width, inset);
  const under = rect.top + rect.height + NOTE_GRID_GAP;
  const above = rect.top - NOTE_GRID_GAP - height;
  const underFits = under + height <= areaBottom;
  const aboveFits = above >= areaTop;
  let top = side === "above" ? above : under;
  if (side === "above") {
    if (aboveFits) top = above;
    else if (underFits) top = under;
    else top = Math.min(Math.max(above, areaTop), areaBottom - height);
  } else if (underFits) top = under;
  else if (aboveFits) top = above;
  else top = Math.min(Math.max(under, areaTop), areaBottom - height);

  if (top + height < 0 || top > page.height) return null;
  return { left, top, width, height };
}

export function placeNotaRectNotes(
  grid: HTMLElement,
  page: HTMLElement,
  rect: HTMLElement,
  side: NoteGridSide = "under"
) {
  const pageBox = page.getBoundingClientRect();
  const rectBox = rect.getBoundingClientRect();
  if (pageBox.width < 1 || pageBox.height < 1) return;
  const next = notaRectNotesPlacement(
    { width: page.clientWidth, height: page.clientHeight },
    {
      left: rectBox.left - pageBox.left,
      top: rectBox.top - pageBox.top,
      width: rectBox.width,
      height: rectBox.height
    },
    Math.max(NOTE_GRID_HEIGHT, grid.offsetHeight),
    NOTE_GRID_INSET,
    side
  );
  if (!next) {
    grid.style.visibility = "hidden";
    return;
  }
  applyNotaRectNotesBox(grid, next);
}

function pageRelativeBox(page: HTMLElement, rect: HTMLElement): NotaRectNotesBox {
  const pageBox = page.getBoundingClientRect();
  const rectBox = rect.getBoundingClientRect();
  return {
    left: rectBox.left - pageBox.left,
    top: rectBox.top - pageBox.top,
    width: rectBox.width,
    height: rectBox.height
  };
}

function applyNotaRectNotesBox(grid: HTMLElement, box: NotaRectNotesBox) {
  grid.style.visibility = "visible";
  grid.style.left = `${box.left}px`;
  grid.style.top = `${box.top}px`;
  grid.style.width = `${box.width}px`;
}

export function placeStackedNotaRectNotes(
  currentGrid: HTMLElement | null,
  nextGrid: HTMLElement | null,
  page: HTMLElement,
  currentRects: readonly HTMLElement[],
  nextRects: readonly HTMLElement[] = []
) {
  if (page.clientWidth < 1 || page.clientHeight < 1) return;
  const current = unionNotaRects(currentRects.map((rect) => pageRelativeBox(page, rect)));
  const next = unionNotaRects(nextRects.map((rect) => pageRelativeBox(page, rect)));
  const anchor = bothNotesAnchor(current, next);
  if (!anchor) {
    if (currentGrid) currentGrid.style.visibility = "hidden";
    if (nextGrid) nextGrid.style.visibility = "hidden";
    return;
  }
  const pageSize = { width: page.clientWidth, height: page.clientHeight };
  if (currentGrid && nextGrid) {
    const stacked = notaStackedNotesPlacement(
      pageSize,
      anchor.box,
      Math.max(NOTE_GRID_HEIGHT, currentGrid.offsetHeight),
      Math.max(NOTE_GRID_HEIGHT, nextGrid.offsetHeight),
      NOTE_GRID_INSET,
      anchor.center
    );
    if (!stacked) {
      currentGrid.style.visibility = "hidden";
      nextGrid.style.visibility = "hidden";
      return;
    }
    applyNotaRectNotesBox(currentGrid, stacked.current);
    applyNotaRectNotesBox(nextGrid, stacked.next);
    return;
  }
  const grid = currentGrid ?? nextGrid;
  if (!grid) return;
  const placed = notaRectNotesPlacement(
    pageSize,
    anchor.box,
    Math.max(NOTE_GRID_HEIGHT, grid.offsetHeight)
  );
  if (!placed) {
    grid.style.visibility = "hidden";
    return;
  }
  applyNotaRectNotesBox(grid, placed);
}
