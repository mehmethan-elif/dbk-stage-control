import { isPracticeFile } from "@dbk/core";
import { PRACTICE_SHARE_PORT } from "../native/sync";
import { listPracticeManifest, writePracticeFile } from "./store";

export interface PracticeRemoteFile {
  path: string;
  size: number;
}

export interface PracticeRemoteSong {
  id: string;
  folder: string;
  files: PracticeRemoteFile[];
}

export interface PracticeRemoteIndex {
  songs: PracticeRemoteSong[];
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/$/, "");
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
}

export function practiceHostFromInput(value: string): string {
  const raw = value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!raw) return "";
  if (raw.includes(":")) return `http://${raw}`;
  if (raw === "localhost" || raw === "127.0.0.1") {
    return `http://${raw}:${window.location.port || "5173"}`;
  }
  return `http://${raw}:${PRACTICE_SHARE_PORT}`;
}

export async function fetchPracticeIndex(base: string): Promise<PracticeRemoteIndex> {
  const response = await fetch(joinUrl(base, "/practice/index.json"));
  if (!response.ok) throw new Error(`Practice index ${response.status}`);
  return (await response.json()) as PracticeRemoteIndex;
}

export async function pullPracticeFromHost(base: string): Promise<number> {
  const index = await fetchPracticeIndex(base);
  const local = await listPracticeManifest();
  let songs = 0;
  for (const song of index.songs) {
    const have = new Map((local[song.folder] ?? []).map((item) => [item.path, item.size]));
    let changed = false;
    for (const file of song.files) {
      if (!isPracticeFile(file.path)) continue;
      if (have.get(file.path) === file.size) continue;
      const response = await fetch(
        joinUrl(
          base,
          `/practice/songs/${encodeURIComponent(song.folder)}/${file.path
            .split("/")
            .map((part) => encodeURIComponent(part))
            .join("/")}`
        )
      );
      if (!response.ok) continue;
      await writePracticeFile(song.folder, file.path, await response.arrayBuffer());
      changed = true;
    }
    if (changed || !local[song.folder]) songs += 1;
  }
  return songs;
}
