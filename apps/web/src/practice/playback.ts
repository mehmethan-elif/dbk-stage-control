import { practiceClickAudio, practiceMasterAudio } from "@dbk/core";
import { folderForSong } from "../library/api";
import { shouldRewindHtmlAudioStart } from "./handoff";
import { readPracticeFileBuffer } from "./store";

export type PracticeAudioKind = "master" | "click";

const MASTER_CANDIDATES = ["Master.mp3", "master.mp3", "Master.flac", "master.flac"];
const CLICK_CANDIDATES = ["Click.flac", "click.flac"];

let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let loadedSongId: string | null = null;
let loadedKind: PracticeAudioKind | null = null;
let timeListener: ((time: number, ended: boolean) => void) | null = null;
let tick: number | null = null;

let practiceCtx: AudioContext | null = null;
let bytes: ArrayBuffer | null = null;
let pcm: AudioBuffer | null = null;
let source: AudioBufferSourceNode | null = null;
let tail: AudioBufferSourceNode | null = null;
let tailAudio: HTMLAudioElement | null = null;
let tailUrl: string | null = null;
let decodePromise: Promise<AudioBuffer | null> | null = null;
let webPlaying = false;
let startOffset = 0;
let startedAt: number | null = null;

let nextSongId: string | null = null;
let nextKind: PracticeAudioKind | null = null;
let nextBytes: ArrayBuffer | null = null;
let nextPcm: AudioBuffer | null = null;
let nextDecodePromise: Promise<AudioBuffer | null> | null = null;
let nextSource: AudioBufferSourceNode | null = null;
let nextStartedAt: number | null = null;
let nextStartOffset = 0;

function emitTime(ended = false): void {
  if (!ended && !webPlaying && audio?.paused) return;
  timeListener?.(practiceAudioTime(), ended);
}

function startTick(): void {
  if (tick != null) return;
  const loop = () => {
    if (webPlaying) {
      const duration = pcm?.duration ?? 0;
      if (duration > 0 && practiceAudioTime() >= duration - 0.02) {
        tick = null;
        webPlaying = false;
        emitTime(true);
        return;
      }
      emitTime(false);
      tick = requestAnimationFrame(loop);
      return;
    }
    if (!audio || audio.paused) {
      tick = null;
      if (audio && (audio.ended || htmlAudioFinished(audio))) {
        timeListener?.(htmlDuration(audio), true);
      }
      return;
    }
    if (htmlAudioFinished(audio)) {
      tick = null;
      timeListener?.(htmlDuration(audio), true);
      return;
    }
    emitTime(false);
    tick = requestAnimationFrame(loop);
  };
  tick = requestAnimationFrame(loop);
}

function stopTick(): void {
  if (tick == null) return;
  cancelAnimationFrame(tick);
  tick = null;
}

function htmlDuration(node: HTMLAudioElement): number {
  const value = node.duration;
  return Number.isFinite(value) && value > 0 ? value : node.currentTime;
}

function htmlAudioFinished(node: HTMLAudioElement): boolean {
  if (node.ended) return true;
  const duration = node.duration;
  return Number.isFinite(duration) && duration > 0 && node.currentTime >= duration - 0.05;
}

function stopNode(node: AudioBufferSourceNode | null): void {
  if (!node) return;
  node.onended = null;
  try {
    node.stop();
  } catch {
    // already stopped
  }
  try {
    node.disconnect();
  } catch {
    // already disconnected
  }
}

function stopSource(): void {
  if (webPlaying && practiceCtx && startedAt != null) {
    startOffset = Math.max(0, startOffset + (practiceCtx.currentTime - startedAt));
  }
  stopNode(source);
  source = null;
  webPlaying = false;
  startedAt = null;
}

function stopArmedNext(): void {
  stopNode(nextSource);
  nextSource = null;
  nextStartedAt = null;
  nextStartOffset = 0;
}

function clearPracticeNext(keepBuffers = false): void {
  stopArmedNext();
  if (keepBuffers) return;
  nextSongId = null;
  nextKind = null;
  nextBytes = null;
  nextPcm = null;
  nextDecodePromise = null;
}

function stopTail(): void {
  if (tail) {
    tail.onended = null;
    try {
      tail.stop();
    } catch {
      // already stopped
    }
    tail.disconnect();
    tail = null;
  }
  if (tailAudio) {
    tailAudio.pause();
    tailAudio.removeAttribute("src");
    tailAudio = null;
  }
  if (tailUrl) {
    URL.revokeObjectURL(tailUrl);
    tailUrl = null;
  }
}

/** Leave the current mix running so PLAY NEXT can start the next song over its tail. */
export function parkPracticeTail(): void {
  stopTick();
  stopTail();
  if (source) {
    const node = source;
    node.onended = () => {
      if (tail !== node) return;
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
      tail = null;
    };
    tail = node;
    source = null;
    webPlaying = false;
    startedAt = null;
    return;
  }
  if (audio && !audio.paused) {
    const parked = audio;
    tailAudio = parked;
    tailUrl = objectUrl;
    objectUrl = null;
    audio = null;
    parked.addEventListener(
      "ended",
      () => {
        if (tailAudio !== parked) return;
        parked.removeAttribute("src");
        if (tailUrl) URL.revokeObjectURL(tailUrl);
        tailUrl = null;
        tailAudio = null;
      },
      { once: true }
    );
  }
}

function element(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.playsInline = true;
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    audio.addEventListener("timeupdate", () => emitTime(false));
    audio.addEventListener("ended", () => {
      stopTick();
      timeListener?.(htmlDuration(audio!), true);
    });
  }
  return audio;
}

function waitEvent(node: HTMLAudioElement, type: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      node.removeEventListener(type, done);
      resolve();
    };
    const timer = window.setTimeout(done, ms);
    node.addEventListener(type, done, { once: true });
  });
}

function decodeAudio(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = (buffer: AudioBuffer) => {
      if (settled) return;
      settled = true;
      resolve(buffer);
    };
    const fail = (error?: unknown) => {
      if (settled) return;
      settled = true;
      reject(error ?? new Error("decode failed"));
    };
    try {
      const pending = ctx.decodeAudioData(data, ok, fail);
      pending?.then(ok, fail);
    } catch (error) {
      fail(error);
    }
  });
}

async function decodeIfNeeded(): Promise<AudioBuffer | null> {
  if (pcm) return pcm;
  if (!bytes || !practiceCtx) return null;
  if (decodePromise) return decodePromise;
  const ctx = practiceCtx;
  const copy = bytes.slice(0);
  decodePromise = decodeAudio(ctx, copy)
    .then((buffer) => {
      pcm = buffer;
      return buffer;
    })
    .catch(() => null)
    .finally(() => {
      decodePromise = null;
    });
  return decodePromise;
}

async function decodeNextIfNeeded(): Promise<AudioBuffer | null> {
  if (nextPcm) return nextPcm;
  if (!nextBytes || !practiceCtx) return null;
  if (nextDecodePromise) return nextDecodePromise;
  const ctx = practiceCtx;
  const copy = nextBytes.slice(0);
  nextDecodePromise = decodeAudio(ctx, copy)
    .then((buffer) => {
      nextPcm = buffer;
      return buffer;
    })
    .catch(() => null)
    .finally(() => {
      nextDecodePromise = null;
    });
  return nextDecodePromise;
}

function startBuffer(offset: number, when?: number): void {
  if (!practiceCtx || !pcm) return;
  stopSource();
  startOffset = Math.max(0, Math.min(offset, Math.max(0, pcm.duration - 0.001)));
  const node = practiceCtx.createBufferSource();
  node.buffer = pcm;
  node.connect(practiceCtx.destination);
  node.onended = () => {
    if (source !== node) return;
    webPlaying = false;
    startedAt = null;
    stopTick();
    timeListener?.(pcm?.duration ?? startOffset, true);
  };
  source = node;
  startedAt = when ?? practiceCtx.currentTime;
  webPlaying = practiceCtx.currentTime >= startedAt;
  node.start(startedAt, startOffset);
}

function startNextBuffer(offset: number, when: number): boolean {
  if (!practiceCtx || !nextPcm) return false;
  stopArmedNext();
  nextStartOffset = Math.max(0, Math.min(offset, Math.max(0, nextPcm.duration - 0.001)));
  const node = practiceCtx.createBufferSource();
  node.buffer = nextPcm;
  node.connect(practiceCtx.destination);
  nextSource = node;
  nextStartedAt = when;
  node.start(when, nextStartOffset);
  return true;
}

async function playHtmlAudio(startAt: number): Promise<void> {
  const node = element();
  if (node.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await waitEvent(node, "canplay", 4000);
  }
  try {
    node.currentTime = startAt;
  } catch {
    // WebKit rejects seeks before metadata
  }
  if (node.readyState >= HTMLMediaElement.HAVE_METADATA) {
    await waitEvent(node, "seeked", 600);
  }
  await node.play();
  if (shouldRewindHtmlAudioStart(node.currentTime, startAt)) {
    try {
      node.currentTime = startAt;
    } catch {
      // leave the playhead where WebKit put it
    }
  }
}

export function attachPracticeContext(ctx: AudioContext): void {
  practiceCtx = ctx;
  void decodeIfNeeded();
  void decodeNextIfNeeded();
}

export function onPracticeTime(listener: ((time: number, ended: boolean) => void) | null): void {
  timeListener = listener;
}

export function stopPracticeAudio(): void {
  stopTick();
  stopTail();
  stopSource();
  clearPracticeNext();
  startOffset = 0;
  pcm = null;
  bytes = null;
  decodePromise = null;
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  loadedSongId = null;
  loadedKind = null;
}

export function isPracticeAudioLoaded(songId: string, kind?: PracticeAudioKind): boolean {
  return (
    loadedSongId === songId &&
    Boolean(pcm || bytes || audio?.src) &&
    (kind == null || loadedKind === kind)
  );
}

export function isPracticeNextLoaded(songId: string, kind?: PracticeAudioKind): boolean {
  return (
    nextSongId === songId &&
    Boolean(nextPcm || nextBytes) &&
    (kind == null || nextKind === kind)
  );
}

export function practiceAudioArmed(): boolean {
  return Boolean(source && startedAt != null);
}

async function findPracticeAudio(
  songId: string,
  files: string[],
  kind: PracticeAudioKind
): Promise<{ path: string; data: ArrayBuffer } | null> {
  const folder = folderForSong(songId);
  const names = (
    kind === "click"
      ? [practiceClickAudio(files), ...CLICK_CANDIDATES]
      : [practiceMasterAudio(files), ...MASTER_CANDIDATES]
  ).filter(
    (name, index, list): name is string => Boolean(name) && list.indexOf(name) === index
  );
  for (const name of names) {
    const data =
      (await readPracticeFileBuffer(folder, name)) ?? (await readPracticeFileBuffer(songId, name));
    if (data) return { path: name, data };
  }
  return null;
}

export async function loadPracticeAudio(
  songId: string,
  files: string[],
  kind: PracticeAudioKind = "master"
): Promise<boolean> {
  if (isPracticeAudioLoaded(songId, kind)) return true;
  const found = await findPracticeAudio(songId, files, kind);
  if (!found) {
    stopPracticeAudio();
    return false;
  }
  stopTick();
  stopSource();
  startOffset = 0;
  pcm = null;
  decodePromise = null;
  bytes = found.data.slice(0);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  const type = found.path.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/flac";
  objectUrl = URL.createObjectURL(new Blob([found.data], { type }));
  const node = element();
  node.pause();
  node.src = objectUrl;
  loadedSongId = songId;
  loadedKind = kind;
  void decodeIfNeeded();
  return true;
}

export async function loadPracticeNextAudio(
  songId: string,
  files: string[],
  kind: PracticeAudioKind = "master"
): Promise<boolean> {
  if (isPracticeNextLoaded(songId, kind) || isPracticeAudioLoaded(songId, kind)) return true;
  const found = await findPracticeAudio(songId, files, kind);
  if (!found) {
    clearPracticeNext();
    return false;
  }
  stopArmedNext();
  nextPcm = null;
  nextDecodePromise = null;
  nextBytes = found.data.slice(0);
  nextSongId = songId;
  nextKind = kind;
  void decodeNextIfNeeded();
  return true;
}

/** Start the preloaded next mix at the PLAY NEXT cue on the audio clock. */
export function armPracticeNextAt(cueSongTime: number, startOffset = 0): boolean {
  if (!practiceCtx || !nextPcm || nextSource) return Boolean(nextSource);
  const remaining = cueSongTime - practiceAudioTime();
  const when = practiceCtx.currentTime + remaining;
  if (remaining < -0.02) {
    return startNextBuffer(startOffset, practiceCtx.currentTime);
  }
  return startNextBuffer(startOffset, when);
}

/** Park the current mix and make the armed next mix the live slot. */
export function promoteArmedPracticeNext(): boolean {
  if (!nextSongId || !(nextPcm || nextBytes)) return false;
  parkPracticeTail();
  loadedSongId = nextSongId;
  loadedKind = nextKind;
  bytes = nextBytes;
  pcm = nextPcm;
  decodePromise = nextDecodePromise;
  const armed = nextSource;
  if (armed) {
    source = armed;
    startedAt = nextStartedAt;
    startOffset = nextStartOffset;
    webPlaying = Boolean(practiceCtx && startedAt != null && practiceCtx.currentTime >= startedAt);
    armed.onended = () => {
      if (source !== armed) return;
      webPlaying = false;
      startedAt = null;
      stopTick();
      timeListener?.(pcm?.duration ?? startOffset, true);
    };
  }
  nextSource = null;
  nextStartedAt = null;
  nextStartOffset = 0;
  nextSongId = null;
  nextKind = null;
  nextBytes = null;
  nextPcm = null;
  nextDecodePromise = null;
  startTick();
  return true;
}

export async function playPracticeAudio(startAt?: number): Promise<void> {
  const offset = Math.max(0, startAt ?? practiceAudioTime());
  startOffset = offset;
  if (practiceCtx?.state === "suspended") {
    await practiceCtx.resume().catch(() => undefined);
  }
  const buffer = await decodeIfNeeded();
  if (buffer && practiceCtx) {
    if (audio && !audio.paused) audio.pause();
    startBuffer(offset);
    startTick();
    return;
  }
  await playHtmlAudio(offset);
  startTick();
}

export function pausePracticeAudio(): void {
  stopTick();
  stopTail();
  stopArmedNext();
  if (webPlaying || practiceAudioArmed()) {
    stopSource();
    return;
  }
  audio?.pause();
  if (audio) startOffset = audio.currentTime;
}

export function seekPracticeAudio(time: number): void {
  const next = Math.max(0, time);
  startOffset = next;
  stopArmedNext();
  if (webPlaying && pcm && practiceCtx) {
    startBuffer(next);
    startTick();
    return;
  }
  if (!audio) return;
  try {
    audio.currentTime = next;
  } catch {
    // WebKit rejects seeks before metadata
  }
}

export function practiceAudioPlaying(): boolean {
  if (webPlaying) return true;
  return Boolean(audio && !audio.paused && !audio.ended);
}

export function practiceAudioTime(): number {
  if (source && practiceCtx && startedAt != null) {
    const duration = pcm?.duration ?? Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(duration, startOffset + (practiceCtx.currentTime - startedAt)));
  }
  if (audio && !audio.paused && !webPlaying) return audio.currentTime;
  return startOffset || audio?.currentTime || 0;
}

export function practiceAudioDuration(): number {
  if (pcm && pcm.duration > 0) return pcm.duration;
  const value = audio?.duration;
  return Number.isFinite(value) && (value ?? 0) > 0 ? (value as number) : 0;
}
