const CHART_NAMES = new Set(["song.json", "settings.json", "lyrics.json", "lyrics.txt"]);
const MASTER_AUDIO = new Set(["master.mp3", "master.flac"]);
const CHART_EXT = [".pdf", ".musicxml"];

export function fileNameOf(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? normalized;
}

export function isMasterPracticeAudio(relPath: string): boolean {
  return MASTER_AUDIO.has(fileNameOf(relPath).toLowerCase());
}

export function isPracticeFile(relPath: string): boolean {
  const name = fileNameOf(relPath);
  const base = name.toLowerCase();
  if (CHART_NAMES.has(base) || MASTER_AUDIO.has(base)) return true;
  return CHART_EXT.some((ext) => base.endsWith(ext));
}

export function filterPracticeFiles(files: readonly string[]): string[] {
  return files.filter((file) => isPracticeFile(file));
}

export function practiceMasterAudio(files: readonly string[]): string | undefined {
  const lower = files.find((file) => fileNameOf(file).toLowerCase() === "master.mp3");
  if (lower) return lower;
  return files.find((file) => fileNameOf(file).toLowerCase() === "master.flac");
}

export function practiceSongFolder(path: string): string | null {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const songJson = parts.lastIndexOf("song.json");
  if (songJson >= 1) return parts[songJson - 1] ?? null;
  if (parts.length >= 2 && isPracticeFile(parts[parts.length - 1] ?? "")) {
    return parts[parts.length - 2] ?? null;
  }
  return parts.length === 1 && isPracticeFile(parts[0] ?? "") ? null : parts[0] ?? null;
}
