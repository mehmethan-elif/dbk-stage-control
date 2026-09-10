import type { Logger } from "@dbk/logger";
import type { AudioDeck, AudioEngine } from "./audio-engine.js";
import { clickAsset } from "./audio-engine.js";
import {
  DeckId,
  FinishMode,
  PlaybackState,
  PlayMode,
  entryPlayMode,
  isSongEntry
} from "./models.js";
import type {
  DeckId as DeckIdType,
  Gig,
  LoadedBuffers,
  PerformanceClock,
  PlaybackState as PlaybackStateType,
  Song,
  SongSetlistEntry
} from "./models.js";
import {
  effectiveFinishMode,
  songChainStartAt,
  nextUnskippedSongIndex,
  previousSongIndex
} from "./setlist.js";
import { firstSectionNamed, sectionAt, sectionNamed, timeToMusical } from "./timeline.js";

export interface PlaybackSnapshot {
  state: PlaybackStateType;
  clock: PerformanceClock | null;
  currentIndex: number;
  errorMessage: string | null;
  primaryDeck: DeckIdType;
  outgoingDeck: DeckIdType | null;
  preloadedSongId: string | null;
  endedToEntryId: string | null;
}

export type PlaybackListener = (snapshot: PlaybackSnapshot) => void;
export type BufferLoader = (song: Song) => Promise<LoadedBuffers>;

const EMPTY_SNAPSHOT: PlaybackSnapshot = {
  state: PlaybackState.Idle,
  clock: null,
  currentIndex: -1,
  errorMessage: null,
  primaryDeck: DeckId.A,
  outgoingDeck: null,
  preloadedSongId: null,
  endedToEntryId: null
};

function otherDeck(id: DeckIdType): DeckIdType {
  return id === DeckId.A ? DeckId.B : DeckId.A;
}

export class PlaybackController {
  private readonly engine: AudioEngine;
  private readonly logger: Logger;
  private readonly loadBuffers: BufferLoader;
  private readonly decks: Record<DeckIdType, AudioDeck>;
  private readonly listeners = new Set<PlaybackListener>();

  private state: PlaybackStateType = PlaybackState.Idle;
  private gig: Gig | null = null;
  private songs = new Map<string, Song>();
  private currentIndex = -1;
  private primary: DeckIdType = DeckId.A;
  private outgoing: DeckIdType | null = null;
  private playNextScheduled = false;
  private playNextInFlight = false;
  private chainEnabled = true;
  private pendingSeek: number | null = null;
  private errorMessage: string | null = null;
  private endedToEntryId: string | null = null;
  private unsubs: Array<() => void> = [];

  constructor(opts: {
    engine: AudioEngine;
    logger: Logger;
    loadBuffers: BufferLoader;
  }) {
    this.engine = opts.engine;
    this.logger = opts.logger;
    this.loadBuffers = opts.loadBuffers;
    this.decks = {
      [DeckId.A]: this.engine.createDeck(DeckId.A),
      [DeckId.B]: this.engine.createDeck(DeckId.B)
    };
    this.bindDeck(DeckId.A);
    this.bindDeck(DeckId.B);
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): PlaybackSnapshot {
    return {
      state: this.state,
      clock: this.getClock(),
      currentIndex: this.currentIndex,
      errorMessage: this.errorMessage,
      primaryDeck: this.primary,
      outgoingDeck: this.outgoing,
      preloadedSongId: this.decks[otherDeck(this.primary)].loadedSongId,
      endedToEntryId: this.endedToEntryId
    };
  }

  getClock(): PerformanceClock | null {
    const entry = this.currentSongEntry();
    const song = this.currentSong();
    if (!entry || !song) return null;
    const deck = this.decks[this.primary];
    const time = deck.getPosition();
    const musical = timeToMusical(song.tempoMap, time);
    const section = sectionAt(song.sections, time);
    const playing =
      this.state === PlaybackState.Playing || this.state === PlaybackState.Transitioning;
    return {
      songId: song.id,
      setlistEntryId: entry.entryId,
      time,
      measure: musical.measure,
      beat: musical.beat,
      section: section?.name,
      playing,
      nextSongId: this.nextSong()?.id,
      finishMode: this.currentFinishMode()
    };
  }

  async setShow(gig: Gig, songs: Song[]): Promise<void> {
    this.gig = gig;
    this.songs = new Map(songs.map((song) => [song.id, song]));
    this.currentIndex = -1;
    this.playNextScheduled = false;
    this.pendingSeek = null;
    this.outgoing = null;
    this.primary = DeckId.A;
    this.decks[DeckId.A].unload();
    this.decks[DeckId.B].unload();
    this.state = PlaybackState.Idle;
    this.errorMessage = null;
    this.emit();
  }

  replaceShow(gig: Gig): void {
    const currentId =
      this.currentIndex >= 0 ? this.gig?.setlist[this.currentIndex]?.entryId : undefined;
    this.gig = gig;
    if (currentId) {
      this.currentIndex = gig.setlist.findIndex((entry) => entry.entryId === currentId);
    }
    if (this.state === PlaybackState.Playing || this.state === PlaybackState.Transitioning) {
      void this.preloadAndMaybeSchedule().then(() => this.emit());
    }
    this.emit();
  }

  replaceSongs(songs: Song[]): void {
    this.songs = new Map(songs.map((song) => [song.id, song]));
    this.syncLoadedSongs();
  }

  async selectIndex(setlistIndex: number): Promise<void> {
    if (!this.gig) return;
    const entry = this.gig.setlist[setlistIndex];
    if (!entry || !isSongEntry(entry)) {
      this.fail("That setlist item is not a song.");
      return;
    }
    const already = this.songs.get(entry.songId);
    if (
      already &&
      this.currentIndex === setlistIndex &&
      this.decks[DeckId.A].loadedSongId === already.id &&
      (this.state === PlaybackState.Ready ||
        this.state === PlaybackState.Playing ||
        this.state === PlaybackState.Transitioning)
    ) {
      this.syncLoadedSongs();
      return;
    }
    this.state = PlaybackState.Loading;
    this.errorMessage = null;
    this.playNextScheduled = false;
    this.pendingSeek = null;
    this.outgoing = null;
    this.emit();
    await this.engine.init();

    const song = this.songs.get(entry.songId);
    if (!song) {
      this.currentIndex = -1;
      this.decks[DeckId.A].unload();
      this.fail("Song is not in the library.");
      return;
    }

    try {
      const buffers = await this.loadBuffers(song);
      this.currentIndex = setlistIndex;
      this.primary = DeckId.A;
      this.decks[DeckId.B].unload();
      await this.decks[DeckId.A].load(song, buffers);
      this.state = PlaybackState.Ready;
      this.logger.playback("song_loaded", { songId: song.id, title: song.title });
      this.emit();
      void this.preloadNext()
        .then(() => this.emit())
        .catch((err: unknown) => {
          this.logger.playback("preload_failed", { error: String(err) });
        });
    } catch (err) {
      this.currentIndex = -1;
      this.decks[DeckId.A].unload();
      this.fail(this.userError(err));
    }
  }

  async play(opts?: { chain?: boolean }): Promise<void> {
    await this.engine.init();
    const song = this.currentSong();
    const entry = this.currentSongEntry();
    if (!song || !entry) {
      this.fail("No song is selected.");
      return;
    }
    if (this.state === PlaybackState.Playing || this.state === PlaybackState.Transitioning) {
      return;
    }

    const click = clickAsset(song);
    const finish = this.currentFinishMode();
    const chain = opts?.chain !== false;
    if (chain && finish === FinishMode.PlayNext && !click) {
      this.fail("Song cannot play: Click track missing.");
      return;
    }

    this.errorMessage = null;
    this.outgoing = null;
    this.playNextScheduled = false;
    this.playNextInFlight = false;
    this.chainEnabled = chain;
    if (this.pendingSeek !== null) {
      this.decks[this.primary].seek(this.pendingSeek);
    }
    this.decks[this.primary].play();
    this.state = PlaybackState.Playing;
    this.logger.playback("song_started", { songId: song.id, title: song.title });
    this.emit();
    if (chain) {
      await this.preloadAndMaybeSchedule();
    }
  }

  stopImmediate(): void {
    this.playNextScheduled = false;
    this.playNextInFlight = false;
    this.chainEnabled = false;
    this.outgoing = null;
    this.pendingSeek = null;
    this.decks[DeckId.A].stop();
    this.decks[DeckId.B].stop();
    this.state = this.currentSong() ? PlaybackState.Ready : PlaybackState.Idle;
    this.logger.playback("stopped", { songId: this.currentSong()?.id });
    this.emit();
  }

  pause(): void {
    if (this.state !== PlaybackState.Playing && this.state !== PlaybackState.Transitioning) return;
    this.playNextScheduled = false;
    this.playNextInFlight = false;
    this.chainEnabled = false;
    this.outgoing = null;
    this.decks[DeckId.A].pause();
    this.decks[DeckId.B].pause();
    this.pendingSeek = this.decks[this.primary].getPosition();
    this.state = PlaybackState.Ready;
    this.logger.playback("paused", { songId: this.currentSong()?.id, time: this.pendingSeek });
    this.emit();
  }

  seek(time: number): void {
    const song = this.currentSong();
    const duration = song?.duration ?? time;
    const t = Math.max(0, Math.min(time, duration));
    this.pendingSeek = t;
    const deck = this.decks[this.primary];
    if (deck.isLoaded) {
      deck.seek(t);
      this.emit();
    }
  }

  async next(): Promise<void> {
    if (!this.gig) return;
    const index = nextUnskippedSongIndex(this.gig.setlist, this.currentIndex);
    if (index === -1) return;
    this.stopImmediate();
    await this.selectIndex(index);
  }

  async previous(): Promise<void> {
    if (!this.gig) return;
    const from = this.currentIndex < 0 ? 0 : this.currentIndex;
    const index = previousSongIndex(this.gig.setlist, from);
    if (index === -1) return;
    this.stopImmediate();
    await this.selectIndex(index);
  }

  tick(): PlaybackSnapshot {
    this.engine.poll();
    this.pauseForSerbest();
    this.emit();
    return this.getSnapshot();
  }

  private pauseForSerbest(): void {
    if (this.state !== PlaybackState.Playing && this.state !== PlaybackState.Transitioning) return;
    if (!this.decks[this.primary].isPlaying) return;
    const entry = this.currentSongEntry();
    const song = this.currentSong();
    if (!entry || !song || entryPlayMode(entry, song.info) === PlayMode.View) return;
    const section = sectionAt(song.sections, this.decks[this.primary].getPosition());
    if (!section || !sectionNamed(section, "SERBEST")) return;
    this.pause();
    this.seek(section.start);
    this.logger.playback("serbest_hold", { songId: song.id, sectionStart: section.start });
  }

  private bindDeck(id: DeckIdType): void {
    const deck = this.decks[id];
    this.unsubs.push(
      deck.on("click_eof", () => this.handleClickEof(id)),
      deck.on("longest_eof", () => this.handleLongestEof(id)),
      deck.on("error", (info) => this.fail(info?.message ?? "Playback error."))
    );
  }

  private handleClickEof(id: DeckIdType): void {
    const song = this.decks[id].loadedSongId;
    this.logger.playback("click_eof", { songId: song, deck: id });
    if (this.beginSilentSerbestNext(id)) return;
    if (this.beginPlayNext(id)) return;
    if (this.chainEnabled && this.nextPlayableIndex() >= 0) this.emitEndedToNext(id, song);
  }

  private handleLongestEof(id: DeckIdType): void {
    const songId = this.decks[id].loadedSongId;
    this.logger.playback("longest_eof", { songId, deck: id });

    if (this.outgoing === id) {
      this.decks[id].unload();
      this.outgoing = null;
      this.logger.playback("deck_released", { deck: id, songId });
      this.state = this.decks[this.primary].isPlaying
        ? PlaybackState.Playing
        : PlaybackState.Ready;
      if (this.state === PlaybackState.Playing) {
        void this.preloadAndMaybeSchedule().then(() => this.emit());
      }
      this.emit();
      return;
    }

    if (id === this.primary && this.beginPlayNext(id)) return;
    this.emitEndedToNext(id, songId);
  }

  private emitEndedToNext(fromDeck: DeckIdType, songId: string | null): void {
    if (fromDeck !== this.primary) return;
    if (this.state !== PlaybackState.Playing && this.state !== PlaybackState.Transitioning) return;
    this.state = PlaybackState.Stopping;
    this.decks[fromDeck].stop();
    this.state = PlaybackState.Ready;
    const next = this.gig ? nextUnskippedSongIndex(this.gig.setlist, this.currentIndex) : -1;
    const nextEntry = next >= 0 ? this.gig?.setlist[next] : undefined;
    this.endedToEntryId = nextEntry && isSongEntry(nextEntry) ? nextEntry.entryId : null;
    this.logger.playback("song_ended", { songId });
    this.emit();
    this.endedToEntryId = null;
  }

  private beginPlayNext(fromDeck: DeckIdType): boolean {
    if (!this.chainEnabled) return false;
    if (fromDeck !== this.primary) return false;
    if (this.currentFinishMode() !== FinishMode.PlayNext) return false;

    const nextIndex = this.nextPlayableIndex();
    const nextEntry = nextIndex >= 0 ? this.gig?.setlist[nextIndex] : undefined;
    if (!nextEntry || !isSongEntry(nextEntry)) return false;

    const nextDeck = this.decks[otherDeck(fromDeck)];
    if (!nextDeck.isLoaded || nextDeck.loadedSongId !== nextEntry.songId) {
      if (this.playNextInFlight) return true;
      this.playNextInFlight = true;
      void this.loadAndBeginPlayNext(fromDeck, nextIndex, nextEntry);
      return true;
    }

    this.startNextDeck(fromDeck, nextIndex, nextEntry, nextDeck);
    return true;
  }

  private beginSilentSerbestNext(fromDeck: DeckIdType): boolean {
    if (!this.chainEnabled || fromDeck !== this.primary || !this.gig) return false;
    const nextIndex = this.nextPlayableIndex();
    const nextEntry = nextIndex >= 0 ? this.gig.setlist[nextIndex] : undefined;
    if (!nextEntry || !isSongEntry(nextEntry)) return false;
    const nextSong = this.songs.get(nextEntry.songId);
    if (
      entryPlayMode(nextEntry, nextSong?.info) === PlayMode.View ||
      !firstSectionNamed(nextSong?.sections, "SERBEST")
    ) {
      return false;
    }
    const nextDeck = this.decks[otherDeck(fromDeck)];
    if (!nextDeck.isLoaded || nextDeck.loadedSongId !== nextEntry.songId) return false;

    this.outgoing = fromDeck;
    this.primary = nextDeck.id;
    this.currentIndex = nextIndex;
    this.playNextScheduled = false;
    this.pendingSeek = 0;
    this.state = PlaybackState.Transitioning;
    this.logger.playback("play_next_serbest_hold", {
      fromSongId: this.decks[fromDeck].loadedSongId,
      toSongId: nextEntry.songId
    });
    this.emit();
    return true;
  }

  private async loadAndBeginPlayNext(
    fromDeck: DeckIdType,
    nextIndex: number,
    nextEntry: SongSetlistEntry
  ): Promise<void> {
    try {
      await this.preloadNext();
    } catch (err) {
      this.playNextInFlight = false;
      this.fail(this.userError(err));
      return;
    }
    this.playNextInFlight = false;
    if (!this.chainEnabled || fromDeck !== this.primary) return;
    const nextDeck = this.decks[otherDeck(fromDeck)];
    if (!nextDeck.isLoaded || nextDeck.loadedSongId !== nextEntry.songId) {
      this.logger.playback("play_next_skipped", {
        reason: "Next song is not loaded.",
        songId: nextEntry.songId
      });
      if (this.state === PlaybackState.Playing || this.state === PlaybackState.Transitioning) {
        this.state = PlaybackState.Ready;
        this.emit();
      }
      return;
    }
    this.startNextDeck(fromDeck, nextIndex, nextEntry, nextDeck);
  }

  private startNextDeck(
    fromDeck: DeckIdType,
    nextIndex: number,
    nextEntry: SongSetlistEntry,
    nextDeck: AudioDeck
  ): void {
    this.outgoing = fromDeck;
    this.primary = nextDeck.id;
    this.currentIndex = nextIndex;
    this.playNextScheduled = false;
    this.state = PlaybackState.Transitioning;
    const startAt = songChainStartAt(this.songs.get(nextEntry.songId), nextEntry);
    if (startAt > 0) nextDeck.seek(startAt);
    nextDeck.play();
    this.logger.playback("play_next", {
      fromSongId: this.decks[fromDeck].loadedSongId,
      toSongId: nextEntry.songId
    });
    const outgoingDeck = this.decks[fromDeck];
    if (!outgoingDeck.isPlaying) {
      outgoingDeck.unload();
      this.outgoing = null;
      this.state = PlaybackState.Playing;
      void this.preloadAndMaybeSchedule().then(() => this.emit());
    }
    this.emit();
  }

  private async preloadAndMaybeSchedule(): Promise<void> {
    await this.preloadNext();
    this.schedulePlayNextIfNeeded();
  }

  private async preloadNext(): Promise<void> {
    if (!this.gig) return;
    const nextIndex = this.nextPlayableIndex();
    const secondary = this.decks[otherDeck(this.primary)];
    if (nextIndex === -1) {
      if (this.outgoing !== otherDeck(this.primary)) secondary.unload();
      return;
    }
    const entry = this.gig.setlist[nextIndex];
    if (!entry || !isSongEntry(entry)) return;
    if (secondary.loadedSongId === entry.songId && secondary.isLoaded) return;

    const song = this.songs.get(entry.songId);
    if (!song) return;
    const buffers = await this.loadBuffers(song);
    await secondary.load(song, buffers);
    this.logger.playback("preloaded", { songId: song.id, deck: secondary.id });
  }

  private schedulePlayNextIfNeeded(): void {
    const finish = this.currentFinishMode();
    if (!this.chainEnabled || finish !== FinishMode.PlayNext) {
      this.playNextScheduled = false;
      return;
    }
    const next = this.nextSong();
    const secondary = this.decks[otherDeck(this.primary)];
    if (!next || secondary.loadedSongId !== next.id) {
      this.playNextScheduled = false;
      return;
    }
    this.playNextScheduled = true;
    this.logger.playback("play_next_ready", { songId: next.id });
  }

  private syncLoadedSongs(): void {
    for (const deck of Object.values(this.decks)) {
      const id = deck.loadedSongId;
      const song = id ? this.songs.get(id) : undefined;
      if (song) deck.updateSong(song);
    }
  }

  private currentSongEntry(): SongSetlistEntry | null {
    if (!this.gig || this.currentIndex < 0) return null;
    const entry = this.gig.setlist[this.currentIndex];
    return entry && isSongEntry(entry) ? entry : null;
  }

  private currentSong(): Song | null {
    const entry = this.currentSongEntry();
    if (!entry) return null;
    return this.songs.get(entry.songId) ?? null;
  }

  private nextSong(): Song | null {
    if (!this.gig) return null;
    const index = this.nextPlayableIndex();
    const entry = index >= 0 ? this.gig.setlist[index] : undefined;
    if (!entry || !isSongEntry(entry)) return null;
    return this.songs.get(entry.songId) ?? null;
  }

  private nextPlayableIndex(): number {
    if (!this.gig) return -1;
    return nextUnskippedSongIndex(this.gig.setlist, this.currentIndex);
  }

  private currentFinishMode() {
    const entry = this.currentSongEntry();
    if (!entry || !this.gig) return FinishMode.Stop;
    return effectiveFinishMode(
      entry,
      this.nextPlayableIndex() === -1,
      this.gig.setlist,
      this.currentIndex,
      this.songs
    );
  }

  private fail(message: string): void {
    this.state = PlaybackState.Error;
    this.errorMessage = message;
    this.logger.playback("error", { message });
    this.emit();
  }

  private userError(err: unknown): string {
    if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
      return err.message;
    }
    return "Song cannot play.";
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export { EMPTY_SNAPSHOT };
