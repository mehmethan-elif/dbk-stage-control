import { practiceClickAudio, practiceMasterAudio } from "@dbk/core";
import { folderForSong } from "../library/api";
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

function emitTime(ended = false): void {
  if (!ended && audio?.paused) return;
  timeListener?.(audio?.currentTime ?? 0, ended);
}

function startTick(): void {
  if (tick != null) return;
  const loop = () => {
    if (!audio || audio.paused || audio.ended) {
      tick = null;
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
      timeListener?.(audio?.duration || audio?.currentTime || 0, true);
    });
  }
  return audio;
}

export function onPracticeTime(listener: ((time: number, ended: boolean) => void) | null): void {
  timeListener = listener;
}

export function stopPracticeAudio(): void {
  stopTick();
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
    Boolean(audio?.src) &&
    (kind == null || loadedKind === kind)
  );
}

export async function loadPracticeAudio(
  songId: string,
  files: string[],
  kind: PracticeAudioKind = "master"
): Promise<boolean> {
  const folder = folderForSong(songId);
  const names = (
    kind === "click"
      ? [practiceClickAudio(files), ...CLICK_CANDIDATES]
      : [practiceMasterAudio(files), ...MASTER_CANDIDATES]
  ).filter(
    (name, index, list): name is string => Boolean(name) && list.indexOf(name) === index
  );
  let found: { path: string; data: ArrayBuffer } | null = null;
  for (const name of names) {
    const data =
      (await readPracticeFileBuffer(folder, name)) ?? (await readPracticeFileBuffer(songId, name));
    if (data) {
      found = { path: name, data };
      break;
    }
  }
  if (!found) {
    stopPracticeAudio();
    return false;
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  const type = found.path.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/flac";
  objectUrl = URL.createObjectURL(new Blob([found.data], { type }));
  const node = element();
  node.pause();
  node.src = objectUrl;
  loadedSongId = songId;
  loadedKind = kind;
  return true;
}

export async function playPracticeAudio(): Promise<void> {
  const node = element();
  const from = node.currentTime;
  await node.play();
  if (!node.paused && Math.abs(node.currentTime - from) < 1e-4) {
    await new Promise<void>((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        node.removeEventListener("playing", done);
        node.removeEventListener("timeupdate", done);
        resolve();
      };
      const timer = window.setTimeout(done, 400);
      node.addEventListener("playing", done, { once: true });
      node.addEventListener("timeupdate", done, { once: true });
    });
  }
  startTick();
}

export function pausePracticeAudio(): void {
  stopTick();
  audio?.pause();
}

export function seekPracticeAudio(time: number): void {
  if (!audio) return;
  audio.currentTime = Math.max(0, time);
}

export function practiceAudioPlaying(): boolean {
  return Boolean(audio && !audio.paused && !audio.ended);
}

export function practiceAudioTime(): number {
  return audio?.currentTime ?? 0;
}

export function practiceAudioDuration(): number {
  const value = audio?.duration;
  return Number.isFinite(value) && (value ?? 0) > 0 ? (value as number) : 0;
}
