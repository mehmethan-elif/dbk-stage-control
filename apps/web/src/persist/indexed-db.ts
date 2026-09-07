import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Gig } from "@dbk/core";
import { seedGig } from "./seed";

const DB_NAME = "dbk-stage-control";
const DB_VERSION = 1;

interface StageDB extends DBSchema {
  musicians: {
    key: string;
    value: { id: string };
  };
  gigs: {
    key: string;
    value: Gig;
  };
  meta: {
    key: string;
    value: string;
  };
}

let dbPromise: Promise<IDBPDatabase<StageDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<StageDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains("musicians")) {
          database.createObjectStore("musicians", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("gigs")) {
          database.createObjectStore("gigs", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("meta")) {
          database.createObjectStore("meta");
        }
      }
    });
  }
  return dbPromise;
}

export async function loadLocalLibrary(): Promise<{ gigs: Gig[] }> {
  const database = await db();
  const seeded = await database.get("meta", "seeded");
  if (!seeded) {
    const gig = seedGig();
    const tx = database.transaction(["gigs", "meta"], "readwrite");
    await tx.objectStore("gigs").put(gig);
    await tx.objectStore("meta").put("1", "seeded");
    await tx.done;
  }
  return {
    gigs: await database.getAll("gigs")
  };
}

export async function saveGig(gig: Gig): Promise<void> {
  await (await db()).put("gigs", gig);
}

export async function deleteGig(id: string): Promise<void> {
  await (await db()).delete("gigs", id);
}
