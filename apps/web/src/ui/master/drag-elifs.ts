import { isLockedElif, type SetlistEntry } from "@dbk/core";

/** A locked ELIF KONUSMA row remembered against the row it sits behind. */
export type FrozenElif = { after: string | null; entry: SetlistEntry };

/**
 * Locked ELIF KONUSMA rows are worked out from the order around them, so recomputing them
 * while a song is mid-drag makes rows appear and vanish under the finger. Both setlists
 * freeze them at the start of a drag instead and let the next render past mouse up decide
 * whether the new order needs a different set.
 */
export function frozenElifs(displayed: readonly SetlistEntry[]): FrozenElif[] {
  const frozen: FrozenElif[] = [];
  let after: string | null = null;
  for (const entry of displayed) {
    if (isLockedElif(entry)) frozen.push({ after, entry });
    else after = entry.entryId;
  }
  return frozen;
}

/** Puts `frozen` back into `order`, each one behind the row it was captured against. */
export function withFrozenElifs(
  order: readonly SetlistEntry[],
  frozen: readonly FrozenElif[]
): SetlistEntry[] {
  if (frozen.length === 0) return [...order];
  const out: SetlistEntry[] = [];
  for (const item of frozen) {
    if (item.after === null) out.push(item.entry);
  }
  for (const entry of order) {
    out.push(entry);
    for (const item of frozen) {
      if (item.after === entry.entryId) out.push(item.entry);
    }
  }
  return out;
}
