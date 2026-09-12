import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { toPng } from "html-to-image";
import type { Song } from "@dbk/core";
import { DrumChartBody } from "../DrumView";

const CAPTURE_W = 860;

function pngBytes(dataUrl: string): Uint8Array {
  const raw = dataUrl.split(",")[1];
  if (!raw) throw new Error("Drum chart image failed.");
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function waitFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(count);
  });
}

export async function captureDrumChartPng(song: Song): Promise<{
  bytes: Uint8Array;
  width: number;
  height: number;
}> {
  const host = document.createElement("div");
  host.className = "lyrics-stage pdf-drum-capture";
  host.setAttribute("aria-hidden", "true");
  const liveStage = document.querySelector<HTMLElement>(".lyrics-stage:not(.pdf-drum-capture)");
  if (liveStage) {
    const styles = getComputedStyle(liveStage);
    const base = styles.getPropertyValue("--lyrics-base").trim();
    const zoom = styles.getPropertyValue("--lyrics-zoom").trim();
    if (base) host.style.setProperty("--lyrics-base", base);
    if (zoom) host.style.setProperty("--lyrics-zoom", zoom);
  }
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(<DrumChartBody song={song} live={false} time={0} />);
    });
    if (document.fonts?.ready) await document.fonts.ready;
    await waitFrames(3);
    const height = Math.max(host.scrollHeight, host.offsetHeight, host.getBoundingClientRect().height);
    if (height < 24) throw new Error("Drum chart image failed.");
    const dataUrl = await toPng(host, {
      pixelRatio: 2,
      backgroundColor: "#111111",
      width: CAPTURE_W,
      height,
      cacheBust: true,
      style: {
        position: "relative",
        left: "0",
        top: "0",
        transform: "none",
        overflow: "visible",
        width: `${CAPTURE_W}px`,
        height: `${height}px`
      }
    });
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Drum chart image failed."));
      img.src = dataUrl;
    });
    if (img.naturalWidth < 8 || img.naturalHeight < 8) {
      throw new Error("Drum chart image failed.");
    }
    return { bytes: pngBytes(dataUrl), width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    root.unmount();
    host.remove();
  }
}
