import { createId, type Section } from "@dbk/core";
import { readSongSettings, updateSongSettings } from "./song-settings";

export interface NotaSectionBox {
  id: string;
  name: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_W = 0.04;
const MIN_H = 0.03;

export function uniqueSectionNames(sections: Section[]): string[] {
  const names: string[] = [];
  for (const section of sections) {
    if (!names.includes(section.name)) names.push(section.name);
  }
  return names;
}

export function clampNotaBox(box: NotaSectionBox): NotaSectionBox {
  const w = Math.min(1, Math.max(MIN_W, box.w));
  const h = Math.min(1, Math.max(MIN_H, box.h));
  return {
    id: box.id,
    name: box.name,
    page: Math.max(0, Math.round(box.page)),
    w,
    h,
    x: Math.min(1 - w, Math.max(0, box.x)),
    y: Math.min(1 - h, Math.max(0, box.y))
  };
}

function similarBox(a: NotaSectionBox, b: NotaSectionBox): boolean {
  return (
    a.name === b.name &&
    a.page === b.page &&
    Math.abs(a.x - b.x) < 0.04 &&
    Math.abs(a.y - b.y) < 0.04 &&
    Math.abs(a.w - b.w) < 0.04 &&
    Math.abs(a.h - b.h) < 0.04
  );
}

export function parseNotaSections(raw: unknown, sections: Section[] = []): NotaSectionBox[] {
  if (!raw || typeof raw !== "object") return [];
  const rects = (raw as { rects?: unknown }).rects;
  if (!Array.isArray(rects)) return [];
  const migrated = rects.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return typeof row.name !== "string" || row.name.length === 0;
  });
  const out: NotaSectionBox[] = [];
  for (const item of rects) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const page = Number(row.page);
    const x = Number(row.x);
    const y = Number(row.y);
    const w = Number(row.w);
    const h = Number(row.h);
    if (![page, x, y, w, h].every(Number.isFinite)) continue;
    let name = typeof row.name === "string" ? row.name : "";
    if (!name) {
      const sectionIndex = Number(row.sectionIndex);
      name = Number.isFinite(sectionIndex) ? (sections[sectionIndex]?.name ?? "") : "";
    }
    if (!name) continue;
    const id = typeof row.id === "string" && row.id ? row.id : createId("rect");
    const box = clampNotaBox({ id, name, page, x, y, w, h });
    if (migrated && out.some((existing) => similarBox(existing, box))) continue;
    out.push(box);
  }
  return out;
}

export async function loadNotaSections(songId: string, sections: Section[] = []): Promise<NotaSectionBox[]> {
  try {
    const settings = await readSongSettings(songId);
    return parseNotaSections(settings.notaSections, sections);
  } catch {
    return [];
  }
}

export async function saveNotaSections(songId: string, rects: NotaSectionBox[]): Promise<void> {
  await updateSongSettings(songId, (settings) => ({
    ...settings,
    notaSections: {
      version: 1,
      rects: rects.map((box) => {
        const next = clampNotaBox(box);
        return {
          id: next.id,
          name: next.name,
          page: next.page,
          x: next.x,
          y: next.y,
          w: next.w,
          h: next.h
        };
      })
    }
  }));
}

export function upsertNotaBox(rects: NotaSectionBox[], box: NotaSectionBox): NotaSectionBox[] {
  const next = clampNotaBox(box);
  const index = rects.findIndex((item) => item.id === next.id);
  if (index < 0) return [...rects, next];
  return rects.map((item, i) => (i === index ? next : item));
}

export function defaultNotaBox(name: string, page: number, existing = 0): NotaSectionBox {
  return clampNotaBox({
    id: createId("rect"),
    name,
    page,
    x: 0.06,
    y: Math.min(0.78, 0.08 + existing * 0.16),
    w: 0.36,
    h: 0.14
  });
}
