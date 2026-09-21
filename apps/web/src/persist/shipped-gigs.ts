import {
  dropMissingSetlistSongs,
  isSongEntry,
  resolvePublishedSongId,
  type Gig,
  type Song
} from "@dbk/core";

const SEED_GIG_ID = "gig_2026_09_12";

export function parsePackedGigs(raw: unknown): Gig[] {
  if (!raw || typeof raw !== "object") return [];
  const gigs = (raw as { gigs?: unknown }).gigs;
  if (!Array.isArray(gigs)) return [];
  return gigs.filter(isPackedGig);
}

function isPackedGig(value: unknown): value is Gig {
  if (!value || typeof value !== "object") return false;
  const gig = value as Gig;
  return typeof gig.id === "string" && gig.id.length > 0 && typeof gig.name === "string" && Array.isArray(gig.setlist);
}

export function isPlaceholderSetlist(
  gig: Gig,
  songs: readonly { id: string; folder?: string; title?: string }[]
): boolean {
  if (gig.id === SEED_GIG_ID) return true;
  if (gig.setlist.length === 0) return false;
  return !gig.setlist.some((entry) => {
    if (!isSongEntry(entry)) return false;
    return Boolean(resolvePublishedSongId(entry.songId, songs) || songs.some((song) => song.id === entry.songId));
  });
}

export function mergeShippedGigs(local: Gig[], shipped: Gig[], songs: readonly Song[]): Gig[] {
  const remapped = dropMissingSetlistSongs(
    shipped.map((gig) => ({
      ...gig,
      setlist: gig.setlist.map((entry) => {
        if (!isSongEntry(entry)) return entry;
        return { ...entry, songId: resolvePublishedSongId(entry.songId, songs) ?? entry.songId };
      })
    })),
    songs
  ).filter((gig) => gig.setlist.some((entry) => isSongEntry(entry)));
  // The Mac library/gigs.json is the show. A matching iPad IndexedDB copy is last
  // week's order, not a second setlist, so the shipped songs stay in Mac order.
  const shippedIds = new Set(remapped.map((gig) => gig.id));
  const shippedNames = new Set(remapped.map((gig) => gig.name.trim().toLowerCase()));
  const extra = local.filter((gig) => {
    if (isPlaceholderSetlist(gig, songs)) return false;
    return !shippedIds.has(gig.id) && !shippedNames.has(gig.name.trim().toLowerCase());
  });
  return [...remapped, ...extra];
}
