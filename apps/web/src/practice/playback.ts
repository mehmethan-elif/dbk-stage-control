import { practiceMasterAudio } from "@dbk/core";
import { folderForSong } from "../native/library";
import { readPracticeFileBuffer } from "./store";

let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let timeListener: ((time: number, ended: boolean) => void) | null = null;

function element(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener("timeupdate", () => timeListener?.(audio?.currentTime ?? 0, false));
    audio.addEventListener("ended", () => timeListener?.(audio?.duration || 0, true));
  }
  return audio;
}

export function onPracticeTime(listener: ((time: number, ended: boolean) => void) | null): void {
  timeListener = listener;
}

export function stopPracticeAudio(): void {
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

export async function loadPracticeAudio(songId: string, files: string[]): Promise<boolean> {
  const path = practiceMasterAudio(files);
  if (!path) {
    stopPracticeAudio();
    return false;
  }
  const folder = folderForSong(songId);
  const data = await readPracticeFileBuffer(folder, path);
  if (!data) {
    stopPracticeAudio();
    return false;
  }
  stopPracticeAudio();
  const type = path.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/flac";
  objectUrl = URL.createObjectURL(new Blob([data], { type }));
  const node = element();
  node.src = objectUrl;
  await node.load();
  return true;
}

export async function playPracticeAudio(): Promise<void> {
  await element().play();
}

export function pausePracticeAudio(): void {
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
