import { filterPracticeFiles, practiceExportFolder, type Song } from "@dbk/core";
import { libraryApi } from "../library/api";
import { buildPracticeZip, practiceZipName } from "./zip";

export async function exportPracticeZip(
  songs: Song[],
  fileIndex: Record<string, string[]>,
  onlySongIds?: string[]
): Promise<{ name: string; bytes: Uint8Array }> {
  const wanted = onlySongIds ? new Set(onlySongIds) : null;
  const files: { path: string; data: Uint8Array }[] = [];
  for (const song of songs) {
    if (wanted && !wanted.has(song.id)) continue;
    const folder = practiceExportFolder(song);
    const listed = filterPracticeFiles(fileIndex[song.id] ?? []);
    for (const rel of listed) {
      try {
        const buffer = await libraryApi.readBytes(song.id, rel);
        files.push({
          path: `${folder}/${rel}`,
          data: new Uint8Array(buffer)
        });
      } catch {
        // skip missing optional files
      }
    }
  }
  return { name: practiceZipName(), bytes: buildPracticeZip(files) };
}

export function downloadBytes(name: string, bytes: Uint8Array): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
