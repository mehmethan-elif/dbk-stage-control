import { useEffect } from "react";
import {
  isStageContentPage,
  useMasterStore
} from "../../store/master-store";

export const PDF_CANVAS_MAX = 4096;
export const PDF_PAINT_DPR_CAP = 2;

export function pinchZoomFromDistances(startZoom: number, startDist: number, nowDist: number): number {
  if (!(startDist > 0) || !(nowDist > 0)) return startZoom;
  return startZoom * (nowDist / startDist);
}

export function touchPairDistance(event: TouchEvent): number {
  if (event.touches.length < 2) return 0;
  const a = event.touches[0];
  const b = event.touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function pdfRenderScale(pageWidth: number, unscaledWidth: number, dpr: number): number {
  const width = Math.max(1, unscaledWidth);
  const raw = (pageWidth / width) * Math.min(Math.max(dpr, 1), PDF_PAINT_DPR_CAP);
  return Math.min(raw, PDF_CANVAS_MAX / width);
}

/** Keep the same page under the middle of the view when the score grows or shrinks. */
export function scrollTopAfterZoom(opts: {
  prevTop: number;
  prevHeight: number;
  nextHeight: number;
  viewHeight: number;
}): number {
  if (opts.prevHeight <= 0 || opts.nextHeight <= 0) return Math.max(0, opts.prevTop);
  const mid = opts.prevTop + opts.viewHeight / 2;
  return Math.max(0, (mid / opts.prevHeight) * opts.nextHeight - opts.viewHeight / 2);
}

function pinchStartedOnStage(event: TouchEvent): boolean {
  if (event.touches.length < 2) return false;
  return [...event.touches].every((touch) => {
    const node = touch.target;
    return node instanceof Element && Boolean(node.closest(".lyrics-stage"));
  });
}

/** Pinch on the page changes app zoom. Chrome on Android must not zoom the whole UI. */
export function useStagePinchZoom() {
  const setStageZoom = useMasterStore((s) => s.setStageZoom);

  useEffect(() => {
    let startDist = 0;
    let startZoom = 1;
    const onStart = (event: TouchEvent) => {
      if (!pinchStartedOnStage(event)) {
        startDist = 0;
        return;
      }
      startDist = touchPairDistance(event);
      const state = useMasterStore.getState();
      startZoom = isStageContentPage(state.masterPage) ? state.stageZooms[state.masterPage] : 1;
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || startDist < 8) return;
      event.preventDefault();
      setStageZoom(pinchZoomFromDistances(startZoom, startDist, touchPairDistance(event)));
    };
    const onEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) startDist = 0;
    };
    document.addEventListener("touchstart", onStart, { capture: true, passive: true });
    document.addEventListener("touchmove", onMove, { capture: true, passive: false });
    document.addEventListener("touchend", onEnd, { capture: true, passive: true });
    document.addEventListener("touchcancel", onEnd, { capture: true, passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart, true);
      document.removeEventListener("touchmove", onMove, true);
      document.removeEventListener("touchend", onEnd, true);
      document.removeEventListener("touchcancel", onEnd, true);
    };
  }, [setStageZoom]);
}
