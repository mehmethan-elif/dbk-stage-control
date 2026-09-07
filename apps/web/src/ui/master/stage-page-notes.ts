import { readSongSettings, updateSongSettings } from "./song-settings";

export type StageNotesPage = "lyrics" | "score" | "chord" | "drums";

export const STAGE_NOTE_PAGES: StageNotesPage[] = ["lyrics", "score", "chord", "drums"];

const notesCache = new Map<string, Record<StageNotesPage, string>>();

function emptyNotes(): Record<StageNotesPage, string> {
  return { lyrics: "", score: "", chord: "", drums: "" };
}

function oneLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s*\n+\s*/g, " ") : "";
}

function parseNotesFile(raw: unknown): Record<StageNotesPage, string> {
  const next = emptyNotes();
  if (!raw || typeof raw !== "object") return next;
  const record = raw as Record<string, unknown>;
  for (const page of STAGE_NOTE_PAGES) next[page] = oneLine(record[page]);
  return next;
}

export function rememberStageNotes(songId: string, notes: Record<StageNotesPage, string>): void {
  notesCache.set(songId, { ...notes });
}

export async function loadAllStageNotes(songId: string): Promise<Record<StageNotesPage, string>> {
  const cached = notesCache.get(songId);
  if (cached) return { ...cached };
  try {
    const settings = await readSongSettings(songId);
    const next = parseNotesFile(settings.notes);
    rememberStageNotes(songId, next);
    return next;
  } catch {
    const next = emptyNotes();
    rememberStageNotes(songId, next);
    return next;
  }
}

export async function loadStageNotes(songId: string, page: StageNotesPage): Promise<string> {
  const all = await loadAllStageNotes(songId);
  return all[page];
}

export async function saveStageNotes(songId: string, page: StageNotesPage, notes: string): Promise<void> {
  const current = notesCache.get(songId) ?? (await loadAllStageNotes(songId));
  const next = { ...current, [page]: oneLine(notes) };
  rememberStageNotes(songId, next);
  const payload: Partial<Record<StageNotesPage, string>> = {};
  for (const item of STAGE_NOTE_PAGES) {
    if (next[item].trim()) payload[item] = next[item];
  }
  await updateSongSettings(songId, (settings) => ({ ...settings, notes: payload }));
}
