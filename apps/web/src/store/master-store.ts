import { create } from "zustand";
import { createLogger } from "@dbk/logger";
import {
  decodeSongBuffers,
  Metronome,
  WebAudioEngine,
  type AudioRoutingMode
} from "@dbk/audio";
import {
  createId,
  emptyMixerBank,
  entryStartAt,
  firstSectionNamed,
  gigMixerState,
  isSongEntry,
  metronomeTempoMap,
  parseSongInfo,
  PlaybackController,
  PlaybackState,
  resolvePublishedSongId,
  sectionAfter,
  sectionAt,
  sectionNamed,
  songWithMixerStems,
  type FinishMode,
  type Gig,
  type HardwareOutput,
  type MixerBank,
  type MixerChannel,
  type MixStripState,
  type PlaybackSnapshot,
  type Song,
  type SongInfo
} from "@dbk/core";
import type { DeviceKind, LoadGigMessage, SyncMessage } from "@dbk/protocol";
import { loadLocalLibrary, saveGig, deleteGig } from "../persist/indexed-db";
import { seedGig } from "../persist/seed";
import { loadLibraryIndex, readSongFile, setLibraryFileOverride } from "../native/library";
import { practiceEntryId, practiceGig } from "../practice/gig";
import { downloadBytes, exportPracticeZip } from "../practice/export";
import {
  isPracticeAudioLoaded,
  loadPracticeAudio,
  onPracticeTime,
  pausePracticeAudio,
  playPracticeAudio,
  practiceAudioDuration,
  seekPracticeAudio,
  stopPracticeAudio
} from "../practice/playback";
import { syncPublishedLibrary } from "../practice/github-sync";
import { practiceHostFromInput, pullPracticeFromHost } from "../practice/pull";
import { loadPracticeLibrary, readPracticeFileBuffer, readPublishedGigs } from "../practice/store";
import { importPracticeFileList, importPracticeZip } from "../practice/zip";
import { loadSongMixers, saveSongMixer } from "../ui/master/song-mixer";
import { updateSongSettings } from "../ui/master/song-settings";
import { isNativeApp } from "../native/platform";
import {
  MASTER_HOST_KEY,
  connectSyncTransport,
  disconnectSyncTransport,
  refreshJoinAddress as refreshNativeJoinAddress,
  sendSyncMessage,
  subscribeSyncLink
} from "../native/sync";

export type ClientSession = "practice" | "stage";

export type MasterPage = "prep" | "mixer" | "audio" | "lyrics" | "nota" | "chords" | "drums" | "lan";
export type StageContentPage = Extract<MasterPage, "lyrics" | "nota" | "chords" | "drums">;

const AUDIO_DEVICE_KEY = "dbk-audio-device";
const AUDIO_ROUTING_KEY = "dbk-audio-routing";

function storedAudioDevice(): string {
  return typeof localStorage === "undefined" ? "default" : localStorage.getItem(AUDIO_DEVICE_KEY) || "default";
}

function storedRoutingMode(): AudioRoutingMode {
  if (typeof localStorage === "undefined") return 1;
  const value = Number(localStorage.getItem(AUDIO_ROUTING_KEY));
  return value === 2 || value === 3 ? value : 1;
}

export const STAGE_ZOOM_MIN = 0.6;
export const STAGE_ZOOM_MAX = 2;
export const STAGE_ZOOM_STEP = 0.1;

export function isStageContentPage(page: MasterPage): page is StageContentPage {
  return page === "lyrics" || page === "nota" || page === "chords" || page === "drums";
}

function clampStageZoom(value: number): number {
  return Math.min(STAGE_ZOOM_MAX, Math.max(STAGE_ZOOM_MIN, Math.round(value * 10) / 10));
}

const logger = createLogger();
const engine = new WebAudioEngine(logger);
const metronome = new Metronome((running) => engine.setExternalCueActive(running));

export function readBusLevels() {
  return engine.getBusLevels();
}

export function unlockAudio(): void {
  engine.prime();
}

let gestureUnlockInstalled = false;
if (typeof window !== "undefined" && !gestureUnlockInstalled) {
  gestureUnlockInstalled = true;
  const kick = () => engine.prime();
  window.addEventListener("pointerdown", kick, true);
  window.addEventListener("keydown", kick, true);
}

export const controller = new PlaybackController({
  engine,
  logger,
  loadBuffers: async (song) => {
    await engine.init();
    const files = useMasterStore.getState().fileIndex[song.id] ?? [];
    const withStems = songWithMixerStems(song, files);
    return decodeSongBuffers(engine.context, withStems, async (path) => {
      try {
        return await readSongFile(song.id, path);
      } catch {
        throw new Error(`Song cannot play: ${assetMessage(path)}`);
      }
    });
  }
});

function assetMessage(path: string): string {
  if (path.toLowerCase().includes("click")) return "Click track missing.";
  if (path.includes("backing")) return "Backing track missing.";
  return `${path} missing.`;
}

interface MasterState {
  ready: boolean;
  songs: Song[];
  fileIndex: Record<string, string[]>;
  gigs: Gig[];
  gigId: string | null;
  songQuery: string;
  selectedEntryId: string | null;
  previewTime: number;
  playback: PlaybackSnapshot;
  hostOk: boolean;
  deviceKind: DeviceKind;
  syncHost: string | null;
  syncConnected: boolean;
  syncHosting: boolean;
  syncPeerCount: number;
  joinAddress: string | null;
  clientSession: ClientSession;
  practiceBusy: string | null;
  libraryStatus: string | null;
  masterPage: MasterPage;
  setlistOpen: boolean;
  autoScroll: boolean;
  editOpen: boolean;
  stageZooms: Record<StageContentPage, number>;
  toggleSetlistOpen: () => void;
  toggleAutoScroll: () => void;
  toggleEditOpen: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  songMix: Record<string, MixerBank>;
  busMix: MixerBank;
  audioOutputs: HardwareOutput[];
  audioDeviceId: string;
  audioOutputChannels: number;
  audioRoutingMode: AudioRoutingMode;
  audioError: string | null;
  load: (kind?: DeviceKind, options?: { syncHost?: string }) => Promise<void>;
  reconnectSync: () => void;
  joinStage: (host: string) => void;
  leaveStage: () => void;
  selectPracticeSong: (songId: string) => void;
  reloadPracticeLibrary: () => Promise<void>;
  importPracticePackage: (file: Blob) => Promise<void>;
  importPracticeFolder: (files: Iterable<File>) => Promise<void>;
  pullPracticeLibrary: (host?: string) => Promise<void>;
  syncClientLibrary: () => Promise<void>;
  publishClientLibrary: () => Promise<void>;
  exportPracticePackage: (songIds?: string[]) => Promise<void>;
  playPractice: () => Promise<void>;
  pausePractice: () => void;
  seekPractice: (time: number) => void;
  setClientHost: (host: string) => void;
  refreshJoinAddress: () => Promise<void>;
  setMasterPage: (page: MasterPage) => void;
  setSongMixStrip: (songId: string, channel: MixerChannel, patch: Partial<MixStripState>) => void;
  setBusMixStrip: (channel: MixerChannel, patch: Partial<MixStripState>) => void;
  refreshAudioOutputs: () => Promise<void>;
  setAudioDevice: (deviceId: string) => Promise<void>;
  setAudioRoutingMode: (mode: AudioRoutingMode) => void;
  setGigId: (id: string) => Promise<void>;
  updateGig: (recipe: (gig: Gig) => Gig) => Promise<void>;
  setSongQuery: (query: string) => void;
  saveSetlist: (name: string) => Promise<void>;
  deleteCurrentSetlist: () => Promise<void>;
  selectSetlistEntry: (entryId: string) => void;
  seek: (time: number) => void;
  play: () => Promise<void>;
  playSelected: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  fadeStop: () => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  metronomePlaying: boolean;
  metronomeVolume: number;
  startMetronome: () => void;
  stopMetronome: (selectNext?: boolean) => void;
  setMetronomeVolume: (value: number) => void;
  saveSongInfo: (songId: string, info: SongInfo) => Promise<void>;
}

let tickHandle = 0;
let lastBroadcast = 0;

function sendSync(message: SyncMessage) {
  sendSyncMessage(message);
}

function loadGigMessage(state: MasterState): LoadGigMessage | null {
  const gig = state.gigs.find((item) => item.id === state.gigId);
  if (!gig) return null;
  return {
    type: "LoadGig",
    gigId: gig.id,
    name: gig.name,
    setlistEntryIds: gig.setlist.map((entry) => entry.entryId),
    setlist: gig.setlist
  };
}

function broadcastShow() {
  const message = loadGigMessage(useMasterStore.getState());
  if (message) sendSync(message);
}

function broadcastSelection() {
  const state = useMasterStore.getState();
  const gig = state.gigs.find((item) => item.id === state.gigId);
  const entry = state.selectedEntryId
    ? gig?.setlist.find((item) => item.entryId === state.selectedEntryId)
    : undefined;
  if (!entry || !isSongEntry(entry)) return;
  const song = state.songs.find((item) => item.id === entry.songId);
  sendSync({
    type: "LoadSong",
    songId: entry.songId,
    setlistEntryId: entry.entryId,
    title: song?.title ?? entry.songId
  });
}

function broadcastPlay() {
  const state = useMasterStore.getState();
  const gig = state.gigs.find((item) => item.id === state.gigId);
  const clock = controller.getClock();
  const entryId = clock?.setlistEntryId ?? state.selectedEntryId;
  const entry = entryId ? gig?.setlist.find((item) => item.entryId === entryId) : undefined;
  if (!entry || !isSongEntry(entry)) return;
  sendSync({
    type: "Play",
    songId: clock?.songId ?? entry.songId,
    setlistEntryId: entry.entryId,
    at: clock?.time ?? state.previewTime
  });
}

function applyClientSync(message: SyncMessage, get: () => MasterState, set: (patch: Partial<MasterState>) => void) {
  stopPracticeAudio();
  if (message.type === "LoadGig") {
    const setlist = message.setlist ?? [];
    const gig: Gig = {
      id: message.gigId,
      name: message.name,
      date: "",
      musicians: [],
      setlist: setlist as Gig["setlist"]
    };
    const currentId = get().selectedEntryId;
    const stillThere = currentId ? setlist.some((entry) => entry.entryId === currentId) : false;
    set({
      gigs: [gig],
      gigId: gig.id,
      selectedEntryId: stillThere ? currentId : firstSongEntryId(gig)
    });
    return;
  }
  if (message.type === "LoadSong") {
    set({ selectedEntryId: message.setlistEntryId });
    return;
  }
  if (message.type === "Stop") {
    const previous = get().playback;
    const clock = previous.clock;
    set({
      previewTime: 0,
      playback: {
        ...previous,
        state: PlaybackState.Idle,
        clock: clock
          ? {
              songId: clock.songId,
              setlistEntryId: clock.setlistEntryId,
              time: 0,
              measure: clock.measure,
              beat: clock.beat,
              section: clock.section,
              playing: false,
              nextSongId: clock.nextSongId,
              finishMode: clock.finishMode
            }
          : null
      }
    });
    return;
  }
  if (message.type === "Seek") {
    set({ previewTime: message.time });
    return;
  }
  if (message.type === "Play") {
    const previous = get().playback;
    set({
      selectedEntryId: message.setlistEntryId,
      previewTime: message.at,
      playback: {
        ...previous,
        state: PlaybackState.Playing,
        clock: {
          songId: message.songId,
          setlistEntryId: message.setlistEntryId,
          time: message.at,
          measure: previous.clock?.measure ?? 1,
          beat: previous.clock?.beat ?? 1,
          section: previous.clock?.section,
          playing: true,
          nextSongId: previous.clock?.nextSongId,
          finishMode: previous.clock?.finishMode
        }
      }
    });
    return;
  }
  if (message.type !== "Position") return;
  set({
    selectedEntryId: message.setlistEntryId,
    previewTime: message.time,
    playback: {
      state: message.playing ? PlaybackState.Playing : PlaybackState.Idle,
      clock: {
        songId: message.songId,
        setlistEntryId: message.setlistEntryId,
        time: message.time,
        measure: message.measure,
        beat: message.beat,
        section: message.section,
        playing: message.playing,
        nextSongId: message.nextSongId,
        finishMode: message.finishMode as FinishMode | undefined
      },
      currentIndex: -1,
      errorMessage: null,
      primaryDeck: get().playback.primaryDeck,
      outgoingDeck: null,
      preloadedSongId: null,
      endedToEntryId: null
    }
  });
}

let unsubSyncLink: (() => void) | null = null;

function connectSync(get: () => MasterState, set: (patch: Partial<MasterState>) => void) {
  if (!unsubSyncLink) {
    unsubSyncLink = subscribeSyncLink((link) => {
      set({
        syncConnected: link.connected,
        syncHosting: link.hosting,
        syncPeerCount: link.peerCount,
        ...(link.endpoint ? { joinAddress: link.endpoint } : {})
      });
    });
  }
  void connectSyncTransport({
    deviceKind: () => get().deviceKind,
    syncHost: get().syncHost,
    onMasterOpen: () => {
      broadcastShow();
      broadcastSelection();
    },
    onClientHello: () => {
      broadcastShow();
      broadcastSelection();
    },
    onClientSync: (message) => applyClientSync(message, get, set)
  }).then((address) => {
    if (address) set({ joinAddress: address });
  });
}

function broadcastClock(snapshot: PlaybackSnapshot, force = false) {
  if (useMasterStore.getState().deviceKind !== "master") return;
  const clock = snapshot.clock;
  if (!clock) return;
  const now = performance.now();
  if (!force && now - lastBroadcast < 80 && snapshot.state !== PlaybackState.Transitioning) return;
  lastBroadcast = now;
  sendSync({
    type: "Position",
    songId: clock.songId,
    setlistEntryId: clock.setlistEntryId,
    time: clock.time,
    measure: clock.measure,
    beat: clock.beat,
    section: clock.section,
    playing: clock.playing,
    nextSongId: clock.nextSongId,
    finishMode: clock.finishMode
  });
}

function startTick() {
  cancelAnimationFrame(tickHandle);
  const loop = () => {
    const snap = controller.tick();
    broadcastClock(snap);
    if (snap.state === PlaybackState.Playing || snap.state === PlaybackState.Transitioning) {
      tickHandle = requestAnimationFrame(loop);
    }
  };
  tickHandle = requestAnimationFrame(loop);
}

function firstSongEntryId(gig: Gig | undefined): string | null {
  return gig?.setlist.find(isSongEntry)?.entryId ?? null;
}

async function practiceFileOverride(songId: string, relPath: string): Promise<ArrayBuffer | null> {
  const song = useMasterStore.getState().songs.find((item) => item.id === songId);
  return (
    (await readPracticeFileBuffer(song?.folder ?? songId, relPath)) ??
    (await readPracticeFileBuffer(songId, relPath))
  );
}

function practiceClock(
  entry: { entryId: string; songId: string },
  time: number,
  playing: boolean
): NonNullable<PlaybackSnapshot["clock"]> {
  return {
    songId: entry.songId,
    setlistEntryId: entry.entryId,
    time,
    measure: 1,
    beat: 1,
    playing
  };
}

function remapPublishedGigs(gigs: Gig[], songs: Song[]): Gig[] {
  return gigs.map((gig) => ({
    ...gig,
    setlist: gig.setlist.map((entry) => {
      if (!isSongEntry(entry)) return entry;
      const songId = resolvePublishedSongId(entry.songId, songs) ?? entry.songId;
      return { ...entry, songId };
    })
  }));
}

function applyClientLibrary(
  songs: Song[],
  fileIndex: Record<string, string[]>,
  publishedGigs: Gig[] = [],
  keepSongId?: string | null
): Pick<MasterState, "songs" | "fileIndex" | "gigs" | "gigId" | "selectedEntryId" | "previewTime" | "hostOk"> {
  const remapped = remapPublishedGigs(publishedGigs, songs);
  const usable = remapped.filter((gig) =>
    gig.setlist.some((entry) => isSongEntry(entry) && songs.some((song) => song.id === entry.songId))
  );
  const gig = usable[0] ?? practiceGig(songs);
  const gigs = usable.length ? usable : gig.setlist.length ? [gig] : [];
  const keep =
    keepSongId && songs.some((song) => song.id === keepSongId)
      ? keepSongId
      : gig.setlist.find((entry) => isSongEntry(entry) && songs.some((song) => song.id === entry.songId))
          ?.songId ?? songs[0]?.id;
  const selected =
    gig.setlist.find((entry) => isSongEntry(entry) && entry.songId === keep)?.entryId ?? firstSongEntryId(gig);
  return {
    songs,
    fileIndex,
    gigs,
    gigId: gigs[0]?.id ?? null,
    selectedEntryId: selected,
    previewTime: 0,
    hostOk: true
  };
}

function startAtOf(gig: Gig | undefined, entryId: string | null, songs: Song[] = []): number {
  if (!gig || !entryId) return 0;
  const entry = gig.setlist.find((item) => item.entryId === entryId);
  if (!entry || !isSongEntry(entry)) return 0;
  const song = songs.find((item) => item.id === entry.songId);
  if (firstSectionNamed(song?.sections, "SERBEST")) return 0;
  return entryStartAt(entry);
}

function nextUnskippedSongEntryId(gig: Gig | undefined, currentId: string | null): string | null {
  if (!gig || !currentId) return null;
  const songs = gig.setlist.filter(isSongEntry);
  const from = songs.findIndex((entry) => entry.entryId === currentId);
  if (from < 0) return null;
  for (let i = from + 1; i < songs.length; i++) {
    const entry = songs[i];
    if (entry && !entry.skipped) return entry.entryId;
  }
  return null;
}

const MIX_SAVE_MS = 350;
const songMixSaveTimers = new Map<string, number>();
let gigMixSaveTimer = 0;
let gigMixSaveGigId: string | null = null;
let fadeStopTimer = 0;

function cancelFadeStop(): void {
  if (fadeStopTimer) window.clearTimeout(fadeStopTimer);
  fadeStopTimer = 0;
  engine.resetFadeOut();
  metronome.resetFadeOut();
}

function applyGigMix(gig: Gig | undefined, set: (patch: Partial<MasterState>) => void) {
  const { busMix, metronomeVolume } = gigMixerState(gig);
  engine.replaceBusMix(busMix);
  metronome.setVolume(metronomeVolume);
  set({ busMix, metronomeVolume });
}

function persistGigMixNow(
  get: () => MasterState,
  set: (patch: Partial<MasterState>) => void,
  gigId: string
) {
  const state = get();
  if (state.deviceKind === "client") return;
  const current = state.gigs.find((item) => item.id === gigId);
  if (!current) return;
  const next: Gig = { ...current, busMix: state.busMix, metronomeVolume: state.metronomeVolume };
  void saveGig(next);
  set({ gigs: get().gigs.map((item) => (item.id === next.id ? next : item)) });
}

function scheduleGigMixSave(get: () => MasterState, set: (patch: Partial<MasterState>) => void) {
  const gigId = get().gigId;
  if (!gigId || get().deviceKind === "client") return;
  window.clearTimeout(gigMixSaveTimer);
  gigMixSaveGigId = gigId;
  gigMixSaveTimer = window.setTimeout(() => {
    if (gigMixSaveGigId) persistGigMixNow(get, set, gigMixSaveGigId);
  }, MIX_SAVE_MS);
}

function flushGigMixSave(get: () => MasterState, set: (patch: Partial<MasterState>) => void) {
  window.clearTimeout(gigMixSaveTimer);
  gigMixSaveTimer = 0;
  const gigId = gigMixSaveGigId ?? get().gigId;
  gigMixSaveGigId = null;
  if (gigId) persistGigMixNow(get, set, gigId);
}

function scheduleSongMixSave(songId: string, get: () => MasterState) {
  if (get().deviceKind === "client") return;
  const prev = songMixSaveTimers.get(songId);
  if (prev) window.clearTimeout(prev);
  songMixSaveTimers.set(
    songId,
    window.setTimeout(() => {
      songMixSaveTimers.delete(songId);
      const bank = get().songMix[songId];
      if (bank) void saveSongMixer(songId, bank);
    }, MIX_SAVE_MS)
  );
}

export const useMasterStore = create<MasterState>((set, get) => {
  const endMetronome = (selectNext: boolean) => {
    const wasPlaying = get().metronomePlaying;
    metronome.stop();
    const nextId =
      selectNext && wasPlaying
        ? nextUnskippedSongEntryId(
            get().gigs.find((item) => item.id === get().gigId),
            get().selectedEntryId
          )
        : null;
    set({ metronomePlaying: false });
    if (nextId) get().selectSetlistEntry(nextId);
  };

  controller.subscribe((playback) => {
    if (get()?.deviceKind === "client") return;
    const playing =
      playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
    const entryId = playback.clock?.setlistEntryId;
    if (playback.endedToEntryId && get().selectedEntryId !== playback.endedToEntryId) {
      set({ playback });
      get().selectSetlistEntry(playback.endedToEntryId);
    } else if (playing && entryId && get().selectedEntryId !== entryId) {
      set({ playback, selectedEntryId: entryId, previewTime: playback.clock?.time ?? 0 });
    } else {
      set({
        playback,
        ...(!playing && playback.clock ? { previewTime: playback.clock.time } : {})
      });
    }
    if (playing) startTick();
  });

  return {
    ready: false,
    songs: [],
    fileIndex: {},
    gigs: [],
    gigId: null,
    songQuery: "",
    selectedEntryId: null,
    previewTime: 0,
    playback: controller.getSnapshot(),
    hostOk: false,
    deviceKind: "master",
    syncHost: null,
    syncConnected: false,
    syncHosting: false,
    syncPeerCount: 0,
    joinAddress: null,
    clientSession: "practice",
    practiceBusy: null,
    libraryStatus: null,
    masterPage: "prep",
    setlistOpen: true,
    autoScroll: true,
    editOpen: false,
    stageZooms: {
      lyrics: 1,
      nota: 1,
      chords: 1,
      drums: 1
    },
    songMix: {},
    busMix: emptyMixerBank(),
    audioOutputs: [],
    audioDeviceId: storedAudioDevice(),
    audioOutputChannels: 2,
    audioRoutingMode: storedRoutingMode(),
    audioError: null,
    metronomePlaying: false,
    metronomeVolume: 0.7,

    load: async (kind = "master", options) => {
      set({ deviceKind: kind, syncHost: options?.syncHost?.trim() || null });
      if (kind === "master") connectSync(get, set);
      let songs: Song[] = [];
      let fileIndex: Record<string, string[]> = {};
      let hostOk = false;
      try {
        if (kind === "client") {
          setLibraryFileOverride(practiceFileOverride);
          const practice = await loadPracticeLibrary();
          if (practice.songs.length > 0) {
            songs = practice.songs;
            fileIndex = practice.fileIndex;
            hostOk = true;
          } else if (isNativeApp()) {
            const index = await loadLibraryIndex();
            songs = index.songs;
            fileIndex = index.fileIndex;
            hostOk = songs.length > 0;
          } else {
            hostOk = true;
          }
          if (songs.length === 0 && !isNativeApp()) {
            set({ practiceBusy: "Updating library…" });
            try {
              await syncPublishedLibrary();
              const again = await loadPracticeLibrary();
              songs = again.songs;
              fileIndex = again.fileIndex;
              hostOk = true;
            } catch {
              hostOk = true;
            } finally {
              set({ practiceBusy: null });
            }
          }
        } else {
          const index = await loadLibraryIndex();
          songs = index.songs;
          fileIndex = index.fileIndex;
          hostOk = songs.length > 0 || !isNativeApp();
        }
      } catch {
        hostOk = kind === "client";
      }
      const songMix = kind === "master" ? await loadSongMixers(songs.map((song) => song.id)) : {};
      for (const [songId, bank] of Object.entries(songMix)) {
        engine.replaceSongMix(songId, bank);
      }
      if (kind === "client") {
        const published = await readPublishedGigs();
        const selected = options?.syncHost ? null : songs[0]?.id;
        const next = applyClientLibrary(songs, fileIndex, published, selected);
        set({
          ready: true,
          ...next,
          hostOk,
          masterPage: "lyrics",
          clientSession: "practice",
          setlistOpen: true,
          songMix
        });
        const songId = next.gigs[0]?.setlist.find(isSongEntry)?.songId;
        if (songId) void loadPracticeAudio(songId, fileIndex[songId] ?? []);
        void get().syncClientLibrary();
        return;
      }
      const local = await loadLocalLibrary();
      const gigId = local.gigs[0]?.id ?? seedGig().id;
      const gig = local.gigs.find((item) => item.id === gigId) ?? local.gigs[0];
      if (gig) await controller.setShow(gig, songs);
      const showMix = gigMixerState(gig);
      engine.replaceBusMix(showMix.busMix);
      metronome.setVolume(showMix.metronomeVolume);
      set({
        ready: true,
        songs,
        fileIndex,
        gigs: local.gigs,
        gigId,
        hostOk,
        selectedEntryId: firstSongEntryId(gig),
        previewTime: startAtOf(gig, firstSongEntryId(gig), songs),
        songMix,
        busMix: showMix.busMix,
        metronomeVolume: showMix.metronomeVolume
      });
      if (kind === "master") await get().setAudioDevice(get().audioDeviceId);
      broadcastShow();
    },

    reconnectSync: () => {
      if (get().deviceKind === "client" && get().clientSession !== "stage") return;
      connectSync(get, set);
    },

    joinStage: (host) => {
      const value = host.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!value) return;
      stopPracticeAudio();
      localStorage.setItem(MASTER_HOST_KEY, value);
      set({ syncHost: value, clientSession: "stage", setlistOpen: true, masterPage: "lyrics" });
      connectSync(get, set);
    },

    leaveStage: () => {
      disconnectSyncTransport();
      stopPracticeAudio();
      const { songs, fileIndex, selectedEntryId, gigs } = get();
      const current = selectedEntryId
        ? gigs.find((gig) => gig.setlist.some((item) => item.entryId === selectedEntryId))
            ?.setlist.find((item) => item.entryId === selectedEntryId)
        : undefined;
      const keep = current && isSongEntry(current) ? current.songId : songs[0]?.id;
      set({
        syncHost: null,
        clientSession: "practice",
        setlistOpen: true,
        syncConnected: false
      });
      void readPublishedGigs().then((published) => {
        set(applyClientLibrary(get().songs, get().fileIndex, published, keep));
      });
    },

    selectPracticeSong: (songId) => {
      if (get().clientSession === "stage") return;
      const gig = currentGig(get()) ?? get().gigs[0];
      const entry = gig?.setlist.find((item) => isSongEntry(item) && item.songId === songId);
      set({
        selectedEntryId: entry?.entryId ?? practiceEntryId(songId),
        previewTime: 0
      });
      void loadPracticeAudio(songId, get().fileIndex[songId] ?? []);
    },

    reloadPracticeLibrary: async () => {
      const index = await loadPracticeLibrary();
      const published = await readPublishedGigs();
      const current = (currentGig(get()) ?? get().gigs[0])?.setlist.find(isSongEntry)?.songId;
      const next = applyClientLibrary(index.songs, index.fileIndex, published, current);
      set(next);
      const songId = next.gigs.find((gig) => gig.id === next.gigId)?.setlist.find(isSongEntry)?.songId;
      if (songId) void loadPracticeAudio(songId, index.fileIndex[songId] ?? []);
    },

    importPracticePackage: async (file) => {
      set({ practiceBusy: "Importing…" });
      try {
        await importPracticeZip(file);
        await get().reloadPracticeLibrary();
      } finally {
        set({ practiceBusy: null });
      }
    },

    importPracticeFolder: async (files) => {
      set({ practiceBusy: "Importing…" });
      try {
        await importPracticeFileList(files);
        await get().reloadPracticeLibrary();
      } finally {
        set({ practiceBusy: null });
      }
    },

    pullPracticeLibrary: async (host) => {
      set({ practiceBusy: "Updating from master…" });
      try {
        const raw = host?.trim() || get().syncHost || "";
        const base = raw ? practiceHostFromInput(raw) : window.location.origin;
        await pullPracticeFromHost(base);
        await get().reloadPracticeLibrary();
      } finally {
        set({ practiceBusy: null });
      }
    },

    syncClientLibrary: async () => {
      if (get().clientSession === "stage") return;
      set({ practiceBusy: "Updating library…" });
      try {
        const result = await syncPublishedLibrary();
        await get().reloadPracticeLibrary();
        set({
          libraryStatus:
            result.files > 0
              ? `Updated ${result.files} files.`
              : result.gigs === 0 && result.songs === 0
                ? "No published library yet."
                : "Library up to date."
        });
      } catch (error) {
        set({
          libraryStatus: error instanceof Error ? error.message : "Could not update library."
        });
      } finally {
        set({ practiceBusy: null });
      }
    },

    publishClientLibrary: async () => {
      if (get().deviceKind === "client") return;
      set({ practiceBusy: "Publishing…" });
      try {
        const response = await fetch("/client-library/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ gigs: get().gigs })
        });
        if (!response.ok) {
          throw new Error("Publish from the Mac with npm run dev, then push main.");
        }
        const result = (await response.json()) as { songs?: number; files?: number };
        set({
          libraryStatus: `Published ${result.songs ?? 0} songs. Push main so phones update.`
        });
      } catch (error) {
        set({
          libraryStatus: error instanceof Error ? error.message : "Could not publish."
        });
      } finally {
        set({ practiceBusy: null });
      }
    },

    exportPracticePackage: async (songIds) => {
      if (get().deviceKind === "client") return;
      set({ practiceBusy: "Exporting…" });
      try {
        const pack = await exportPracticeZip(get().songs, get().fileIndex, songIds);
        downloadBytes(pack.name, pack.bytes);
      } finally {
        set({ practiceBusy: null });
      }
    },

    playPractice: async () => {
      const state = get();
      const entry = state.selectedEntryId
        ? currentGig(state)?.setlist.find((item) => item.entryId === state.selectedEntryId)
        : undefined;
      if (!entry || !isSongEntry(entry)) return;
      onPracticeTime((time, ended) => {
        const current = useMasterStore.getState();
        const duration = practiceAudioDuration();
        useMasterStore.setState({
          previewTime: time,
          songs:
            duration > 0
              ? current.songs.map((song) =>
                  song.id === entry.songId && !(song.duration > 0) ? { ...song, duration } : song
                )
              : current.songs,
          playback: {
            ...current.playback,
            state: ended ? PlaybackState.Idle : PlaybackState.Playing,
            clock: practiceClock(entry, time, !ended)
          }
        });
      });
      const song = state.songs.find((item) => item.id === entry.songId);
      const files = [
        ...(state.fileIndex[entry.songId] ?? []),
        ...(song?.folder ? (state.fileIndex[song.folder] ?? []) : [])
      ];
      if (!isPracticeAudioLoaded(entry.songId)) {
        const ok = await loadPracticeAudio(entry.songId, files);
        if (!ok) return;
      }
      seekPracticeAudio(state.previewTime);
      try {
        await playPracticeAudio();
      } catch {
        const ok = await loadPracticeAudio(entry.songId, files);
        if (!ok) return;
        try {
          await playPracticeAudio();
        } catch {
          return;
        }
      }
      const duration = practiceAudioDuration();
      set({
        songs:
          duration > 0
            ? get().songs.map((song) =>
                song.id === entry.songId && !(song.duration > 0) ? { ...song, duration } : song
              )
            : get().songs,
        playback: {
          ...get().playback,
          state: PlaybackState.Playing,
          clock: practiceClock(entry, get().previewTime, true)
        }
      });
    },

    pausePractice: () => {
      pausePracticeAudio();
      const entry = get().selectedEntryId
        ? currentGig(get())?.setlist.find((item) => item.entryId === get().selectedEntryId)
        : undefined;
      set({
        playback: {
          ...get().playback,
          state: PlaybackState.Idle,
          clock:
            entry && isSongEntry(entry)
              ? practiceClock(entry, get().previewTime, false)
              : get().playback.clock
        }
      });
    },

    seekPractice: (time) => {
      seekPracticeAudio(time);
      const entry = get().selectedEntryId
        ? currentGig(get())?.setlist.find((item) => item.entryId === get().selectedEntryId)
        : undefined;
      const playing = get().playback.state === PlaybackState.Playing;
      set({
        previewTime: time,
        playback:
          entry && isSongEntry(entry)
            ? { ...get().playback, clock: practiceClock(entry, time, playing) }
            : get().playback
      });
    },

    setClientHost: (host) => {
      get().joinStage(host);
    },

    refreshJoinAddress: async () => {
      const address = await refreshNativeJoinAddress();
      if (address) set({ joinAddress: address });
    },

    setMasterPage: (page) => set({ masterPage: page }),
    refreshAudioOutputs: async () => {
      try {
        const outputs = await engine.listOutputs();
        const routing = engine.getRoutingState();
        set({
          audioOutputs: outputs,
          audioOutputChannels: routing.channels,
          audioError: null
        });
      } catch (error) {
        set({ audioError: error instanceof Error ? error.message : String(error) });
      }
    },
    setAudioDevice: async (deviceId) => {
      if (get().deviceKind === "client") return;
      controller.stopImmediate();
      metronome.stop();
      set({ metronomePlaying: false, audioError: null });
      try {
        const selected = await engine.selectOutput(deviceId);
        const requestedMode = get().audioRoutingMode;
        let mode = selected.routingMode;
        if (requestedMode !== mode) {
          try {
            engine.setRoutingMode(requestedMode);
            mode = requestedMode;
          } catch {
            // Keep mode 1 if the selected device has too few outputs.
          }
        }
        localStorage.setItem(AUDIO_DEVICE_KEY, deviceId);
        localStorage.setItem(AUDIO_ROUTING_KEY, String(mode));
        const outputs = await engine.listOutputs();
        set({
          audioOutputs: outputs,
          audioDeviceId: deviceId,
          audioOutputChannels: selected.channels,
          audioRoutingMode: mode,
          audioError: null
        });
      } catch (error) {
        set({ audioError: error instanceof Error ? error.message : String(error) });
      }
    },
    setAudioRoutingMode: (mode) => {
      if (get().deviceKind === "client") return;
      controller.stopImmediate();
      metronome.stop();
      set({ metronomePlaying: false, audioError: null });
      try {
        engine.setRoutingMode(mode);
        localStorage.setItem(AUDIO_ROUTING_KEY, String(mode));
        set({ audioRoutingMode: mode });
      } catch (error) {
        set({ audioError: error instanceof Error ? error.message : String(error) });
      }
    },
    toggleSetlistOpen: () => set((state) => ({ setlistOpen: !state.setlistOpen })),
    toggleAutoScroll: () => set((state) => ({ autoScroll: !state.autoScroll })),
    toggleEditOpen: () => set((state) => ({ editOpen: !state.editOpen })),
    zoomOut: () =>
      set((state) => {
        if (!isStageContentPage(state.masterPage)) return {};
        const page = state.masterPage;
        return {
          stageZooms: {
            ...state.stageZooms,
            [page]: clampStageZoom(state.stageZooms[page] - STAGE_ZOOM_STEP)
          }
        };
      }),
    zoomIn: () =>
      set((state) => {
        if (!isStageContentPage(state.masterPage)) return {};
        const page = state.masterPage;
        return {
          stageZooms: {
            ...state.stageZooms,
            [page]: clampStageZoom(state.stageZooms[page] + STAGE_ZOOM_STEP)
          }
        };
      }),

    setSongMixStrip: (songId, channel, patch) => {
      const bank = engine.setSongStrip(songId, channel, patch);
      set({ songMix: { ...get().songMix, [songId]: bank } });
      scheduleSongMixSave(songId, get);
    },

    setBusMixStrip: (channel, patch) => {
      const busMix = engine.setBusStrip(channel, patch);
      set({ busMix });
      scheduleGigMixSave(get, set);
    },

    setGigId: async (id) => {
      if (get().deviceKind === "client") return;
      if (get().gigId === id) return;
      flushGigMixSave(get, set);
      const gig = get().gigs.find((item) => item.id === id);
      if (!gig) return;
      await controller.setShow(gig, get().songs);
      applyGigMix(gig, set);
      set({ gigId: id, selectedEntryId: firstSongEntryId(gig), previewTime: startAtOf(gig, firstSongEntryId(gig), get().songs) });
      broadcastShow();
      broadcastSelection();
    },

    updateGig: async (recipe) => {
      if (get().deviceKind === "client") return;
      const { gigs, gigId, songs, selectedEntryId } = get();
      const current = gigs.find((item) => item.id === gigId);
      if (!current) return;
      const next = recipe(current);
      await saveGig(next);
      const nextGigs = gigs.map((item) => (item.id === next.id ? next : item));
      const sameOrder =
        current.setlist.length === next.setlist.length &&
        current.setlist.every((entry, index) => entry.entryId === next.setlist[index]?.entryId);
      if (sameOrder) {
        controller.replaceShow(next);
      } else {
        await controller.setShow(next, songs);
      }
      const stillThere = selectedEntryId
        ? next.setlist.some((entry) => entry.entryId === selectedEntryId)
        : false;
      set({
        gigs: nextGigs,
        selectedEntryId: stillThere ? selectedEntryId : firstSongEntryId(next),
        previewTime: stillThere ? get().previewTime : startAtOf(next, firstSongEntryId(next), get().songs)
      });
      broadcastShow();
    },

    setSongQuery: (songQuery) => set({ songQuery }),

    saveSetlist: async (name) => {
      if (get().deviceKind === "client") return;
      const trimmed = name.trim();
      if (!trimmed) return;
      flushGigMixSave(get, set);
      const { gigs, gigId, songs, busMix, metronomeVolume } = get();
      const current = gigs.find((item) => item.id === gigId);
      const sameName = gigs.find((item) => item.name.toLowerCase() === trimmed.toLowerCase());

      if (current && current.name.toLowerCase() === trimmed.toLowerCase()) {
        const next = { ...current, name: trimmed, busMix, metronomeVolume };
        await saveGig(next);
        set({ gigs: gigs.map((item) => (item.id === next.id ? next : item)) });
        broadcastShow();
        return;
      }

      if (sameName) {
        const next = {
          ...sameName,
          name: trimmed,
          setlist: current?.setlist ?? sameName.setlist,
          notes: current?.notes ?? sameName.notes,
          busMix,
          metronomeVolume
        };
        await saveGig(next);
        await controller.setShow(next, songs);
        applyGigMix(next, set);
        set({
          gigs: gigs.map((item) => (item.id === next.id ? next : item)),
          gigId: next.id,
          selectedEntryId: firstSongEntryId(next),
          previewTime: startAtOf(next, firstSongEntryId(next), songs)
        });
        broadcastShow();
        broadcastSelection();
        return;
      }

      const gig: Gig = {
        id: createId("gig"),
        name: trimmed,
        date: new Date().toISOString().slice(0, 10),
        musicians: current?.musicians ?? [],
        setlist: current?.setlist ?? [],
        notes: current?.notes,
        busMix,
        metronomeVolume
      };
      await saveGig(gig);
      await controller.setShow(gig, songs);
      set({ gigs: [...gigs, gig], gigId: gig.id, selectedEntryId: firstSongEntryId(gig), previewTime: startAtOf(gig, firstSongEntryId(gig), songs) });
      broadcastShow();
      broadcastSelection();
    },

    deleteCurrentSetlist: async () => {
      if (get().deviceKind === "client") return;
      window.clearTimeout(gigMixSaveTimer);
      gigMixSaveTimer = 0;
      gigMixSaveGigId = null;
      const { gigs, gigId, songs } = get();
      if (!gigId) return;
      await deleteGig(gigId);
      const remaining = gigs.filter((item) => item.id !== gigId);
      const next = remaining[0];
      if (next) {
        await controller.setShow(next, songs);
        applyGigMix(next, set);
        set({ gigs: remaining, gigId: next.id, selectedEntryId: firstSongEntryId(next), previewTime: startAtOf(next, firstSongEntryId(next), songs) });
        broadcastShow();
        broadcastSelection();
        return;
      }
      const empty: Gig = {
        id: createId("gig"),
        name: "Untitled",
        date: new Date().toISOString().slice(0, 10),
        musicians: [],
        setlist: []
      };
      await saveGig(empty);
      await controller.setShow(empty, songs);
      applyGigMix(empty, set);
      set({ gigs: [empty], gigId: empty.id, selectedEntryId: null, previewTime: 0 });
      broadcastShow();
    },

    selectSetlistEntry: (entryId) => {
      if (get().deviceKind === "client") {
        const gig = currentGig(get());
        const entry = gig?.setlist.find((item) => item.entryId === entryId);
        set({ selectedEntryId: entryId, previewTime: startAtOf(gig, entryId, get().songs) });
        if (get().clientSession === "practice" && entry && isSongEntry(entry)) {
          const song = get().songs.find((item) => item.id === entry.songId);
          const files = [
            ...(get().fileIndex[entry.songId] ?? []),
            ...(song?.folder ? (get().fileIndex[song.folder] ?? []) : [])
          ];
          void loadPracticeAudio(entry.songId, files);
        }
        return;
      }
      cancelFadeStop();
      const currentId = get().selectedEntryId;
      if (currentId === entryId) {
        set({ selectedEntryId: entryId });
        return;
      }
      const playback = get().playback;
      const playing =
        playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
      if (playing && playback.clock?.setlistEntryId === entryId) {
        set({ selectedEntryId: entryId, previewTime: playback.clock.time });
        broadcastSelection();
        return;
      }
      if (playing) controller.stopImmediate();
      if (get().metronomePlaying) metronome.stop();
      const gig = get().gigs.find((item) => item.id === get().gigId);
      set({ selectedEntryId: entryId, previewTime: startAtOf(gig, entryId, get().songs), metronomePlaying: false });
      broadcastSelection();
    },

    seek: (time) => {
      if (get().deviceKind === "client") {
        if (get().clientSession === "practice") get().seekPractice(time);
        return;
      }
      const { selectedEntryId, gigs, gigId, songs } = get();
      const gig = gigs.find((item) => item.id === gigId);
      const entry = selectedEntryId
        ? gig?.setlist.find((item) => item.entryId === selectedEntryId)
        : undefined;
      const song =
        entry && isSongEntry(entry) ? songs.find((item) => item.id === entry.songId) : undefined;
      const duration = song?.duration ?? time;
      const clamped = Math.max(0, Math.min(time, duration));
      set({ previewTime: clamped });
      const index = entry && gig ? gig.setlist.findIndex((item) => item.entryId === entry.entryId) : -1;
      if (index >= 0 && controller.getSnapshot().currentIndex === index) {
        controller.seek(clamped);
      }
      sendSync({ type: "Seek", time: clamped });
    },

    playSelected: async () => {
      if (get().deviceKind === "client") return;
      cancelFadeStop();
      engine.prime();
      get().stopMetronome();
      const { gigId, gigs, selectedEntryId } = get();
      const gig = gigs.find((item) => item.id === gigId);
      if (!gig || !selectedEntryId) return;
      const index = gig.setlist.findIndex((entry) => entry.entryId === selectedEntryId);
      const entry = gig.setlist[index];
      if (index < 0 || !entry || !isSongEntry(entry)) return;
      const snap = controller.getSnapshot();
      const sameSong =
        snap.currentIndex === index || snap.clock?.setlistEntryId === selectedEntryId;
      if (snap.state === PlaybackState.Loading) return;
      if (snap.state === PlaybackState.Playing || snap.state === PlaybackState.Transitioning) {
        if (sameSong) {
          get().pause();
          return;
        }
        controller.stopImmediate();
      }
      const song = get().songs.find((item) => item.id === entry.songId);
      let startTime = get().previewTime;
      const currentSection = sectionAt(song?.sections ?? [], startTime);
      if (sectionNamed(currentSection, "SERBEST")) {
        const following = sectionAfter(song?.sections, currentSection);
        if (following) {
          startTime = following.start;
          set({ previewTime: startTime });
        } else {
          const nextId = nextUnskippedSongEntryId(gig, selectedEntryId);
          if (!nextId) {
            get().stop();
            return;
          }
          get().selectSetlistEntry(nextId);
          const nextEntry = gig.setlist.find((item) => item.entryId === nextId);
          const nextSong =
            nextEntry && isSongEntry(nextEntry)
              ? get().songs.find((item) => item.id === nextEntry.songId)
              : undefined;
          if (!firstSectionNamed(nextSong?.sections, "SERBEST")) {
            await get().playSelected();
          }
          return;
        }
      }
      if (controller.getSnapshot().currentIndex !== index) {
        await controller.selectIndex(index);
      }
      const after = controller.getSnapshot();
      if (after.currentIndex !== index || after.state === PlaybackState.Error) return;
      if (after.state === PlaybackState.Playing || after.state === PlaybackState.Transitioning) return;
      controller.seek(startTime);
      await controller.play();
      startTick();
      broadcastPlay();
    },

    play: async () => {
      if (get().deviceKind === "client") return;
      cancelFadeStop();
      const { gigId, gigs, selectedEntryId, playback } = get();
      const gig = gigs.find((item) => item.id === gigId);
      if (!gig) return;
      let index = selectedEntryId
        ? gig.setlist.findIndex((entry) => entry.entryId === selectedEntryId)
        : -1;
      const at = gig.setlist[index];
      if (index < 0 || !at || !isSongEntry(at)) {
        index = gig.setlist.findIndex(isSongEntry);
      }
      if (index < 0) return;
      const busy =
        playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
      if (busy && playback.currentIndex !== index) {
        controller.stopImmediate();
      }
      if (controller.getSnapshot().currentIndex !== index) {
        await controller.selectIndex(index);
      }
      controller.seek(get().previewTime);
      await controller.play();
      startTick();
      broadcastPlay();
    },

    pause: () => {
      if (get().deviceKind === "client") return;
      if (get().metronomePlaying) {
        endMetronome(true);
        return;
      }
      const time = controller.getClock()?.time ?? get().previewTime;
      controller.pause();
      set({ previewTime: time });
      broadcastClock(controller.getSnapshot(), true);
    },

    stop: () => {
      if (get().deviceKind === "client") return;
      cancelFadeStop();
      metronome.stop();
      controller.stopImmediate();
      set({ previewTime: 0, metronomePlaying: false });
      sendSync({ type: "Stop" });
    },

    fadeStop: () => {
      if (get().deviceKind === "client" || fadeStopTimer) return;
      const durationSeconds = 1.5;
      engine.fadeOut(durationSeconds);
      metronome.fadeOut(durationSeconds);
      fadeStopTimer = window.setTimeout(() => {
        fadeStopTimer = 0;
        metronome.stop();
        controller.stopImmediate();
        engine.resetFadeOut();
        metronome.resetFadeOut();
        set({ previewTime: 0, metronomePlaying: false });
        sendSync({ type: "Stop" });
      }, durationSeconds * 1000);
    },
    next: async () => {
      if (get().deviceKind === "client") return;
      await controller.next();
    },
    previous: async () => {
      if (get().deviceKind === "client") return;
      await controller.previous();
    },

    startMetronome: () => {
      if (get().deviceKind === "client") return;
      cancelFadeStop();
      const { selectedEntryId, gigs, gigId, songs, metronomeVolume } = get();
      const gig = gigs.find((item) => item.id === gigId);
      const entry = selectedEntryId
        ? gig?.setlist.find((item) => item.entryId === selectedEntryId)
        : undefined;
      const song =
        entry && isSongEntry(entry) ? songs.find((item) => item.id === entry.songId) : undefined;
      if (!song) return;
      controller.stopImmediate();
      try {
        const ctx = engine.prime();
        metronome.attach(ctx, engine.busNode("CUE"));
        metronome.setVolume(metronomeVolume);
        const parsed = parseSongInfo(song.info);
        metronome.start(metronomeTempoMap(parsed), parsed.beats);
        set({ metronomePlaying: true });
      } catch (err) {
        metronome.stop();
        set({ metronomePlaying: false });
        logger.audio("metronome_start_failed", {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    },

    stopMetronome: (selectNext = false) => endMetronome(selectNext),

    setMetronomeVolume: (value) => {
      const next = Math.max(0, Math.min(1, value));
      metronome.setVolume(next);
      set({ metronomeVolume: next });
      scheduleGigMixSave(get, set);
    },

    saveSongInfo: async (songId, info) => {
      if (get().deviceKind === "client") return;
      const parsed = parseSongInfo(info);
      await updateSongSettings(songId, (settings) => ({ ...settings, view: parsed }));
      const songs = get().songs.map((song) => (song.id === songId ? { ...song, info: parsed } : song));
      set({ songs });
      const { selectedEntryId, gigs, gigId, metronomePlaying } = get();
      if (!metronomePlaying) return;
      const gig = gigs.find((item) => item.id === gigId);
      const entry = selectedEntryId
        ? gig?.setlist.find((item) => item.entryId === selectedEntryId)
        : undefined;
      if (entry && isSongEntry(entry) && entry.songId === songId) {
        metronome.start(metronomeTempoMap(parsed), parsed.beats);
      }
    }
  };
});

export function currentGig(state: MasterState): Gig | undefined {
  return state.gigs.find((gig) => gig.id === state.gigId);
}
