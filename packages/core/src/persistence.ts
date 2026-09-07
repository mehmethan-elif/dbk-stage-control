import type { Gig, Musician, Song } from "./models.js";

export interface LibrarySnapshot {
  songs: Song[];
  musicians: Musician[];
  gigs: Gig[];
  fileIndex?: Record<string, string[]>;
}

export interface LibraryRepository {
  listSongs(): Promise<Song[]>;
  getSong(id: string): Promise<Song | undefined>;
  listMusicians(): Promise<Musician[]>;
  saveMusician(musician: Musician): Promise<void>;
  deleteMusician(id: string): Promise<void>;
  listGigs(): Promise<Gig[]>;
  getGig(id: string): Promise<Gig | undefined>;
  saveGig(gig: Gig): Promise<void>;
  deleteGig(id: string): Promise<void>;
  getFileIndex?(): Promise<Record<string, string[]>>;
}

export class MemoryLibraryRepository implements LibraryRepository {
  private songs = new Map<string, Song>();
  private musicians = new Map<string, Musician>();
  private gigs = new Map<string, Gig>();
  private fileIndex: Record<string, string[]> = {};

  constructor(seed?: Partial<LibrarySnapshot>) {
    for (const song of seed?.songs ?? []) this.songs.set(song.id, song);
    for (const musician of seed?.musicians ?? []) this.musicians.set(musician.id, musician);
    for (const gig of seed?.gigs ?? []) this.gigs.set(gig.id, gig);
    this.fileIndex = { ...(seed?.fileIndex ?? {}) };
  }

  async listSongs(): Promise<Song[]> {
    return [...this.songs.values()];
  }

  async getSong(id: string): Promise<Song | undefined> {
    return this.songs.get(id);
  }

  async listMusicians(): Promise<Musician[]> {
    return [...this.musicians.values()];
  }

  async saveMusician(musician: Musician): Promise<void> {
    this.musicians.set(musician.id, musician);
  }

  async deleteMusician(id: string): Promise<void> {
    this.musicians.delete(id);
  }

  async listGigs(): Promise<Gig[]> {
    return [...this.gigs.values()];
  }

  async getGig(id: string): Promise<Gig | undefined> {
    return this.gigs.get(id);
  }

  async saveGig(gig: Gig): Promise<void> {
    this.gigs.set(gig.id, gig);
  }

  async deleteGig(id: string): Promise<void> {
    this.gigs.delete(id);
  }

  async getFileIndex(): Promise<Record<string, string[]>> {
    return { ...this.fileIndex };
  }

  setSongs(songs: Song[]): void {
    this.songs = new Map(songs.map((song) => [song.id, song]));
  }

  setFileIndex(index: Record<string, string[]>): void {
    this.fileIndex = { ...index };
  }

  toJSON(): LibrarySnapshot {
    return {
      songs: [...this.songs.values()],
      musicians: [...this.musicians.values()],
      gigs: [...this.gigs.values()],
      fileIndex: { ...this.fileIndex }
    };
  }

  static fromJSON(data: LibrarySnapshot): MemoryLibraryRepository {
    return new MemoryLibraryRepository(data);
  }
}
