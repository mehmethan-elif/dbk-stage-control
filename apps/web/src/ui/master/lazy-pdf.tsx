import { lazy, Suspense, useEffect, type ReactNode } from "react";
import type { NotaLayer } from "./NotaView";

/**
 * pdfjs is the heaviest thing on the startup path and the score page is not on screen at
 * launch, so it loads as its own chunk. The warm-up below then fetches it once the app is
 * idle, so opening a score on stage is instant rather than waiting on a download.
 */
const loadNota = () => import("./NotaView");

const NotaViewLazy = lazy(async () => ({ default: (await loadNota()).NotaView }));

let warmed = false;

function warmPdfChunks(): void {
  if (warmed) return;
  warmed = true;
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (idle) idle(() => void loadNota());
  else window.setTimeout(() => void loadNota(), 1500);
}

/** Warms the score chunk once, from whichever shell mounts first. */
export function usePdfWarmup(): void {
  useEffect(warmPdfChunks, []);
}

function Pending({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="stage-lazy" />}>{children}</Suspense>;
}

export function NotaViewAsync({ layer }: { layer: NotaLayer }) {
  return (
    <Pending>
      <NotaViewLazy layer={layer} />
    </Pending>
  );
}
