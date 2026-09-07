const CHART_NAMES = new Set(["song.json", "settings.json", "lyrics.json", "lyrics.txt"]);
const MASTER_AUDIO = new Set(["master.mp3", "master.flac"]);
const CHART_EXT = [".pdf", ".musicxml"];
const TURKISH_ASCII: Record<string, string> = {
  ç: "c",
  Ç: "c",
  ğ: "g",
  Ğ: "g",
  ı: "i",
  İ: "i",
  ö: "o",
  Ö: "o",
  ş: "s",
  Ş: "s",
  ü: "u",
  Ü: "u"
};

export function fileNameOf(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? normalized;
}

export function normalizePracticeName(value: string): string {
  return value.normalize("NFC").trim();
}

export function practiceFolderSlug(value: string): string {
  const ascii = [...normalizePracticeName(value)]
    .map((char) => TURKISH_ASCII[char] ?? char)
    .join("");
  return (
    ascii
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "song"
  );
}

export function isSafePracticeFolder(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}

export function practiceExportFolder(song: { id: string; folder?: string }): string {
  if (isSafePracticeFolder(song.id)) return song.id;
  if (song.folder && isSafePracticeFolder(song.folder)) return song.folder;
  return practiceFolderSlug(song.folder || song.id);
}

export function samePracticeFolder(left: string, right: string): boolean {
  const a = normalizePracticeName(left);
  const b = normalizePracticeName(right);
  return a === b || a.normalize("NFD") === b.normalize("NFD") || practiceFolderSlug(a) === practiceFolderSlug(b);
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
