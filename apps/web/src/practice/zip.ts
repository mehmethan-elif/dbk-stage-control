import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { filterPracticeFiles, isPracticeFile, practiceSongFolder } from "@dbk/core";
import { writePracticeFile } from "./store";

export interface PracticeZipEntry {
  folder: string;
  path: string;
  data: Uint8Array;
}

function normalizeZipPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
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
    const folder = parts.length >= 2 ? (parts[parts.length - 2] ?? "") : (practiceSongFolder(path) ?? "");
    if (!folder) continue;
    const rel = parts[parts.length - 1] ?? fileName;
    entries.push({ folder, path: rel, data });
  }
  return entries;
}

export async function importPracticeEntries(entries: PracticeZipEntry[]): Promise<number> {
  let count = 0;
  const folders = new Set<string>();
  for (const entry of entries) {
    const copy = new Uint8Array(entry.data.byteLength);
    copy.set(entry.data);
    await writePracticeFile(entry.folder, entry.path, copy.buffer);
    folders.add(entry.folder);
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
    const folder = parts[parts.length - 2] ?? "";
    if (!folder) continue;
    entries.push({
      folder,
      path: fileName,
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
