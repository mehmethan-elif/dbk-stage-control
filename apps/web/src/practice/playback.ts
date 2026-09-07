import { practiceMasterAudio } from "@dbk/core";
import { folderForSong } from "../native/library";
import { readPracticeFileBuffer } from "./store";

const MASTER_CANDIDATES = ["Master.mp3", "master.mp3", "Master.flac", "master.flac"];

let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let loadedSongId: string | null = null;
let timeListener: ((time: number, ended: boolean) => void) | null = null;
let tick: number | null = null;

function emitTime(ended = false): void {
  timeListener?.(audio?.currentTime ?? 0, ended);
}

function startTick(): void {
  if (tick != null) return;
  tick = window.setInterval(() => {
    if (!audio || audio.paused || audio.ended) return;
    emitTime(false);
  }, 100);
}

function stopTick(): void {
  if (tick == null) return;
  window.clearInterval(tick);
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
}

export function isPracticeAudioLoaded(songId: string): boolean {
  return loadedSongId === songId && Boolean(audio?.src);
}

export async function loadPracticeAudio(songId: string, files: string[]): Promise<boolean> {
  const folder = folderForSong(songId);
  const names = [practiceMasterAudio(files), ...MASTER_CANDIDATES].filter(
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
  return true;
}

export async function playPracticeAudio(): Promise<void> {
  await element().play();
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
