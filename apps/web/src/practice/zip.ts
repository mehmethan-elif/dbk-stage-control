import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import {
  filterPracticeFiles,
  isPracticeFile,
  normalizePracticeName,
  practiceExportFolder,
  practiceSongFolder
} from "@dbk/core";
import { writePracticeFile } from "./store";

export interface PracticeZipEntry {
  folder: string;
  path: string;
  data: Uint8Array;
}

function normalizeZipPath(path: string): string {
  return normalizePracticeName(path.replace(/\\/g, "/").replace(/^\.?\//, ""));
}

function folderFromSongJson(data: Uint8Array, fallback: string): string {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as { id?: unknown; folder?: unknown };
    const id = typeof parsed.id === "string" ? parsed.id : "";
    const folder = typeof parsed.folder === "string" ? parsed.folder : fallback;
    return practiceExportFolder({ id: id || fallback, folder });
  } catch {
    return practiceExportFolder({ id: fallback, folder: fallback });
  }
}

export function entriesFromZip(bytes: Uint8Array): PracticeZipEntry[] {
  const unzipped = unzipSync(bytes);
  const entries: PracticeZipEntry[] = [];
  for (const [rawPath, data] of Object.entries(unzipped)) {
    const path = normalizeZipPath(rawPath);
    if (!path || path.endsWith("/")) continue;
    const parts = path.split("/").filter((part) => part && part !== "__MACOSX" && !part.startsWith("."));
    if (parts.length === 0) continue;
    const fileName = parts[parts.length - 1] ?? "";
    if (!isPracticeFile(fileName) || fileName.startsWith(".")) continue;
    const folder = normalizePracticeName(
      parts.length >= 2 ? (parts[parts.length - 2] ?? "") : (practiceSongFolder(path) ?? "")
    );
    if (!folder) continue;
    const rel = normalizePracticeName(parts[parts.length - 1] ?? fileName);
    entries.push({ folder, path: rel, data });
  }
  return entries;
}

export async function importPracticeEntries(entries: PracticeZipEntry[]): Promise<number> {
  const aliases = new Map<string, string>();
  for (const entry of entries) {
    if (entry.path.toLowerCase() !== "song.json") continue;
    aliases.set(entry.folder, folderFromSongJson(entry.data, entry.folder));
  }
  let count = 0;
  const folders = new Set<string>();
  for (const entry of entries) {
    const folder = aliases.get(entry.folder) ?? practiceExportFolder({ id: entry.folder, folder: entry.folder });
    const copy = new Uint8Array(entry.data.byteLength);
    copy.set(entry.data);
    await writePracticeFile(folder, entry.path, copy.buffer);
    folders.add(folder);
    count += 1;
  }
  return folders.size;
}

export async function importPracticeZip(file: Blob): Promise<number> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return importPracticeEntries(entriesFromZip(bytes));
}

export async function importPracticeFileList(files: Iterable<File>): Promise<number> {
  const entries: PracticeZipEntry[] = [];
  for (const file of files) {
    const rel = normalizeZipPath(file.webkitRelativePath || file.name);
    const parts = rel.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const fileName = parts[parts.length - 1] ?? file.name;
    if (!isPracticeFile(fileName)) continue;
    const folder = normalizePracticeName(parts[parts.length - 2] ?? "");
    if (!folder) continue;
    entries.push({
      folder,
      path: normalizePracticeName(fileName),
      data: new Uint8Array(await file.arrayBuffer())
    });
  }
  return importPracticeEntries(entries);
}

export function buildPracticeZip(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const payload: Record<string, Uint8Array> = {};
  for (const file of files) {
    if (!isPracticeFile(file.path.split("/").pop() ?? file.path)) continue;
    payload[file.path] = file.data;
  }
  return zipSync(payload);
}

export function practiceZipName(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `dbk-practice-${stamp}.zip`;
}

export { filterPracticeFiles, strToU8, strFromU8 };
