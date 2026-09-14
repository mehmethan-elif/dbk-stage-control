import { create } from "zustand";
import { createLogger } from "@dbk/logger";
import {
  decodeSongBuffers,
  Metronome,
  WebAudioEngine,
  type AudioRoutingMode,
  type MetronomeBeat
} from "@dbk/audio";
import {
  createId,
  emptyMixerBank,
  entryStartAt,
  songChainStartAt,
  shouldAutoStartMetronome,
  firstSectionNamed,
  gigMixerState,
  savedOrDefaultLibraryPlayMode,
  hasClickFlac,
  hasPlaybackAudio,
  isSongEntry,
  isStopMarker,
  type SongSetlistEntry,
  metronomeTempoMap,
  parseSongInfo,
  normalizeSong,
  performanceAudioSong,
  PlaybackController,
  PlayMode,
  PlaybackState,
  dropMissingSetlistSongs,
  entryPlayMode,
  resolvePublishedSongId,
  measureStartTimes,
  nextMeasureStart,
  panicDefaultTarget,
  sectionAfter,
  sectionAt,
  sectionNamed,
  snapToSectionBoundary,
  songWithMixerStems,
  songsForcedClickOnly,
  songsForSetlistPerformance,
  isFreePlayMode,
  isFreeSetlistMode,
  declaredSongPlayMode,
  isMetronomeSetlistMode,
  setlistModeIsSilent,
  effectivePlayMode,
  mergeStageNames,
  padStageNames,
  parseSetlistPerformanceMode,
  practiceMasterAudio,
  nextEndedSelectionId,
  pageSongEntryId,
  songFollowedByElif,
  withKeyChangeElifs,
  SetlistPerformanceMode,
  FinishMode,
  applyRemoteSetlist,
  elifPlacementValid,
  isMasterBandName,
  isVocalBandName,
  MASTER_BAND_NAME,
  type Gig,
  type HardwareOutput,
  type MixerBank,
  type MixerChannel,
  type MixStripState,
  type PlaybackSnapshot,
  type Song,
  type SongInfo
} from "@dbk/core";
import {
  REMOTE_DEVICE_NAME,
  type DeviceKind,
  type LoadGigMessage,
  type LoadGigSetlistEntry,
  type MixerStateMessage,
  type RemoteControlMessage,
  type RemoteMixerMessage,
  type SetlistEditMessage,
  type SyncMessage,
  type SyncPeer
} from "@dbk/protocol";
import {
  applyMixerState,
  applyRemoteControl,
  applyRemoteMixer,
  enabledMixerChannels,
  mixerStateMessage,
  remoteGigEntries,
  stubSongsFromRemoteSetlist
} from "./soundcheck-remote";
import { loadLocalLibrary, saveGig as persistGig, deleteGig } from "../persist/indexed-db";
import { seedGig } from "../persist/seed";
import { libraryApi, setLibraryFileOverride } from "../library/api";
import { practiceEntryId, practiceGig } from "../practice/gig";
import { downloadBytes, exportPracticeZip } from "../practice/export";
import {
  isPracticeAudioLoaded,
  loadPracticeAudio,
  type PracticeAudioKind,
  onPracticeTime,
  pausePracticeAudio,
  playPracticeAudio,
  practiceAudioDuration,
  practiceAudioPlaying,
  practiceAudioTime,
  seekPracticeAudio,
  stopPracticeAudio
} from "../practice/playback";
import { syncPublishedLibrary } from "../practice/github-sync";
import { practiceHostFromInput, pullPracticeFromHost } from "../practice/pull";
import { loadPracticeLibrary, readPracticeFileBuffer, readPublishedGigs } from "../practice/store";
import { importPracticeFileList, importPracticeZip } from "../practice/zip";
import { loadSongMixers, saveSongMixer } from "../ui/master/song-mixer";
import { updateSongSettings, writeSongInfo } from "../ui/master/song-settings";
import { readMetroIntroBuffer, readShippedGigs, writeLibraryGigs } from "../native/library";
import { mergeShippedGigs } from "../persist/shipped-gigs";
import { isNativeApp } from "../native/platform";
import {
  isSongLibraryGig,
  findSongByRef,
  overlayHostSongMeta,
  SONG_LIBRARY_GIG_ID,
  SONG_LIBRARY_NAME,
  librarySongIdFromEntry,
  listedGigs,
  pickLibraryEntryId,
  setlistNameTaken,
  songLibraryGig
} from "./song-library";
import { followPacketTime, setFollowClock, setFollowClockSource, stopFollowClock } from "./follow-clock";
import { stageConnectOn } from "./stage-connect";
export { stageConnectOn };
import {
  MASTER_HOST_KEY,
  STAGE_NAME_KEY,
  announceSyncHello,
  clientDeviceName,
  connectSyncTransport,
  disconnectSyncTransport,
  refreshJoinAddress as refreshNativeJoinAddress,
  sendSyncMessage,
  subscribeSyncLink
} from "../native/sync";
import { parseSyncHostname, PRACTICE_SHARE_PORT } from "../native/sync-host";

export type ClientSession = "practice" | "stage";

export type MasterPage = "prep" | "mixer" | "audio" | "lyrics" | "nota" | "chords" | "drums" | "lan";
export type StageContentPage = Extract<MasterPage, "lyrics" | "nota" | "chords" | "drums">;
const AUDIO_DEVICE_KEY = "dbk-audio-device";
const AUDIO_ROUTING_KEY = "dbk-audio-routing";
const ACTIVE_GIG_KEY = "dbk-active-gig";

/**
 * Safari throws from localStorage in private browsing and when the quota is full, and the
 * master reads these while booting — an unguarded throw there takes down the whole app.
 */
function readStored(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage?.setItem(key, value);
  } catch {
    // the show continues without a remembered choice
  }
}

function storedAudioDevice(): string {
  return readStored(AUDIO_DEVICE_KEY) || "default";
}

function storedRoutingMode(): AudioRoutingMode {
  const value = Number(readStored(AUDIO_ROUTING_KEY));
  return value === 2 || value === 3 ? value : 1;
}

function storedStageName(): string | null {
  return readStored(STAGE_NAME_KEY)?.trim() || null;
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
const beatListeners = new Set<(beat: MetronomeBeat) => void>();
let lastMetronomeBeat: MetronomeBeat | null = null;

function notifyMetronomeBeat(beat: MetronomeBeat) {
  lastMetronomeBeat = beat;
  for (const listener of beatListeners) listener(beat);
}

function clearMetronomeBeat() {
  lastMetronomeBeat = null;
  remoteMetroSeq = null;
}

/** Wall-clock seconds for visual metronome cells (advances even if AudioContext is suspended). */
export function metronomeVisualNow(): number {
  return typeof performance !== "undefined" ? performance.now() / 1000 : 0;
}

/** Remaining seconds until a Web Audio–scheduled beat. */
export function audioBeatDelay(audioAt: number): number {
  return Math.max(0, audioAt - engine.getContextTime());
}

/** When a remote beat should paint, using the same wall clock as `metronomeVisualNow`. */
export function remoteMetronomeVisualAt(delaySeconds?: number): number {
  return metronomeVisualNow() + Math.max(0, delaySeconds ?? 0);
}

let remoteMetroSeq: number | null = null;
let metronomeSeq = 0;
let metronomeStartGen = 0;

/** Keep the newest pulse from this master's clock; drop echoes and older packets. */
export function takeRemoteMetronomeSeq(prev: number | null, seq: number | undefined): number | null {
  if (typeof seq !== "number" || !Number.isFinite(seq)) return null;
  if (prev != null && seq <= prev) return null;
  return seq;
}

const metronome = new Metronome(
  (running) => engine.setExternalCueActive(running),
  (beat) => {
    const delay = audioBeatDelay(beat.at) + engine.getOutputLatency();
    notifyMetronomeBeat({ at: remoteMetronomeVisualAt(delay) });
    const state = useMasterStore.getState();
    if (state.deviceKind !== "master") return;
    if (!state.metronomePlaying && !usesFreeMetroTransport(state)) return;
    sendSync({
      type: "Metronome",
      seq: ++metronomeSeq,
      ...(delay > 0 ? { in: delay } : {})
    });
  },
  readMetroIntroBuffer
);

export function readBusLevels() {
  return engine.getBusLevels();
}

export function onMetronomeBeat(listener: (beat: MetronomeBeat) => void): () => void {
  beatListeners.add(listener);
  if (lastMetronomeBeat) listener(lastMetronomeBeat);
  return () => {
    beatListeners.delete(listener);
  };
}

function preloadMetroIntro() {
  if (useMasterStore.getState().deviceKind === "client") return;
  try {
    const ctx = engine.prime();
    metronome.attach(ctx, engine.busNode("CUE"));
    void metronome.ensureIntro(ctx);
  } catch {
    // cue bus is ready after the first prime
  }
}

export function unlockAudio(): void {
  engine.prime();
  preloadMetroIntro();
}

let gestureUnlockInstalled = false;
if (typeof window !== "undefined" && !gestureUnlockInstalled) {
  gestureUnlockInstalled = true;
  const kick = () => {
    engine.prime();
    preloadMetroIntro();
  };
  window.addEventListener("pointerdown", kick, true);
  window.addEventListener("keydown", kick, true);
}

export const controller = new PlaybackController({
  engine,
  logger,
  loadBuffers: async (song) => {
    await engine.init();
    const files = useMasterStore.getState().fileIndex[song.id] ?? [];
    const playable = performanceAudioSong(songWithMixerStems(song, files));
    return decodeSongBuffers(engine.context, playable, async (path) => {
      try {
        return await libraryApi.readBytes(song.id, path);
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

function deckReadyAt(index: number): boolean {
  const snap = controller.getSnapshot();
  return (
    snap.currentIndex === index &&
    (snap.state === PlaybackState.Ready ||
      snap.state === PlaybackState.Playing ||
      snap.state === PlaybackState.Transitioning)
  );
}

function isDeckPlayMode(mode?: PlayMode): boolean {
  return mode === PlayMode.Playback || mode === PlayMode.ClickOnly;
}

function filesForSong(song: Song, fileIndex: Record<string, string[]>): string[] {
  return [
    ...(fileIndex[song.id] ?? []),
    ...(song.folder && song.folder !== song.id ? (fileIndex[song.folder] ?? []) : [])
  ];
}

function playbackSongs(
  songs: Song[],
  fileIndex: Record<string, string[]>,
  gig?: Gig,
  forceClickOnly = false
): Song[] {
  const overlaid = songsForSetlistPerformance(songs, fileIndex, gig?.performanceMode);
  const hydrated = overlaid.map((song) =>
    performanceAudioSong(songWithMixerStems(song, filesForSong(song, fileIndex)))
  );
  return forceClickOnly ? songsForcedClickOnly(hydrated, fileIndex) : hydrated;
}

function panicClickOnly(state: Pick<MasterState, "panicActive" | "panicResumeAt">): boolean {
  return state.panicActive || state.panicResumeAt != null;
}

export function songPlaying(state: Pick<MasterState, "playback">): boolean {
  return (
    state.playback.state === PlaybackState.Playing ||
    state.playback.state === PlaybackState.Transitioning
  );
}

export function panicBlocksFollow(state: MasterState): boolean {
  return state.panicActive || state.panicResumeAt != null;
}

export function stagePlayheadTime(state: MasterState): number {
  if (panicBlocksFollow(state)) return state.panicTargetTime;
  const playing =
    state.playback.state === PlaybackState.Playing ||
    state.playback.state === PlaybackState.Transitioning;
  return playing ? (state.playback.clock?.time ?? state.previewTime) : state.previewTime;
}

export function stageAutoScroll(state: MasterState): boolean {
  return state.autoScroll && !panicBlocksFollow(state);
}

/** A song or the metronome is running, so the band is mid-number. */
export function showIsRunning(
  state: Pick<MasterState, "metronomePlaying" | "playback">
): boolean {
  return (
    state.metronomePlaying ||
    state.playback.state === PlaybackState.Playing ||
    state.playback.state === PlaybackState.Transitioning
  );
}

export function setlistLocked(state: MasterState): boolean {
  // Mid-number the desk holds still: picking another row there would take the show off the track
  // or the click that is sounding, and that is the one place it must not happen. Elif keeps her
  // hands free on the stage, since reordering the set live is the reason she is connected.
  if (state.deviceKind !== "master" && stageConnectOn(state)) return false;
  return showIsRunning(state);
}

export function elifCanEditSetlist(
  state: Pick<MasterState, "deviceKind" | "clientSession" | "syncConnected" | "stageName">
): boolean {
  return (
    state.deviceKind === "client" &&
    state.clientSession === "stage" &&
    state.syncConnected &&
    isVocalBandName(state.stageName ?? "")
  );
}

/**
 * Follows the master's own row, which is not the same thing as this device's selection: Elif's
 * selection is an edit cursor for reordering the setlist. An idle Position trails the last song
 * played, so it must not drag the row back off an ELIF KONUSMA the master has just landed on.
 */
export function nextMasterEntryId(
  current: string | null,
  incoming: string | undefined,
  playing = true
): string | null {
  if (!incoming) return current;
  if (!playing && current) return current;
  return incoming;
}

/**
 * Where a client stands after a packet from the master. The master's row wins every time it
 * moves: selecting a song or starting one puts every device on it, which is the whole point of
 * the stage being connected, and it ends whatever was open out of the library too. Between moves
 * the selection belongs to the device, so anyone can look down the list while the set is stopped.
 * An idle Position trails the last song played and is not a move.
 */
export function clientRowPatch(
  state: Pick<MasterState, "masterEntryId" | "readingEntryId" | "selectedEntryId">,
  incoming: string | undefined,
  playing = true
): Pick<MasterState, "masterEntryId" | "readingEntryId" | "selectedEntryId"> {
  const masterEntryId = nextMasterEntryId(state.masterEntryId, incoming, playing);
  if (masterEntryId === state.masterEntryId) {
    return {
      masterEntryId,
      readingEntryId: state.readingEntryId,
      selectedEntryId: state.selectedEntryId
    };
  }
  return {
    masterEntryId,
    readingEntryId: null,
    selectedEntryId: masterEntryId ?? state.selectedEntryId
  };
}

/** Idle Position must not consume the join snap. LoadGig / LoadSong / Play do. */
export function nextJustJoinedStage(
  justJoinedStage: boolean,
  consume: boolean
): boolean {
  return justJoinedStage && !consume ? true : false;
}

export function setlistChangeKeepsPlayback(state: MasterState): boolean {
  if (state.metronomePlaying) return true;
  const playback = state.playback;
  return (
    playback.state === PlaybackState.Playing ||
    playback.state === PlaybackState.Transitioning ||
    state.playbackPaused
  );
}

function audioGraphLive(state: MasterState): boolean {
  if (state.metronomePlaying) return true;
  return (
    state.playback.state === PlaybackState.Playing ||
    state.playback.state === PlaybackState.Transitioning
  );
}

export function selectAddedSetlistEntry(entryId: string): void {
  const state = useMasterStore.getState();
  if (stageConnectOn(state)) {
    state.selectSetlistEntry(entryId);
    return;
  }
  if (setlistChangeKeepsPlayback(state)) return;
  state.selectSetlistEntry(entryId);
}

interface MasterState {
  ready: boolean;
  songs: Song[];
  fileIndex: Record<string, string[]>;
  gigs: Gig[];
  gigId: string | null;
  librarySongId: string | null;
  selectedEntryId: string | null;
  /** The row the master has the show on, as broadcast. Null off the stage. See `showEntryId`. */
  masterEntryId: string | null;
  /** A song a band member has opened off the setlist to read. Dropped when the master moves on. */
  readingEntryId: string | null;
  justJoinedStage: boolean;
  previewTime: number;
  playbackPaused: boolean;
  panicActive: boolean;
  panicTargetTime: number;
  panicResumeAt: number | null;
  playback: PlaybackSnapshot;
  hostOk: boolean;
  deviceKind: DeviceKind;
  syncHost: string | null;
  syncConnected: boolean;
  syncPeers: SyncPeer[];
  joinAddress: string | null;
  stageName: string | null;
  clientSession: ClientSession;
  practiceBusy: string | null;
  libraryStatus: string | null;
  masterPage: MasterPage;
  setlistOpen: boolean;
  autoScroll: boolean;
  editOpen: boolean;
  stageZooms: Record<StageContentPage, number>;
  toggleSetlistOpen: () => void;
  toggleEditOpen: () => void;
  setStageZoom: (value: number) => void;
  songMix: Record<string, MixerBank>;
  remoteSongMixer: boolean;
  busMix: MixerBank;
  audioOutputs: HardwareOutput[];
  audioDeviceId: string;
  audioOutputChannels: number;
  audioRoutingMode: AudioRoutingMode;
  audioError: string | null;
  audioHint: string | null;
  load: (kind?: DeviceKind, options?: { syncHost?: string }) => Promise<void>;
  joinStage: (host: string) => void;
  leaveStage: () => void;
  joinRemote: (host: string) => void;
  leaveRemote: () => void;
  remoteSelect: (entryId: string) => void;
  remotePlay: (entryId?: string) => void;
  remoteStop: () => void;
  remoteSeek: (time: number) => void;
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
  setStageName: (name: string | null) => void;
  refreshJoinAddress: () => Promise<void>;
  setMasterPage: (page: MasterPage) => void;
  setSongMixStrip: (songId: string, channel: MixerChannel, patch: Partial<MixStripState>) => void;
  setBusMixStrip: (channel: MixerChannel, patch: Partial<MixStripState>) => void;
  refreshAudioOutputs: () => Promise<void>;
  recheckAudioOutputs: () => Promise<void>;
  setAudioDevice: (deviceId: string, opts?: { recreateIfStereo?: boolean }) => Promise<void>;
  setAudioRoutingMode: (mode: AudioRoutingMode) => void;
  setGigId: (id: string) => Promise<void>;
  updateGig: (recipe: (gig: Gig) => Gig) => Promise<void>;
  saveSetlist: (name: string, initialSongId: string) => Promise<boolean>;
  renameSetlist: (name: string) => Promise<boolean>;
  deleteCurrentSetlist: () => Promise<void>;
  selectSetlistEntry: (entryId: string, options?: { playNext?: boolean }) => void;
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
  startMetronome: (fromTime?: number) => void;
  stopMetronome: () => void;
  syncFreeVisualMetronome: () => void;
  previewContinuousNextMetronome: () => void;
  setMetronomeVolume: (value: number) => void;
  saveSongInfo: (songId: string, info: SongInfo) => Promise<void>;
  setSetlistPerformanceMode: (mode: SetlistPerformanceMode) => Promise<void>;
  setPanicTarget: (time: number) => void;
  setPanic: (on: boolean) => void;
}

let tickHandle = 0;
let metroTickHandle = 0;
let freeVisualSongId: string | null = null;
let lastBroadcast = 0;
let lastPlaybackStoreAt = 0;
let lastPracticeStoreAt = 0;
let applyPanicResume: (() => void) | null = null;

const PLAYBACK_UI_MS = 80;

function audibleEngineTime(): number {
  return Math.max(0, (controller.getClock()?.time ?? 0) - engine.getOutputLatency());
}

function audibleMetronomeTime(): number {
  return Math.max(0, metronome.time - engine.getOutputLatency());
}

function playbackStoreNeedsWrite(
  previous: PlaybackSnapshot,
  next: PlaybackSnapshot,
  playing: boolean
): boolean {
  if (next.endedToEntryId) return true;
  if (previous.state !== next.state) return true;
  if (previous.currentIndex !== next.currentIndex) return true;
  if (previous.errorMessage !== next.errorMessage) return true;
  if (previous.clock?.songId !== next.clock?.songId) return true;
  if (previous.clock?.setlistEntryId !== next.clock?.setlistEntryId) return true;
  if (!playing) return true;
  const now = performance.now();
  if (now - lastPlaybackStoreAt >= PLAYBACK_UI_MS) {
    lastPlaybackStoreAt = now;
    return true;
  }
  return false;
}

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
    setlist: remoteGigEntries(gig, state.songs),
    selectedEntryId: state.selectedEntryId ?? undefined,
    performanceMode: parseSetlistPerformanceMode(gig.performanceMode),
    stageNames: padStageNames(gig.stageNames)
  };
}

function broadcastShow() {
  const message = loadGigMessage(useMasterStore.getState());
  if (message) sendSync(message);
}

let lastMixerBroadcast = 0;
let mixerBroadcastTimer = 0;

function mixerSnapshot(state: MasterState): MixerStateMessage {
  const gig = currentGig(state);
  const entry = state.selectedEntryId
    ? gig?.setlist.find((item) => item.entryId === state.selectedEntryId)
    : undefined;
  const songEntry = entry && isSongEntry(entry) ? entry : undefined;
  const song = songEntry ? findSongByRef(state.songs, songEntry.songId) : undefined;
  const files = song ? filesForSong(song, state.fileIndex) : undefined;
  const playMode = effectivePlayMode(song, files, gig?.performanceMode);
  const songMixer = Boolean(
    song && isDeckPlayMode(playMode) && !songUsesMetronome(song, files, gig?.performanceMode)
  );
  return mixerStateMessage({
    busMix: state.busMix,
    metronomeVolume: state.metronomeVolume,
    songId: songEntry?.songId ?? song?.id,
    songTitle: song?.title,
    songMix: song ? (state.songMix[song.id] ?? emptyMixerBank()) : undefined,
    songChannels: song && songMixer ? enabledMixerChannels(files) : undefined,
    playMode,
    songMixer
  });
}

function broadcastMixer(force = false) {
  const state = useMasterStore.getState();
  if (state.deviceKind !== "master") return;
  const now = performance.now();
  if (!force && now - lastMixerBroadcast < 80) {
    window.clearTimeout(mixerBroadcastTimer);
    mixerBroadcastTimer = window.setTimeout(() => broadcastMixer(true), 80);
    return;
  }
  window.clearTimeout(mixerBroadcastTimer);
  mixerBroadcastTimer = 0;
  lastMixerBroadcast = now;
  sendSync(mixerSnapshot(state));
}

function broadcastSelection() {
  const state = useMasterStore.getState();
  if (isFreeSetlistMode(currentGig(state)?.performanceMode)) return;
  const gig = state.gigs.find((item) => item.id === state.gigId);
  // Over the displayed list, so landing on the key change ELIF KONUSMA reaches the clients too.
  // It is not in the stored setlist, but every device works the same row out of the same songs.
  const entry =
    state.selectedEntryId && gig
      ? withKeyChangeElifs(gig.setlist, state.songs).find(
          (item) => item.entryId === state.selectedEntryId
        )
      : undefined;
  if (!entry) return;
  const song = isSongEntry(entry) ? state.songs.find((item) => item.id === entry.songId) : undefined;
  sendSync({
    type: "LoadSong",
    songId: isSongEntry(entry) ? entry.songId : entry.entryId,
    setlistEntryId: entry.entryId,
    title: song?.title ?? entry.entryId
  });
  broadcastMixer(true);
}

function broadcastPlay() {
  const state = useMasterStore.getState();
  if (isFreeSetlistMode(currentGig(state)?.performanceMode) || selectedSongIsFree(state)) return;
  const gig = state.gigs.find((item) => item.id === state.gigId);
  const clock = controller.getClock();
  const entryId = clock?.setlistEntryId ?? state.selectedEntryId;
  const entry = entryId ? gig?.setlist.find((item) => item.entryId === entryId) : undefined;
  if (!entry || !isSongEntry(entry)) return;
  sendSync({
    type: "Play",
    songId: clock?.songId ?? entry.songId,
    setlistEntryId: entry.entryId,
    at: clock?.time ?? state.previewTime,
    sent: Date.now()
  });
}

function elifSetlistEditAllowed(state: MasterState, message: SetlistEditMessage): boolean {
  if (!isVocalBandName(message.deviceName)) return false;
  return !state.gigId || message.gigId === state.gigId;
}

function applySetlistToGig(
  current: Gig,
  incoming: LoadGigSetlistEntry[]
): Gig | null {
  const setlist = applyRemoteSetlist(current.setlist, incoming as Gig["setlist"]);
  if (!elifPlacementValid(setlist)) return null;
  return { ...current, setlist };
}

function keepPlaybackForSetlist(
  previous: MasterState["playback"],
  setlist: Gig["setlist"]
): MasterState["playback"] {
  const clockId = previous.clock?.setlistEntryId;
  const clockStillThere = clockId ? setlist.some((entry) => entry.entryId === clockId) : false;
  return clockStillThere
    ? previous
    : {
        ...previous,
        state: PlaybackState.Idle,
        clock: null
      };
}

function applyMasterRemoteMixer(message: RemoteMixerMessage, get: () => MasterState) {
  const state = get();
  if (state.deviceKind !== "master") return;
  applyRemoteMixer(message, {
    setSongMixStrip: state.setSongMixStrip,
    setBusMixStrip: state.setBusMixStrip,
    setMetronomeVolume: state.setMetronomeVolume
  });
}

function applyMasterRemoteControl(message: RemoteControlMessage, get: () => MasterState) {
  const state = get();
  if (state.deviceKind !== "master") return;
  applyRemoteControl(message, {
    selectSetlistEntry: state.selectSetlistEntry,
    playSelected: () => void state.playSelected(),
    stop: state.stop,
    seek: state.seek,
    selectedEntryId: state.selectedEntryId,
    playing:
      state.playback.state === PlaybackState.Playing ||
      state.playback.state === PlaybackState.Transitioning,
    playingEntryId: state.playback.clock?.setlistEntryId ?? null
  });
}

function applyClientSync(message: SyncMessage, get: () => MasterState, set: (patch: Partial<MasterState>) => void) {
  if (
    message.type !== "Position" &&
    message.type !== "Seek" &&
    message.type !== "MixerState" &&
    message.type !== "Metronome"
  ) {
    stopPracticeAudio();
  }
  if (message.type === "RemoteControl") {
    applyMasterRemoteControl(message, get);
    return;
  }
  if (message.type === "RemoteMixer") {
    applyMasterRemoteMixer(message, get);
    return;
  }
  if (message.type === "MixerState") {
    if (get().deviceKind !== "remote") return;
    set(applyMixerState(message, get()));
    return;
  }
  if (message.type === "SetlistEdit") {
    const state = get();
    if (!elifSetlistEditAllowed(state, message)) return;
    if (state.deviceKind === "master") {
      const current = currentGig(state);
      if (!current) return;
      const next = applySetlistToGig(current, message.setlist);
      if (!next) return;
      void state.updateGig(() => next);
      return;
    }
    const current = currentGig(state);
    if (!current) return;
    const next = applySetlistToGig(current, message.setlist);
    if (!next) return;
    const currentId = state.selectedEntryId;
    const stillThere = currentId
      ? next.setlist.some((entry) => entry.entryId === currentId)
      : false;
    const free = isFreeSetlistMode(next.performanceMode);
    set({
      gigs: [next],
      selectedEntryId: stillThere ? currentId : firstSongEntryId(next),
      playback: free
        ? {
            ...state.playback,
            state: PlaybackState.Idle,
            clock: null
          }
        : keepPlaybackForSetlist(state.playback, next.setlist)
    });
    if (free && !stillThere) get().stopMetronome();
    return;
  }
  if (message.type === "LoadGig") {
    const setlist = message.setlist ?? [];
    const previous = get();
    const sameShow = previous.gigId === message.gigId;
    const current = sameShow ? currentGig(previous) : undefined;
    const gig: Gig = {
      id: message.gigId,
      name: message.name,
      date: current?.date ?? "",
      musicians: current?.musicians ?? [],
      setlist: (sameShow && current
        ? applyRemoteSetlist(current.setlist, setlist as Gig["setlist"])
        : setlist) as Gig["setlist"],
      performanceMode: parseSetlistPerformanceMode(message.performanceMode),
      stageNames: mergeStageNames(message.stageNames, currentGig(previous)?.stageNames)
    };
    const currentId = previous.selectedEntryId;
    const stillThere = currentId ? gig.setlist.some((entry) => entry.entryId === currentId) : false;
    const incomingSelected =
      typeof message.selectedEntryId === "string" &&
      gig.setlist.some((entry) => entry.entryId === message.selectedEntryId)
        ? message.selectedEntryId
        : undefined;
    const free = isFreeSetlistMode(gig.performanceMode);
    const wasFree = isFreeSetlistMode(current?.performanceMode);
    const remoteSongs =
      previous.deviceKind === "remote" ? stubSongsFromRemoteSetlist(setlist) : undefined;
    set({
      gigs: [gig],
      gigId: gig.id,
      ...clientRowPatch(previous, incomingSelected),
      ...(incomingSelected
        ? {}
        : { selectedEntryId: stillThere ? currentId : firstSongEntryId(gig) }),
      justJoinedStage: nextJustJoinedStage(previous.justJoinedStage, Boolean(incomingSelected)),
      ...(remoteSongs ? { songs: remoteSongs } : {}),
      playback: free || !sameShow
        ? {
            ...previous.playback,
            state: PlaybackState.Idle,
            clock: null
          }
        : keepPlaybackForSetlist(previous.playback, gig.setlist)
    });
    if (free || !sameShow) stopFollowClock(0);
    if ((wasFree && !free) || (free && !stillThere)) get().stopMetronome();
    return;
  }
  if (message.type === "LoadSong") {
    if (isFreeSetlistMode(currentGig(get())?.performanceMode)) return;
    set({
      ...clientRowPatch(get(), message.setlistEntryId),
      justJoinedStage: nextJustJoinedStage(get().justJoinedStage, true)
    });
    if (liveSongIsBackingTracks(get())) {
      clearMetronomeBeat();
      if (get().metronomePlaying) set({ metronomePlaying: false });
    }
    return;
  }
  if (message.type === "Stop") {
    const previous = get().playback;
    const clock = previous.clock;
    stopFollowClock(0);
    clearMetronomeBeat();
    set({
      previewTime: 0,
      metronomePlaying: false,
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
    if (isFreeSetlistMode(currentGig(get())?.performanceMode) || selectedSongIsFree(get())) return;
    const playing =
      get().playback.state === PlaybackState.Playing ||
      get().playback.state === PlaybackState.Transitioning;
    const seekTime = followPacketTime(message.time, message.sent);
    setFollowClock(seekTime, playing);
    set({ previewTime: seekTime });
    return;
  }
  if (message.type === "Metronome") {
    if (!clientStageLive(get())) return;
    if (liveSongIsBackingTracks(get())) {
      clearMetronomeBeat();
      if (get().metronomePlaying) set({ metronomePlaying: false });
      return;
    }
    if (message.playing === false) {
      clearMetronomeBeat();
      if (!usesFreeMetroTransport(get())) set({ metronomePlaying: false });
      return;
    }
    const nextSeq = takeRemoteMetronomeSeq(remoteMetroSeq, message.seq);
    if (nextSeq == null) return;
    remoteMetroSeq = nextSeq;
    notifyMetronomeBeat({ at: remoteMetronomeVisualAt(message.in) });
    if (!usesFreeMetroTransport(get())) set({ metronomePlaying: true });
    return;
  }
  if (message.type === "Play") {
    if (isFreeSetlistMode(currentGig(get())?.performanceMode) || selectedSongIsFree(get())) {
      if (get().justJoinedStage && message.setlistEntryId) {
        set({
          ...clientRowPatch(get(), message.setlistEntryId),
          justJoinedStage: nextJustJoinedStage(get().justJoinedStage, true)
        });
      }
      return;
    }
    const previous = get().playback;
    const at = followPacketTime(message.at, message.sent);
    setFollowClock(at, true);
    set({
      ...clientRowPatch(get(), message.setlistEntryId),
      justJoinedStage: nextJustJoinedStage(get().justJoinedStage, true),
      previewTime: at,
      playback: {
        ...previous,
        state: PlaybackState.Playing,
        clock: {
          songId: message.songId,
          setlistEntryId: message.setlistEntryId,
          time: at,
          measure: previous.clock?.measure ?? 1,
          beat: previous.clock?.beat ?? 1,
          section: previous.clock?.section,
          playing: true,
          nextSongId: previous.clock?.nextSongId,
          finishMode: previous.clock?.finishMode
        }
      }
    });
    if (liveSongIsBackingTracks(get())) {
      clearMetronomeBeat();
      if (get().metronomePlaying) set({ metronomePlaying: false });
    }
    return;
  }
  if (message.type !== "Position") return;
  if (isFreeSetlistMode(currentGig(get())?.performanceMode) || selectedSongIsFree(get())) {
    if (get().justJoinedStage && message.setlistEntryId) {
      set({
        ...clientRowPatch(get(), message.setlistEntryId, message.playing),
        justJoinedStage: nextJustJoinedStage(get().justJoinedStage, message.playing)
      });
    }
    return;
  }
  const followTime = followPacketTime(message.time, message.sent);
  if (message.playing) {
    setFollowClock(followTime, true);
  } else {
    stopFollowClock(followTime);
  }
  set({
    ...clientRowPatch(get(), message.setlistEntryId, message.playing),
    justJoinedStage: nextJustJoinedStage(get().justJoinedStage, message.playing),
    previewTime: followTime,
    playback: {
      state: message.playing ? PlaybackState.Playing : PlaybackState.Idle,
      clock: {
        songId: message.songId,
        setlistEntryId: message.setlistEntryId,
        time: followTime,
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
  if (liveSongIsBackingTracks(get())) {
    clearMetronomeBeat();
    if (get().metronomePlaying) set({ metronomePlaying: false });
  }
}

let unsubSyncLink: (() => void) | null = null;

function connectSync(get: () => MasterState, set: (patch: Partial<MasterState>) => void) {
  if (!unsubSyncLink) {
    unsubSyncLink = subscribeSyncLink((link) => {
      const previous = get();
      const dropped =
        clientStageLive(previous) && previous.syncConnected && !link.connected;
      set({
        syncConnected: link.connected,
        syncPeers: link.peers,
        ...(link.endpoint ? { joinAddress: link.endpoint } : {})
      });
      if (dropped) get().leaveStage();
    });
  }
  void connectSyncTransport({
    deviceKind: () => get().deviceKind,
    deviceName: () => get().stageName ?? "",
    syncHost: () => get().syncHost,
    onMasterOpen: () => {
      broadcastShow();
      broadcastSelection();
      broadcastMixer(true);
    },
    onClientHello: () => {
      broadcastShow();
      broadcastSelection();
      broadcastMixer(true);
    },
    onMasterSessionReset: () => get().leaveStage(),
    onClientSync: (message) => applyClientSync(message, get, set)
  }).then((address) => {
    if (address) set({ joinAddress: address });
  });
}

function broadcastClock(snapshot: PlaybackSnapshot, force = false) {
  if (useMasterStore.getState().deviceKind !== "master") return;
  if (
    isFreeSetlistMode(currentGig(useMasterStore.getState())?.performanceMode) ||
    selectedSongIsFree(useMasterStore.getState())
  ) return;
  const clock = snapshot.clock;
  if (!clock) return;
  const now = performance.now();
  if (!force && now - lastBroadcast < 80 && snapshot.state !== PlaybackState.Transitioning) return;
  lastBroadcast = now;
  const state = useMasterStore.getState();
  const time = panicBlocksFollow(state) ? state.panicTargetTime : clock.time;
  sendSync({
    type: "Position",
    songId: clock.songId,
    setlistEntryId: clock.setlistEntryId,
    time,
    measure: clock.measure,
    beat: clock.beat,
    section: clock.section,
    playing: clock.playing,
    nextSongId: clock.nextSongId,
    finishMode: clock.finishMode,
    sent: Date.now()
  });
}

function startTick() {
  cancelAnimationFrame(tickHandle);
  const loop = () => {
    const snap = controller.tick();
    const playing =
      snap.state === PlaybackState.Playing || snap.state === PlaybackState.Transitioning;
    if (playing) {
      setFollowClockSource(() => audibleEngineTime());
    }
    const resumeAt = useMasterStore.getState().panicResumeAt;
    if (resumeAt != null) {
      const time = snap.clock?.time ?? 0;
      if (!playing || time + 0.02 >= resumeAt) applyPanicResume?.();
    }
    broadcastClock(snap);
    if (playing) {
      tickHandle = requestAnimationFrame(loop);
    }
  };
  tickHandle = requestAnimationFrame(loop);
}

function stopMetronomeTick() {
  cancelAnimationFrame(metroTickHandle);
  metroTickHandle = 0;
}

function startMetronomeTick() {
  stopMetronomeTick();
  const loop = () => {
    const state = useMasterStore.getState();
    if (!state.metronomePlaying) {
      metroTickHandle = 0;
      return;
    }
    setFollowClockSource(() => audibleMetronomeTime());
    const now = performance.now();
    if (now - lastPlaybackStoreAt >= PLAYBACK_UI_MS) {
      lastPlaybackStoreAt = now;
      useMasterStore.setState({ previewTime: audibleMetronomeTime() });
    }
    metroTickHandle = requestAnimationFrame(loop);
  };
  metroTickHandle = requestAnimationFrame(loop);
}

function firstSongEntryId(gig: Gig | undefined): string | null {
  return gig?.setlist.find(isSongEntry)?.entryId ?? null;
}

function songForSelectedEntry(state: MasterState): Song | undefined {
  const gig = currentGig(state);
  const selected = state.selectedEntryId
    ? gig?.setlist.find((entry) => entry.entryId === state.selectedEntryId)
    : undefined;
  if (selected && isSongEntry(selected)) {
    const found = findSongByRef(state.songs, selected.songId);
    if (found) return found;
  }
  const id = state.selectedEntryId;
  if (!id) return undefined;
  return (
    state.songs.find(
      (item) =>
        practiceEntryId(item.id) === id ||
        practiceEntryId(item.folder ?? "") === id ||
        item.id === id
    ) ?? (id.startsWith("practice_") ? findSongByRef(state.songs, id.slice("practice_".length)) : undefined)
  );
}

type LegacyGig = Gig & {
  songSettings?: Record<
    string,
    { info?: SongInfo; playMode?: PlayMode; startAt?: number; notes?: SongInfo["pageNotes"] }
  >;
};

function orderOnlyGig(gig: Gig): Gig {
  const { songSettings: _songSettings, ...rest } = gig as LegacyGig;
  return {
    ...rest,
    setlist: gig.setlist.map((entry) =>
      isSongEntry(entry)
        ? {
            type: "song" as const,
            entryId: entry.entryId,
            songId: entry.songId,
            ...(entry.skipped ? { skipped: true as const } : {})
          }
        : entry
    )
  };
}

function saveGig(gig: Gig): Promise<void> {
  const next = persistGig(orderOnlyGig(gig));
  const shows = useMasterStore.getState().gigs.filter((item) => !isSongLibraryGig(item));
  persistLibraryGigs(shows.some((item) => item.id === gig.id) ? shows.map((item) => (item.id === gig.id ? gig : item)) : [...shows, gig]);
  return next;
}

function persistLibraryGigs(gigs: Gig[]): void {
  const shows = gigs.filter((gig) => !isSongLibraryGig(gig)).map(orderOnlyGig);
  void writeLibraryGigs(shows).catch(() => undefined);
}

function publishableGigs(state: MasterState): Gig[] {
  const shows = state.gigs.filter((gig) => !isSongLibraryGig(gig)).map(orderOnlyGig);
  return [
    ...shows.filter((gig) => gig.id === state.gigId),
    ...shows.filter((gig) => gig.id !== state.gigId)
  ];
}

let localPackTimer = 0;
let localPackFull = false;

async function postLocalClientPack(gigs: Gig[], full: boolean): Promise<void> {
  const response = await fetch("/client-library/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gigs, gigsOnly: !full })
  });
  if (!response.ok) throw new Error("Could not update local client library.");
}

function shareLocalClientPack(get: () => MasterState, full = false): void {
  if (get().deviceKind !== "master" || isNativeApp()) return;
  if (full) localPackFull = true;
  window.clearTimeout(localPackTimer);
  localPackTimer = window.setTimeout(() => {
    const doFull = localPackFull;
    localPackFull = false;
    void postLocalClientPack(publishableGigs(get()), doFull).catch(() => undefined);
  }, full ? 0 : 400);
}

async function migrateLegacySongInfo(songs: Song[], gigs: Gig[]): Promise<Song[]> {
  return Promise.all(
    songs.map(async (song) => {
      const current = parseSongInfo(song.info);
      const legacyGig = (gigs as LegacyGig[]).find((gig) =>
        gig.setlist.some((entry) => isSongEntry(entry) && entry.songId === song.id)
      );
      const legacyEntry = legacyGig?.setlist.find(
        (entry) => isSongEntry(entry) && entry.songId === song.id
      );
      const legacySettings = legacyGig?.songSettings?.[song.id];
      const info = parseSongInfo({
        ...current,
        ...legacySettings?.info,
        playMode:
          legacySettings?.playMode ??
          (legacyEntry && isSongEntry(legacyEntry) ? legacyEntry.playMode : undefined) ??
          current.playMode,
        startAt:
          legacySettings?.startAt ??
          (legacyEntry && isSongEntry(legacyEntry) ? legacyEntry.startAt : undefined) ??
          current.startAt,
        pageNotes: legacySettings?.notes ?? current.pageNotes
      });
      if (JSON.stringify(info) === JSON.stringify(current)) return song;
      void writeSongInfo(song.id, info).catch(() => undefined);
      return { ...song, info };
    })
  );
}

async function withLiveHostSongMeta(songs: Song[]): Promise<Song[]> {
  if (songs.length === 0 || isNativeApp()) return songs;
  try {
    const host = await libraryApi.loadIndex();
    return overlayHostSongMeta(songs, host.songs);
  } catch {
    return songs;
  }
}

async function assignLibraryPlayModes(
  songs: Song[],
  fileIndex: Record<string, string[]>,
  persist: boolean
): Promise<Song[]> {
  return Promise.all(
    songs.map(async (song) => {
      const playable = performanceAudioSong(song);
      const listed = filesForSong(playable, fileIndex);
      const files = listed.length > 0 ? listed : undefined;
      const current = parseSongInfo(playable.info);
      const playMode = savedOrDefaultLibraryPlayMode(current, playable, files);
      if (current.playMode === playMode) return playable;
      const info = parseSongInfo({ ...current, playMode });
      if (persist) void writeSongInfo(playable.id, info).catch(() => undefined);
      return { ...playable, info };
    })
  );
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
  const remapped = dropMissingSetlistSongs(remapPublishedGigs(publishedGigs, songs), songs);
  const usable = remapped.filter((gig) =>
    gig.setlist.some((entry) => isSongEntry(entry) && songs.some((song) => song.id === entry.songId))
  );
  const gig = usable[0] ?? practiceGig(songs);
  const gigs = usable.length ? usable : gig.setlist.length ? [gig] : [];
  const keep =
    keepSongId && songs.some((song) => song.id === keepSongId)
      ? keepSongId
      : gig.setlist.find(
          (entry): entry is SongSetlistEntry =>
            isSongEntry(entry) && songs.some((song) => song.id === entry.songId)
        )?.songId ?? songs[0]?.id;
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
  const song = findSongByRef(songs, entry.songId);
  if (firstSectionNamed(song?.sections, "SERBEST")) return 0;
  return entryStartAt(entry, song);
}

export function nextUnskippedSongEntryId(gig: Gig | undefined, currentId: string | null): string | null {
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

export function songUsesMetronome(
  song: Song | undefined,
  files: string[] | undefined,
  performanceMode?: string
): boolean {
  const mode = effectivePlayMode(song, files, performanceMode);
  return mode === PlayMode.View || (mode === PlayMode.Playback && !hasPlaybackAudio(song, files));
}

/** Position slider is for backing tracks only — never real or fake metronome songs. */
export function songShowsPositionSlider(
  song: Song | undefined,
  _files: string[] | undefined,
  performanceMode?: string
): boolean {
  if (!song?.sections.length) return false;
  if (isMetronomeSetlistMode(performanceMode)) return false;
  return declaredSongPlayMode(song) !== PlayMode.View;
}

export function clientStageLive(state: Pick<MasterState, "deviceKind" | "clientSession" | "syncConnected">): boolean {
  return state.deviceKind === "client" && state.clientSession === "stage" && state.syncConnected;
}

export function clientPracticeMode(
  state: Pick<MasterState, "deviceKind" | "clientSession" | "syncConnected">
): boolean {
  return state.deviceKind === "client" && !clientStageLive(state);
}

export function stageHasLiveClients(
  state: Pick<MasterState, "deviceKind" | "syncConnected" | "syncPeers">
): boolean {
  if (state.deviceKind !== "master" || !state.syncConnected) return false;
  return state.syncPeers.some((peer) => peer.deviceKind === "client");
}

/** Local title slider: master with no clients, or a client that is not live on stage. */
export function showsTitlePositionSlider(
  state: Pick<MasterState, "deviceKind" | "clientSession" | "syncConnected" | "syncPeers">
): boolean {
  if (state.deviceKind === "client") return !clientStageLive(state);
  if (state.deviceKind === "master") return !stageHasLiveClients(state);
  return false;
}

function songEntryIsFree(state: MasterState, entryId = state.selectedEntryId): boolean {
  const gig = currentGig(state);
  if (!entryId || isMetronomeSetlistMode(gig?.performanceMode)) return false;
  const entry = gig?.setlist.find((item) => item.entryId === entryId);
  if (!entry || !isSongEntry(entry)) return false;
  const song = findSongByRef(state.songs, entry.songId);
  if (!song) return false;
  return isFreePlayMode(effectivePlayMode(song, filesForSong(song, state.fileIndex), gig?.performanceMode));
}

function selectedSongIsFree(state: MasterState): boolean {
  return songEntryIsFree(state);
}

/**
 * The row the show is on: what every device marks and opens its pages at. That is the master's
 * row, not this device's selection, because Elif reorders the setlist from the stage by selecting
 * a row and adding, deleting or dragging around it — her selection is an edit cursor, and the
 * stage stays where the master put it whether or not anything is playing.
 */
export function showEntryId(
  state: Pick<MasterState, "deviceKind" | "masterEntryId" | "selectedEntryId">
): string | null {
  if (state.deviceKind !== "client") return state.selectedEntryId;
  return state.masterEntryId ?? state.selectedEntryId;
}

/** Looking a song up out of the library rather than watching the show. */
export function readingOffShow(state: Pick<MasterState, "readingEntryId">): boolean {
  return Boolean(state.readingEntryId);
}

/**
 * The row this device's pages are open at. A song up out of the library wins first: reading holds
 * until the master moves the show on, which is how anyone checks something mid-set without losing
 * their place. Mid-number the page then belongs to the show, so Elif can move her selection to
 * work on the running order while a song plays and her page will not follow her there. With the
 * set stopped the selection is the device's own and the page goes where it goes. Where the show
 * is stays `showEntryId`.
 */
export function pageEntryId(
  state: Pick<
    MasterState,
    | "deviceKind"
    | "masterEntryId"
    | "readingEntryId"
    | "selectedEntryId"
    | "metronomePlaying"
    | "playback"
  >
): string | null {
  if (state.deviceKind !== "client") return state.selectedEntryId;
  if (state.readingEntryId) return state.readingEntryId;
  if (showIsRunning(state)) return state.masterEntryId ?? state.selectedEntryId;
  return state.selectedEntryId ?? state.masterEntryId;
}

/** `pageEntryId` as a song: an ELIF KONUSMA or STOP opens the song it leads into. */
export function pageEntrySongId(state: MasterState): string | null {
  const entryId = pageEntryId(state);
  const gig = currentGig(state);
  if (!entryId || !gig) return entryId;
  const direct = gig.setlist.find((entry) => entry.entryId === entryId);
  if (direct && isSongEntry(direct)) return entryId;
  return pageSongEntryId(withKeyChangeElifs(gig.setlist, state.songs), entryId);
}

/**
 * The row a page scrolls to. The desk lands on the ELIF KONUSMA or the STOP itself, because that
 * is where the show is and the operator needs to see it. A band member gets the song the marker
 * leads into instead: what they need in front of them is the number they are about to play.
 */
export function pageScrollEntryId(state: MasterState): string | null {
  if (state.deviceKind === "master") return pageEntryId(state);
  return pageEntrySongId(state);
}

export function followsSharedPlayhead(state: MasterState): boolean {
  if (state.deviceKind === "client" && !clientStageLive(state)) return false;
  // Reading something out of the library means the page is off the show for the moment, so the
  // playhead must not scroll it away from what is being looked up.
  if (state.readingEntryId) return false;
  if (!stageConnectOn(state)) return false;
  if (isFreeSetlistMode(currentGig(state)?.performanceMode)) return false;
  return !songEntryIsFree(state, pageEntrySongId(state));
}

export function usesFreeMetroTransport(state: MasterState): boolean {
  return isFreeSetlistMode(currentGig(state)?.performanceMode) || selectedSongIsFree(state);
}

/** Master Free clicks, or a live stage client following those clicks. */
export function followsFreeMasterClicks(state: MasterState): boolean {
  if (!usesFreeMetroTransport(state)) return false;
  return state.deviceKind === "master" || clientStageLive(state);
}

/** Practice file to play: Master.mp3 for Backing Tracks. */
export function practiceAudioKind(
  state: MasterState,
  song = songForSelectedEntry(state)
): PracticeAudioKind | null {
  if (!clientPracticeMode(state) || !song) return null;
  const gig = currentGig(state);
  const setlistMode = parseSetlistPerformanceMode(gig?.performanceMode);
  if (isMetronomeSetlistMode(setlistMode) || isFreeSetlistMode(setlistMode)) return null;
  const files = filesForSong(song, state.fileIndex);
  const entry = gig?.setlist.find(
    (item) =>
      isSongEntry(item) && (item.songId === song.id || item.songId === song.folder)
  );
  const declared = entryPlayMode(entry && isSongEntry(entry) ? entry : undefined, song.info);
  if (setlistMode === SetlistPerformanceMode.FollowSongInfo && declared === PlayMode.Playback) {
    if (practiceMasterAudio(files)) return "master";
  }
  return null;
}

/** Practice plays Master.mp3 instead of the generated metronome. */
export function practicePlaysMasterMix(state: MasterState, song = songForSelectedEntry(state)): boolean {
  return practiceAudioKind(state, song) != null;
}

function queuePracticeAudio(state: MasterState, song?: Song) {
  const target = song ?? songForSelectedEntry(state);
  if (!target) return;
  const kind = practiceAudioKind(state, target);
  if (!kind) return;
  void loadPracticeAudio(target.id, filesForSong(target, state.fileIndex), kind);
}

export function practiceBlocksSongSelect(state: MasterState): boolean {
  if (!clientPracticeMode(state)) return false;
  return (
    state.metronomePlaying ||
    state.playback.state === PlaybackState.Playing ||
    state.playback.state === PlaybackState.Transitioning
  );
}

/** PRACTICE auto-advances only when the setlist would Play Next into another Master mix. */
export function practiceShouldPlayNext(state: MasterState): boolean {
  if (!practicePlaysMasterMix(state)) return false;
  const gig = currentGig(state);
  if (!gig || !state.selectedEntryId) return false;
  const index = gig.setlist.findIndex((item) => item.entryId === state.selectedEntryId);
  if (index < 0) return false;
  const songsByRef = new Map<string, Song>();
  for (const item of state.songs) {
    songsByRef.set(item.id, item);
    if (item.folder) songsByRef.set(item.folder, item);
  }
  if (songFollowedByElif(gig.setlist, index, songsByRef)) return false;
  const nextId = nextUnskippedSongEntryId(gig, state.selectedEntryId);
  if (!nextId) return false;
  const nextEntry = gig.setlist.find((item) => item.entryId === nextId);
  if (!nextEntry || !isSongEntry(nextEntry)) return false;
  return practicePlaysMasterMix(state, findSongByRef(state.songs, nextEntry.songId));
}

/** Song the live transport follows: playhead while a song is running, otherwise the selection. */
export function livePerformanceEntryId(state: MasterState): string | null {
  const playing =
    state.playback.state === PlaybackState.Playing ||
    state.playback.state === PlaybackState.Transitioning;
  if (playing && state.playback.clock?.setlistEntryId) return state.playback.clock.setlistEntryId;
  return state.selectedEntryId;
}

export function liveSongIsBackingTracks(state: MasterState): boolean {
  const gig = currentGig(state);
  if (!gig || isMetronomeSetlistMode(gig.performanceMode) || isFreeSetlistMode(gig.performanceMode)) {
    return false;
  }
  const entryId = livePerformanceEntryId(state);
  const entry = entryId ? gig.setlist.find((item) => item.entryId === entryId) : undefined;
  if (!entry || !isSongEntry(entry)) return false;
  const song = findSongByRef(state.songs, entry.songId);
  return entryPlayMode(entry, song?.info) === PlayMode.Playback;
}

/** Live clients watch the metronome pulse but do not drive play/stop. */
export function followsMasterMetroVisuals(state: MasterState): boolean {
  if (!clientStageLive(state)) return false;
  if (liveSongIsBackingTracks(state)) return false;
  const gig = currentGig(state);
  if (isFreeSetlistMode(gig?.performanceMode)) return false;
  if (isMetronomeSetlistMode(gig?.performanceMode)) return true;
  const entryId = livePerformanceEntryId(state);
  const entry = entryId ? gig?.setlist.find((item) => item.entryId === entryId) : undefined;
  if (!entry || !isSongEntry(entry)) return false;
  const song = findSongByRef(state.songs, entry.songId);
  return entryPlayMode(entry, song?.info) === PlayMode.View;
}

export function usesContinuousMetroTransport(state: MasterState): boolean {
  if (practicePlaysMasterMix(state)) return false;
  if (usesFreeMetroTransport(state)) return true;
  const gig = currentGig(state);
  const mode = parseSetlistPerformanceMode(gig?.performanceMode);
  if (isFreeSetlistMode(mode)) return false;
  const canDriveMetro = state.deviceKind === "master" || clientPracticeMode(state);
  if (!canDriveMetro) return false;
  if (isMetronomeSetlistMode(mode)) return true;
  if (mode !== SetlistPerformanceMode.FollowSongInfo) return false;
  const entry = state.selectedEntryId
    ? gig?.setlist.find((item) => item.entryId === state.selectedEntryId)
    : undefined;
  if (!entry || !isSongEntry(entry)) return false;
  const song = findSongByRef(state.songs, entry.songId);
  const files = song ? filesForSong(song, state.fileIndex) : undefined;
  return songUsesMetronome(song, files, gig?.performanceMode);
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
  if (state.deviceKind !== "master") return;
  const current = state.gigs.find((item) => item.id === gigId);
  if (!current || isSongLibraryGig(current)) return;
  const next: Gig = { ...current, busMix: state.busMix, metronomeVolume: state.metronomeVolume };
  void saveGig(next);
  set({ gigs: get().gigs.map((item) => (item.id === next.id ? next : item)) });
  shareLocalClientPack(get);
}

function scheduleGigMixSave(get: () => MasterState, set: (patch: Partial<MasterState>) => void) {
  const gigId = get().gigId;
  if (!gigId || gigId === SONG_LIBRARY_GIG_ID || get().deviceKind !== "master") return;
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
  if (get().deviceKind !== "master") return;
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

const LIBRARY_LOAD_MS = 8_000;
let loadInFlight: Promise<void> | null = null;
let loadInFlightKey: string | null = null;

function raceTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function runLibraryLoad(
  kind: DeviceKind,
  options: { syncHost?: string } | undefined,
  get: () => MasterState,
  set: (patch: Partial<MasterState>) => void
): Promise<void> {
  try {
    if (kind === "client") {
      await loadLibraryNow(kind, options, get, set);
      return;
    }
    await Promise.race([
      loadLibraryNow(kind, options, get, set),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("Library load timed out.")), LIBRARY_LOAD_MS);
      })
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load library.";
    if (kind === "client") {
      set({
        ready: false,
        libraryStatus: message,
        practiceBusy: null
      });
      return;
    }
    const songs = get().songs;
    const gigs = get().gigs.length > 0 ? get().gigs : [songLibraryGig(songs)];
    set({
      ready: true,
      songs,
      fileIndex: get().fileIndex,
      gigs,
      gigId: get().gigId ?? SONG_LIBRARY_GIG_ID,
      hostOk: get().hostOk || !isNativeApp(),
      libraryStatus: songs.length > 0 ? get().libraryStatus : message
    });
  }
}

async function loadLibraryNow(
  kind: DeviceKind,
  options: { syncHost?: string } | undefined,
  get: () => MasterState,
  set: (patch: Partial<MasterState>) => void
): Promise<void> {
  set({
    deviceKind: kind,
    syncHost: kind === "client" || kind === "remote" ? null : options?.syncHost?.trim() || get().syncHost,
    libraryStatus: null
  });
  if (kind === "remote") {
    set({
      ready: true,
      songs: [],
      fileIndex: {},
      gigs: [],
      gigId: null,
      selectedEntryId: null,
      remoteSongMixer: false,
      hostOk: true,
      clientSession: "practice",
      stageName: REMOTE_DEVICE_NAME,
      setlistOpen: true,
      libraryStatus: null
    });
    return;
  }
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
        const index = await libraryApi.loadIndex();
        songs = index.songs;
        fileIndex = index.fileIndex;
        hostOk = songs.length > 0;
      }
      if (!isNativeApp()) {
        const report = (message: string) => set({ libraryStatus: message, practiceBusy: message });
        report("Updating library…");
        try {
          await syncPublishedLibrary((progress) => report(progress.message));
        } catch (error) {
          if (songs.length === 0) throw error;
        }
        const again = await loadPracticeLibrary();
        if (again.songs.length > 0) {
          songs = again.songs;
          fileIndex = again.fileIndex;
        }
        hostOk = songs.length > 0;
        set({ practiceBusy: null, libraryStatus: null });
      }
    } else {
      const index = await libraryApi.loadIndex();
      songs = index.songs;
      fileIndex = index.fileIndex;
      hostOk = songs.length > 0 || !isNativeApp();
    }
  } catch (error) {
    if (kind === "client" && !isNativeApp()) throw error;
    hostOk = kind === "client";
  }
  songs = songs.map((song) => normalizeSong(song, song.folder ?? song.id));
  if (kind === "client") {
    songs = await withLiveHostSongMeta(songs);
  } else {
    songs = await assignLibraryPlayModes(songs, fileIndex, true);
  }
  if (songs.length > 0) {
    set({ songs, fileIndex, hostOk });
  }
  let songMix: Record<string, MixerBank> = {};
  try {
    songMix =
      kind === "master"
        ? await raceTimeout(loadSongMixers(songs.map((song) => song.id)), 3_000, {})
        : {};
  } catch {
    songMix = {};
  }
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
      libraryStatus: null,
      practiceBusy: null,
      masterPage: "lyrics",
      clientSession: "practice",
      syncHost: null,
      setlistOpen: true,
      songMix
    });
    const songId = next.gigs[0]?.setlist.find(isSongEntry)?.songId;
    if (songId) {
      queuePracticeAudio({ ...get(), ...next }, findSongByRef(next.songs, songId));
    }
    if (options?.syncHost) get().joinStage(options.syncHost);
    return;
  }
  let local = { gigs: [] as Gig[] };
  try {
    local = await raceTimeout(loadLocalLibrary(), 3_000, { gigs: [] });
  } catch {
    local = { gigs: [] };
  }
  const legacyGigs = local.gigs.filter((item) => item.id !== SONG_LIBRARY_GIG_ID);
  songs = await migrateLegacySongInfo(songs, legacyGigs);
  let savedGigs = legacyGigs.map(orderOnlyGig);
  try {
    const shipped = await readShippedGigs();
    if (shipped.length) {
      const merged = mergeShippedGigs(savedGigs, shipped, songs);
      const keep = new Set(merged.map((gig) => gig.id));
      await Promise.all(savedGigs.filter((gig) => !keep.has(gig.id)).map((gig) => deleteGig(gig.id)));
      savedGigs = merged;
    }
  } catch {
    // keep local setlists if the shipped pack cannot be read
  }
  try {
    await raceTimeout(Promise.all(savedGigs.map((gig) => persistGig(orderOnlyGig(gig)))), 3_000, undefined);
    persistLibraryGigs(savedGigs);
  } catch {
    // keep using in-memory setlists if IndexedDB cannot persist them
  }
  const allGigs = listedGigs(savedGigs, songs);
  const libraryGig = allGigs[0] ?? songLibraryGig(songs);
  const storedGigId = readStored(ACTIVE_GIG_KEY);
  const gigId =
    (storedGigId && allGigs.some((item) => item.id === storedGigId)
      ? storedGigId
      : savedGigs[0]?.id) ?? SONG_LIBRARY_GIG_ID;
  const gig = allGigs.find((item) => item.id === gigId) ?? libraryGig;
  const selectedEntryId =
    gigId === SONG_LIBRARY_GIG_ID
      ? pickLibraryEntryId(songs, null, null)
      : firstSongEntryId(gig);
  writeStored(ACTIVE_GIG_KEY, gigId);
  if (gig) await controller.setShow(gig, playbackSongs(songs, fileIndex, gig));
  const showMix = gigMixerState(gig);
  engine.replaceBusMix(showMix.busMix);
  metronome.setVolume(showMix.metronomeVolume);
  set({
    ready: true,
    songs,
    fileIndex,
    gigs: allGigs,
    gigId,
    hostOk,
    selectedEntryId,
    previewTime: startAtOf(gig, selectedEntryId, songs),
    songMix,
    busMix: showMix.busMix,
    metronomeVolume: showMix.metronomeVolume,
    libraryStatus: null
  });
  if (kind === "master") {
    void get().setAudioDevice(get().audioDeviceId).then(() => preloadMetroIntro());
  }
  broadcastShow();
  if (kind === "master") shareLocalClientPack(get, true);
}

export const useMasterStore = create<MasterState>((set, get) => {
  const armContinuousNextVisual = () => {
    const state = get();
    if (
      usesFreeMetroTransport(state) ||
      isFreeSetlistMode(currentGig(state)?.performanceMode) ||
      isMetronomeSetlistMode(currentGig(state)?.performanceMode)
    ) {
      return;
    }
    if (!usesContinuousMetroTransport(state)) return;
    const gig = currentGig(state);
    const nextId = nextUnskippedSongEntryId(gig, state.selectedEntryId);
    if (!nextId) {
      if (!state.metronomePlaying) metronome.stop();
      return;
    }
    const entry = gig?.setlist.find((item) => item.entryId === nextId);
    if (!entry || !isSongEntry(entry)) return;
    const song = findSongByRef(state.songs, entry.songId);
    if (!song) return;
    try {
      const ctx = engine.prime();
      metronome.attach(ctx, engine.busNode("CUE"));
      metronome.setVolume(state.metronomeVolume);
      const parsed = parseSongInfo(song.info);
      metronome.start(metronomeTempoMap(parsed), 0, { silent: true });
    } catch {
      // visual preview is optional
    }
  };

  const endMetronome = () => {
    metronomeStartGen += 1;
    freeVisualSongId = null;
    stopMetronomeTick();
    const time = audibleMetronomeTime();
    metronome.stop();
    clearMetronomeBeat();
    const playing =
      get().playback.state === PlaybackState.Playing ||
      get().playback.state === PlaybackState.Transitioning;
    if (!playing) stopFollowClock(time);
    set({ metronomePlaying: false });
    if (get().deviceKind === "master") sendSync({ type: "Metronome", playing: false });
    armContinuousNextVisual();
  };

  const syncFreeVisualMetronome = () => {
    const state = get();
    if (state.deviceKind !== "master") return;
    if (state.metronomePlaying || !usesFreeMetroTransport(state)) {
      if (freeVisualSongId && !state.metronomePlaying) {
        freeVisualSongId = null;
        metronome.stop();
        clearMetronomeBeat();
        sendSync({ type: "Metronome", playing: false });
      }
      return;
    }
    const song = songForSelectedEntry(state);
    if (!song) {
      if (freeVisualSongId) {
        freeVisualSongId = null;
        metronome.stop();
        clearMetronomeBeat();
        sendSync({ type: "Metronome", playing: false });
      }
      return;
    }
    if (freeVisualSongId === song.id && metronome.isPlaying && metronome.isSilent) return;
    try {
      const ctx = engine.prime();
      metronome.attach(ctx, engine.busNode("CUE"));
      metronome.setVolume(state.metronomeVolume);
      const parsed = parseSongInfo(song.info);
      freeVisualSongId = song.id;
      metronome.start(metronomeTempoMap(parsed), 0, { silent: true });
    } catch (err) {
      freeVisualSongId = null;
      logger.audio("free_visual_metro_failed", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  };

  const engineSongs = (songs = get().songs, gig = currentGig(get())) =>
    playbackSongs(songs, get().fileIndex, gig, panicClickOnly(get()));

  const clearPanic = (restoreMix = true) => {
    const wasClick = panicClickOnly(get());
    set({
      panicActive: false,
      panicResumeAt: null
    });
    if (restoreMix && wasClick) controller.replaceSongs(engineSongs());
  };

  const finishPanicJump = () => {
    const { panicTargetTime } = get();
    const target = Math.max(0, panicTargetTime);
    set({
      panicActive: false,
      panicResumeAt: null,
      previewTime: target
    });
    controller.replaceSongs(engineSongs());
    controller.seek(target);
    sendSync({ type: "Seek", time: target, sent: Date.now() });
    const snap = controller.getSnapshot();
    if (snap.state === PlaybackState.Playing || snap.state === PlaybackState.Transitioning) {
      broadcastClock(snap, true);
    }
  };

  applyPanicResume = finishPanicJump;

  controller.subscribe((playback) => {
    if (get()?.deviceKind !== "master") return;
    const playing =
      playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
    if (playing) {
      setFollowClockSource(() => audibleEngineTime());
    }
    if (!playbackStoreNeedsWrite(get().playback, playback, playing)) {
      if (playing) startTick();
      return;
    }
    const entryId = playback.clock?.setlistEntryId;
    if (playback.endedToEntryId) {
      const nextId = playback.endedToEntryId;
      set({ playback });
      queueMicrotask(() => {
        if (get().deviceKind !== "master") return;
        if (get().selectedEntryId !== nextId) get().selectSetlistEntry(nextId);
        const gig = currentGig(get());
        const entry = gig?.setlist.find((item) => item.entryId === nextId);
        if (!entry || !isSongEntry(entry)) return;
        const song = findSongByRef(get().songs, entry.songId);
        const files = song ? filesForSong(song, get().fileIndex) : undefined;
        const mode = effectivePlayMode(song, files, gig?.performanceMode);
        if (mode === PlayMode.Free) return;
        if (mode === PlayMode.View) {
          if (!shouldAutoStartMetronome(song)) return;
          const startAt = songChainStartAt(song, entry);
          get().startMetronome(startAt);
          return;
        }
        if (firstSectionNamed(song?.sections, "SERBEST")) return;
        void get().playSelected();
      });
    } else if (
      playing &&
      entryId &&
      get().selectedEntryId !== entryId &&
      !followsSharedPlayhead(get()) &&
      !isFreeSetlistMode(currentGig(get())?.performanceMode) &&
      !selectedSongIsFree(get())
    ) {
      set({
        playback,
        selectedEntryId: entryId,
        previewTime: playback.clock?.time ?? 0,
        playbackPaused: false
      });
    } else {
      set({
        playback,
        ...(playing ? { playbackPaused: false } : {}),
        ...(!playing && playback.clock && !get().metronomePlaying
          ? { previewTime: playback.clock.time }
          : {})
      });
    }
    if (!playing && panicClickOnly(get())) clearPanic();
    if (playing) startTick();
  });

  return {
    ready: false,
    songs: [],
    fileIndex: {},
    gigs: [],
    gigId: null,
    librarySongId: null,
    selectedEntryId: null,
    masterEntryId: null,
    readingEntryId: null,
    justJoinedStage: false,
    previewTime: 0,
    playbackPaused: false,
    panicActive: false,
    panicTargetTime: 0,
    panicResumeAt: null,
    playback: controller.getSnapshot(),
    hostOk: false,
    deviceKind: "master",
    syncHost: null,
    syncConnected: false,
    syncPeers: [],
    joinAddress: null,
    stageName: storedStageName(),
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
    remoteSongMixer: false,
    busMix: emptyMixerBank(),
    audioOutputs: [],
    audioDeviceId: storedAudioDevice(),
    audioOutputChannels: 2,
    audioRoutingMode: storedRoutingMode(),
    audioError: null,
    audioHint: null,
    metronomePlaying: false,
    metronomeVolume: 0.7,

    load: async (kind = "master", options) => {
      // Coalescing by identity only: an in-flight load for a *different* role must not
      // satisfy this call, or the app initialises as the wrong device.
      const key = `${kind}|${options?.syncHost?.trim() ?? ""}`;
      if (loadInFlight && loadInFlightKey === key) return loadInFlight;
      loadInFlightKey = key;
      const run = runLibraryLoad(kind, options, get, set).finally(() => {
        if (loadInFlightKey === key) {
          loadInFlight = null;
          loadInFlightKey = null;
        }
      });
      loadInFlight = run;
      return run;
    },

    joinRemote: (host) => {
      if (get().deviceKind !== "remote") return;
      const value = host.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!value) return;
      localStorage.setItem(MASTER_HOST_KEY, value);
      set({
        syncHost: value,
        stageName: REMOTE_DEVICE_NAME,
        clientSession: "stage",
        setlistOpen: true
      });
      connectSync(get, set);
    },

    leaveRemote: () => {
      if (get().deviceKind !== "remote") return;
      disconnectSyncTransport();
      set({
        syncHost: null,
        clientSession: "practice",
        syncConnected: false,
        gigs: [],
        gigId: null,
        selectedEntryId: null,
        songs: [],
        remoteSongMixer: false,
        previewTime: 0,
        playback: {
          ...get().playback,
          state: PlaybackState.Idle,
          clock: null
        }
      });
    },

    remoteSelect: (entryId) => {
      if (get().deviceKind !== "remote") return;
      set({ selectedEntryId: entryId, previewTime: 0 });
      sendSync({ type: "RemoteControl", action: "select", setlistEntryId: entryId });
    },

    remotePlay: (entryId) => {
      if (get().deviceKind !== "remote") return;
      const id = entryId ?? get().selectedEntryId;
      if (!id) return;
      sendSync({ type: "RemoteControl", action: "play", setlistEntryId: id });
    },

    remoteStop: () => {
      if (get().deviceKind !== "remote") return;
      sendSync({ type: "RemoteControl", action: "stop" });
    },

    remoteSeek: (time) => {
      if (get().deviceKind !== "remote") return;
      const clamped = Math.max(0, time);
      set({ previewTime: clamped });
      sendSync({ type: "RemoteControl", action: "seek", time: clamped });
    },

    joinStage: (host) => {
      const served =
        typeof window !== "undefined" && window.location.port === String(PRACTICE_SHARE_PORT);
      const value =
        parseSyncHostname(host) || (served ? window.location.hostname : "");
      const stageName = get().stageName?.trim();
      if (!value || !stageName || isMasterBandName(stageName)) return;
      stopPracticeAudio();
      localStorage.setItem(MASTER_HOST_KEY, value);
      set({
        syncHost: value,
        stageName,
        clientSession: "stage",
        setlistOpen: true,
        masterEntryId: null,
        readingEntryId: null,
        justJoinedStage: true
      });
      connectSync(get, set);
    },

    leaveStage: () => {
      disconnectSyncTransport();
      stopFollowClock(0);
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
        syncConnected: false,
        masterEntryId: null,
        readingEntryId: null,
        justJoinedStage: false
      });
      void readPublishedGigs().then((published) => {
        // Rejoining the stage before this resolves would otherwise let the practice
        // library overwrite the live show.
        if (get().clientSession === "stage") return;
        const next = applyClientLibrary(get().songs, get().fileIndex, published, keep);
        set(next);
        queuePracticeAudio({ ...get(), ...next }, keep ? findSongByRef(get().songs, keep) : undefined);
      });
    },

    selectPracticeSong: (songId) => {
      if (clientStageLive(get())) {
        // On the stage this only opens the song to read. Nothing is touched that would take the
        // device off the show: no audio, no selection, and the master's next move clears it.
        const found = findSongByRef(get().songs, songId);
        const onSetlist = currentGig(get())?.setlist.find(
          (item) =>
            isSongEntry(item) &&
            (item.songId === songId ||
              item.songId === found?.id ||
              item.songId === found?.folder)
        );
        set({ readingEntryId: onSetlist?.entryId ?? practiceEntryId(found?.id ?? songId) });
        return;
      }
      if (get().clientSession === "stage") return;
      if (practiceBlocksSongSelect(get())) return;
      if (get().metronomePlaying) endMetronome();
      if (get().playback.state === PlaybackState.Playing) get().pausePractice();
      const gig = currentGig(get()) ?? get().gigs[0];
      const song = findSongByRef(get().songs, songId);
      const entry = gig?.setlist.find(
        (item) =>
          isSongEntry(item) &&
          (item.songId === songId || item.songId === song?.id || item.songId === song?.folder)
      );
      const id = song?.id ?? songId;
      set({
        selectedEntryId: entry?.entryId ?? practiceEntryId(id),
        previewTime: 0
      });
      queuePracticeAudio(get(), song ?? findSongByRef(get().songs, id));
    },

    reloadPracticeLibrary: async () => {
      const index = await loadPracticeLibrary();
      const published = await readPublishedGigs();
      const current = (currentGig(get()) ?? get().gigs[0])?.setlist.find(isSongEntry)?.songId;
      const songs = await withLiveHostSongMeta(index.songs);
      const next = applyClientLibrary(songs, index.fileIndex, published, current);
      set(next);
      const songId = next.gigs.find((gig) => gig.id === next.gigId)?.setlist.find(isSongEntry)?.songId;
      if (songId) {
        queuePracticeAudio({ ...get(), ...next }, findSongByRef(next.songs, songId));
      }
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
      set({ practiceBusy: "Updating library…", libraryStatus: "Updating library…" });
      try {
        const result = await syncPublishedLibrary((progress) =>
          set({ libraryStatus: progress.message, practiceBusy: progress.message })
        );
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
          body: JSON.stringify({
            gigs: publishableGigs(get())
          })
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
        const playing = !ended && practiceAudioPlaying();
        if (playing) setFollowClockSource(() => practiceAudioTime());
        else stopFollowClock(time);
        const now = performance.now();
        if (playing && !ended && now - lastPracticeStoreAt < PLAYBACK_UI_MS) return;
        lastPracticeStoreAt = now;
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
            state: playing ? PlaybackState.Playing : PlaybackState.Idle,
            clock: practiceClock(entry, time, playing)
          }
        });
        if (!ended) return;
        const store = useMasterStore.getState();
        const gig = currentGig(store);
        if (practiceShouldPlayNext(store)) {
          const nextId = nextUnskippedSongEntryId(gig, store.selectedEntryId);
          if (!nextId) return;
          store.selectSetlistEntry(nextId, { playNext: true });
          queueMicrotask(() => {
            void useMasterStore.getState().playPractice();
          });
          return;
        }
        const index = store.selectedEntryId
          ? (gig?.setlist.findIndex((item) => item.entryId === store.selectedEntryId) ?? -1)
          : -1;
        const landOn = gig && index >= 0 ? nextEndedSelectionId(gig.setlist, index) : null;
        const landEntry = landOn ? gig?.setlist.find((item) => item.entryId === landOn) : undefined;
        if (landOn && landEntry && isStopMarker(landEntry)) {
          store.selectSetlistEntry(landOn);
        }
      });
      const song = state.songs.find((item) => item.id === entry.songId);
      const files = [
        ...(state.fileIndex[entry.songId] ?? []),
        ...(song?.folder ? (state.fileIndex[song.folder] ?? []) : [])
      ];
      const kind = practiceAudioKind(state, song);
      if (!kind) return;
      if (!isPracticeAudioLoaded(entry.songId, kind)) {
        const ok = await loadPracticeAudio(entry.songId, files, kind);
        if (!ok) return;
      }
      seekPracticeAudio(state.previewTime);
      try {
        await playPracticeAudio();
      } catch {
        const ok = await loadPracticeAudio(entry.songId, files, kind);
        if (!ok) return;
        try {
          await playPracticeAudio();
        } catch {
          return;
        }
      }
      const duration = practiceAudioDuration();
      const startAt = practiceAudioTime();
      setFollowClockSource(() => practiceAudioTime());
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
          clock: practiceClock(entry, startAt, true)
        }
      });
    },

    pausePractice: () => {
      pausePracticeAudio();
      const time = practiceAudioTime();
      stopFollowClock(time);
      const entry = get().selectedEntryId
        ? currentGig(get())?.setlist.find((item) => item.entryId === get().selectedEntryId)
        : undefined;
      set({
        previewTime: time,
        playback: {
          ...get().playback,
          state: PlaybackState.Idle,
          clock:
            entry && isSongEntry(entry)
              ? practiceClock(entry, time, false)
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
      setFollowClock(time, playing);
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

    setStageName: (name) => {
      const trimmed = name?.trim() || null;
      if (trimmed) localStorage.setItem(STAGE_NAME_KEY, trimmed);
      else localStorage.removeItem(STAGE_NAME_KEY);
      set({ stageName: trimmed });
      if (trimmed && get().clientSession === "stage" && get().syncConnected) {
        announceSyncHello(get().deviceKind, trimmed);
      }
    },

    refreshJoinAddress: async () => {
      const address = await refreshNativeJoinAddress();
      if (address) set({ joinAddress: address });
    },

    setMasterPage: (page) => set({ masterPage: page }),
    refreshAudioOutputs: async () => {
      try {
        const channels = engine.refreshOutputChannels();
        const outputs = await engine.listOutputs();
        const routing = engine.getRoutingState();
        set({
          audioOutputs: outputs,
          audioOutputChannels: channels || routing.channels,
          audioError: null
        });
      } catch (error) {
        set({ audioError: error instanceof Error ? error.message : String(error) });
      }
    },
    recheckAudioOutputs: async () => {
      try {
        const channels = engine.refreshOutputChannels();
        if (channels >= 3) {
          const requestedMode = get().audioRoutingMode;
          let mode = engine.getRoutingState().routingMode;
          if (requestedMode !== mode) {
            try {
              engine.setRoutingMode(requestedMode);
              mode = requestedMode;
            } catch {
              // Keep the live mode if the card still cannot host it.
            }
          }
          const outputs = await engine.listOutputs();
          set({
            audioOutputs: outputs,
            audioOutputChannels: channels,
            audioRoutingMode: mode,
            audioError: null,
            audioHint: null
          });
          return;
        }
        if (audioGraphLive(get())) {
          const outputs = await engine.listOutputs();
          set({
            audioOutputs: outputs,
            audioOutputChannels: channels,
            audioError: null,
            audioHint: "Stop playback, then Recheck to apply a new speaker layout."
          });
          return;
        }
        await get().setAudioDevice(get().audioDeviceId, { recreateIfStereo: true });
      } catch (error) {
        set({ audioError: error instanceof Error ? error.message : String(error) });
      }
    },
    setAudioDevice: async (deviceId, opts) => {
      if (get().deviceKind === "client") return;
      const sameDevice =
        get().audioDeviceId === deviceId && engine.getRoutingState().deviceId === deviceId;
      const recreateIfStereo = opts?.recreateIfStereo ?? !sameDevice;
      if (!sameDevice || recreateIfStereo) {
        controller.stopImmediate();
        metronome.stop();
        clearMetronomeBeat();
        if (get().deviceKind === "master") sendSync({ type: "Metronome", playing: false });
        set({ metronomePlaying: false, audioError: null, audioHint: null });
      }
      try {
        const selected = await engine.selectOutput(deviceId, { recreateIfStereo });
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
          audioError: null,
          audioHint: null
        });
        preloadMetroIntro();
      } catch (error) {
        set({ audioError: error instanceof Error ? error.message : String(error) });
      }
    },
    setAudioRoutingMode: (mode) => {
      if (get().deviceKind === "client") return;
      try {
        engine.setRoutingMode(mode);
        localStorage.setItem(AUDIO_ROUTING_KEY, String(mode));
        set({ audioRoutingMode: mode, audioError: null, audioHint: null });
      } catch (error) {
        set({ audioError: error instanceof Error ? error.message : String(error) });
      }
    },
    toggleSetlistOpen: () => set((state) => ({ setlistOpen: !state.setlistOpen })),
    toggleEditOpen: () => set((state) => ({ editOpen: !state.editOpen })),
    setStageZoom: (value) =>
      set((state) => {
        if (!isStageContentPage(state.masterPage)) return {};
        const page = state.masterPage;
        const zoom = clampStageZoom(value);
        if (zoom === state.stageZooms[page]) return {};
        return { stageZooms: { ...state.stageZooms, [page]: zoom } };
      }),

    setSongMixStrip: (songId, channel, patch) => {
      if (get().deviceKind === "remote") {
        const current = get().songMix[songId] ?? emptyMixerBank();
        const next = { ...current, [channel]: { ...current[channel], ...patch } };
        set({ songMix: { ...get().songMix, [songId]: next } });
        sendSync({ type: "RemoteMixer", target: "song", songId, channel, patch });
        return;
      }
      if (get().deviceKind !== "master") return;
      const id = findSongByRef(get().songs, songId)?.id ?? songId;
      const bank = engine.setSongStrip(id, channel, patch);
      set({ songMix: { ...get().songMix, [id]: bank } });
      scheduleSongMixSave(id, get);
      broadcastMixer(patch.muted !== undefined || patch.solo !== undefined);
    },

    setBusMixStrip: (channel, patch) => {
      if (get().deviceKind === "remote") {
        const current = get().busMix;
        const busMix = { ...current, [channel]: { ...current[channel], ...patch } };
        set({ busMix });
        sendSync({ type: "RemoteMixer", target: "bus", channel, patch });
        return;
      }
      if (get().deviceKind !== "master") return;
      const busMix = engine.setBusStrip(channel, patch);
      set({ busMix });
      scheduleGigMixSave(get, set);
      broadcastMixer(patch.muted !== undefined || patch.solo !== undefined);
    },

    setGigId: async (id) => {
      if (get().deviceKind === "client") return;
      if (get().gigId === id) return;
      flushGigMixSave(get, set);
      const state = get();
      const leaving = currentGig(state);
      const librarySongId = isSongLibraryGig(leaving)
        ? librarySongIdFromEntry(leaving, state.selectedEntryId) ?? state.librarySongId
        : state.librarySongId;
      const fallbackSongId = librarySongIdFromEntry(leaving, state.selectedEntryId);
      const gig =
        state.gigs.find((item) => item.id === id) ??
        (id === SONG_LIBRARY_GIG_ID ? songLibraryGig(state.songs) : undefined);
      if (!gig) return;
      const selectedEntryId =
        id === SONG_LIBRARY_GIG_ID
          ? pickLibraryEntryId(state.songs, librarySongId, fallbackSongId)
          : firstSongEntryId(gig);
      await controller.setShow(gig, playbackSongs(state.songs, state.fileIndex, gig));
      applyGigMix(gig, set);
      set({
        gigId: id,
        librarySongId,
        selectedEntryId,
        previewTime: startAtOf(gig, selectedEntryId, state.songs)
      });
      writeStored(ACTIVE_GIG_KEY, id);
      broadcastShow();
      broadcastSelection();
      shareLocalClientPack(get);
    },

    updateGig: async (recipe) => {
      if (get().deviceKind === "client") {
        if (!elifCanEditSetlist(get())) return;
        const state = get();
        const { gigs, gigId, selectedEntryId } = state;
        const current = gigs.find((item) => item.id === gigId);
        if (!current) return;
        const next = recipe(current);
        if (!elifPlacementValid(next.setlist)) return;
        const stillThere = selectedEntryId
          ? next.setlist.some((entry) => entry.entryId === selectedEntryId)
          : false;
        set({
          gigs: gigs.map((item) => (item.id === next.id ? next : item)),
          selectedEntryId: stillThere ? selectedEntryId : firstSongEntryId(next)
        });
        sendSync({
          type: "SetlistEdit",
          gigId: next.id,
          deviceName: get().stageName ?? "",
          setlist: remoteGigEntries(next, get().songs)
        });
        return;
      }
      const state = get();
      const { gigs, gigId, songs, selectedEntryId } = state;
      const current = gigs.find((item) => item.id === gigId);
      if (!current || isSongLibraryGig(current)) return;
      const next = recipe(current);
      const nextGigs = gigs.map((item) => (item.id === next.id ? next : item));
      const sameOrder =
        current.setlist.length === next.setlist.length &&
        current.setlist.every((entry, index) => entry.entryId === next.setlist[index]?.entryId);
      const stillThere = selectedEntryId
        ? next.setlist.some((entry) => entry.entryId === selectedEntryId)
        : false;
      const liveEntryId = state.playback.clock?.setlistEntryId;
      const keepPlayback =
        setlistChangeKeepsPlayback(state) &&
        (!liveEntryId || next.setlist.some((entry) => entry.entryId === liveEntryId));
      set({
        gigs: nextGigs,
        selectedEntryId: stillThere ? selectedEntryId : firstSongEntryId(next),
        previewTime: stillThere ? state.previewTime : startAtOf(next, firstSongEntryId(next), songs)
      });
      const nextSongs = playbackSongs(songs, get().fileIndex, next);
      if (sameOrder || keepPlayback) {
        controller.replaceSongs(nextSongs);
        controller.replaceShow(next);
      } else {
        await controller.setShow(next, nextSongs);
      }
      broadcastShow();
      await saveGig(next);
      if (!sameOrder) shareLocalClientPack(get);
    },

    saveSetlist: async (name, initialSongId) => {
      if (get().deviceKind === "client") return false;
      const trimmed = name.trim();
      if (!trimmed || !initialSongId || setlistNameTaken(get().gigs, trimmed)) return false;
      flushGigMixSave(get, set);
      const { gigs, songs, busMix, metronomeVolume } = get();
      const gig: Gig = {
        id: createId("gig"),
        name: trimmed,
        date: new Date().toISOString().slice(0, 10),
        musicians: [],
        setlist: [
          {
            type: "song",
            entryId: createId("entry"),
            songId: initialSongId
          }
        ],
        busMix,
        metronomeVolume
      };
      await saveGig(gig);
      await controller.setShow(gig, playbackSongs(songs, get().fileIndex, gig));
      applyGigMix(gig, set);
      set({
        gigs: listedGigs([...gigs, gig], songs),
        gigId: gig.id,
        selectedEntryId: firstSongEntryId(gig),
        previewTime: startAtOf(gig, firstSongEntryId(gig), songs)
      });
      writeStored(ACTIVE_GIG_KEY, gig.id);
      broadcastShow();
      broadcastSelection();
      shareLocalClientPack(get);
      return true;
    },

    renameSetlist: async (name) => {
      if (get().deviceKind === "client") return false;
      const trimmed = name.trim();
      const current = currentGig(get());
      if (!current || isSongLibraryGig(current)) return false;
      if (!trimmed || setlistNameTaken(get().gigs, trimmed, current.id)) return false;
      if (current.name === trimmed) return true;
      const next = { ...current, name: trimmed };
      await saveGig(next);
      set({ gigs: get().gigs.map((item) => (item.id === next.id ? next : item)) });
      broadcastShow();
      shareLocalClientPack(get);
      return true;
    },

    deleteCurrentSetlist: async () => {
      if (get().deviceKind === "client") return;
      window.clearTimeout(gigMixSaveTimer);
      gigMixSaveTimer = 0;
      gigMixSaveGigId = null;
      const { gigs, gigId, songs } = get();
      if (!gigId || gigId === SONG_LIBRARY_GIG_ID) return;
      await deleteGig(gigId);
      const remaining = listedGigs(
        gigs.filter((item) => item.id !== gigId),
        songs
      );
      const next =
        remaining.find((item) => !isSongLibraryGig(item)) ?? remaining[0];
      if (next) {
        const selectedEntryId = isSongLibraryGig(next)
          ? pickLibraryEntryId(songs, get().librarySongId, null)
          : firstSongEntryId(next);
        await controller.setShow(next, playbackSongs(songs, get().fileIndex, next));
        applyGigMix(next, set);
        set({
          gigs: remaining,
          gigId: next.id,
          selectedEntryId,
          previewTime: startAtOf(next, selectedEntryId, songs)
        });
        writeStored(ACTIVE_GIG_KEY, next.id);
        broadcastShow();
        broadcastSelection();
        shareLocalClientPack(get);
        return;
      }
      const library = songLibraryGig(songs);
      await controller.setShow(library, playbackSongs(songs, get().fileIndex, library));
      applyGigMix(library, set);
      set({
        gigs: [library],
        gigId: library.id,
        selectedEntryId: pickLibraryEntryId(songs, get().librarySongId, null),
        previewTime: 0
      });
      writeStored(ACTIVE_GIG_KEY, library.id);
      broadcastShow();
      shareLocalClientPack(get);
    },

    selectSetlistEntry: (entryId, options) => {
      if (
        stageConnectOn(get()) &&
        !isFreeSetlistMode(currentGig(get())?.performanceMode) &&
        !songEntryIsFree(get(), entryId)
      ) {
        // With the set stopped anyone may look down the list, and their page goes with them.
        // Mid-number the show owns the page, so only Elif may move her selection then, to work on
        // the running order; for the rest the tap just puts the library down. Either way it ends
        // the reading, which is how a band member comes back to the show.
        if (
          get().deviceKind === "client" &&
          showIsRunning(get()) &&
          !elifCanEditSetlist(get())
        ) {
          set({ readingEntryId: null });
          return;
        }
        set({ selectedEntryId: entryId, readingEntryId: null });
        if (get().deviceKind === "master") broadcastSelection();
        syncFreeVisualMetronome();
        return;
      }
      if (get().deviceKind === "client") {
        if (practiceBlocksSongSelect(get()) && !options?.playNext) return;
        if (get().metronomePlaying) endMetronome();
        if (clientPracticeMode(get()) && get().playback.state === PlaybackState.Playing) {
          get().pausePractice();
        }
        const gig = currentGig(get());
        const entry = gig?.setlist.find((item) => item.entryId === entryId);
        set({
          selectedEntryId: entryId,
          readingEntryId: null,
          previewTime: startAtOf(gig, entryId, get().songs)
        });
        if (clientPracticeMode(get()) && entry && isSongEntry(entry) && practicePlaysMasterMix(get())) {
          queuePracticeAudio(get(), findSongByRef(get().songs, entry.songId));
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
      if (playing || get().playbackPaused) {
        controller.stopImmediate();
        if (stageConnectOn(get()) && songEntryIsFree(get(), entryId)) {
          sendSync({ type: "Stop" });
        }
      }
      if (get().metronomePlaying) {
        metronome.stop();
        clearMetronomeBeat();
        if (get().deviceKind === "master") sendSync({ type: "Metronome", playing: false });
      }
      clearPanic(false);
      const gig = currentGig(get());
      const librarySongId = isSongLibraryGig(gig)
        ? librarySongIdFromEntry(gig, entryId) ?? get().librarySongId
        : get().librarySongId;
      set({
        selectedEntryId: entryId,
        librarySongId,
        previewTime: startAtOf(gig, entryId, get().songs),
        metronomePlaying: false,
        playbackPaused: false,
        panicActive: false,
        panicResumeAt: null
      });
      controller.replaceSongs(engineSongs());
      broadcastSelection();
      syncFreeVisualMetronome();
    },

    seek: (time) => {
      if (get().deviceKind === "client") {
        if (clientPracticeMode(get())) {
          if (practicePlaysMasterMix(get()) || get().playback.state === PlaybackState.Playing) {
            get().seekPractice(time);
            return;
          }
          const song = songForSelectedEntry(get());
          const duration = song?.duration ?? time;
          const clamped = Math.max(0, Math.min(time, duration));
          set({ previewTime: clamped });
          if (get().metronomePlaying) get().startMetronome(clamped);
          return;
        }
        if (!clientStageLive(get())) {
          const song = songForSelectedEntry(get());
          const duration = song?.duration ?? time;
          set({ previewTime: Math.max(0, Math.min(time, duration)) });
        }
        return;
      }
      const { selectedEntryId, songs } = get();
      const gig = currentGig(get());
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
      if (!isFreeSetlistMode(gig?.performanceMode) && !selectedSongIsFree(get())) {
        sendSync({ type: "Seek", time: clamped, sent: Date.now() });
      }
    },

    playSelected: async () => {
      if (get().deviceKind === "client") return;
      cancelFadeStop();
      engine.prime();
      get().stopMetronome();
      const { selectedEntryId } = get();
      const gig = currentGig(get());
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
      const files = song ? filesForSong(song, get().fileIndex) : undefined;
      if (usesFreeMetroTransport(get()) || effectivePlayMode(song, files, gig.performanceMode) === PlayMode.Free) {
        return;
      }
      if (effectivePlayMode(song, files, gig.performanceMode) === PlayMode.View) {
        get().startMetronome(get().previewTime);
        return;
      }
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
      set({ playbackPaused: false });
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
      set({ playbackPaused: false });
      startTick();
      broadcastPlay();
    },

    pause: () => {
      if (get().deviceKind === "client") return;
      if (get().metronomePlaying) {
        endMetronome();
        return;
      }
      const time = controller.getClock()?.time ?? get().previewTime;
      controller.pause();
      stopFollowClock(time);
      clearPanic();
      set({ previewTime: time, playbackPaused: true });
      broadcastClock(controller.getSnapshot(), true);
    },

    stop: () => {
      if (get().deviceKind === "client") return;
      cancelFadeStop();
      stopMetronomeTick();
      metronome.stop();
      clearMetronomeBeat();
      if (get().deviceKind === "master") sendSync({ type: "Metronome", playing: false });
      controller.stopImmediate();
      stopFollowClock(0);
      clearPanic(false);
      set({
        previewTime: 0,
        metronomePlaying: false,
        playbackPaused: false,
        panicActive: false,
        panicResumeAt: null
      });
      controller.replaceSongs(engineSongs());
      sendSync({ type: "Stop" });
    },

    fadeStop: () => {
      if (get().deviceKind === "client" || fadeStopTimer) return;
      const durationSeconds = 1.5;
      engine.fadeOut(durationSeconds);
      metronome.fadeOut(durationSeconds);
      fadeStopTimer = window.setTimeout(() => {
        fadeStopTimer = 0;
        stopMetronomeTick();
        metronome.stop();
        clearMetronomeBeat();
        if (get().deviceKind === "master") sendSync({ type: "Metronome", playing: false });
        controller.stopImmediate();
        engine.resetFadeOut();
        metronome.resetFadeOut();
        clearPanic(false);
        set({
          previewTime: 0,
          metronomePlaying: false,
          playbackPaused: false,
          panicActive: false,
          panicResumeAt: null
        });
        controller.replaceSongs(engineSongs());
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

    startMetronome: (fromTime = 0) => {
      const state = get();
      if (usesFreeMetroTransport(state)) return;
      const practiceClient = clientPracticeMode(state);
      if (state.deviceKind === "client" && !practiceClient) return;
      cancelFadeStop();
      const song = songForSelectedEntry(state);
      if (!song) return;
      const time = Math.max(0, fromTime);
      const tailPlaying =
        !practiceClient &&
        (state.playback.state === PlaybackState.Playing ||
          state.playback.state === PlaybackState.Transitioning) &&
        state.playback.outgoingDeck != null;
      if (practiceClient) {
        pausePracticeAudio();
        stopFollowClock(time);
      } else if (!tailPlaying) {
        controller.stopImmediate();
        controller.seek(time);
      }
      const startId = ++metronomeStartGen;
      try {
        const ctx = engine.prime();
        metronome.attach(ctx, engine.busNode("CUE"));
        metronome.setVolume(state.metronomeVolume);
        const parsed = parseSongInfo(song.info);
        const silent = setlistModeIsSilent(currentGig(state)?.performanceMode);
        const begin = () => {
          if (startId !== metronomeStartGen) return;
          set({
            metronomePlaying: true,
            previewTime: time,
            playbackPaused: false,
            ...(practiceClient
              ? {
                  playback: {
                    ...get().playback,
                    state: PlaybackState.Idle,
                    clock: null
                  }
                }
              : {})
          });
          metronome.start(metronomeTempoMap(parsed), time, { silent, intro: !silent });
          setFollowClockSource(() => audibleMetronomeTime());
          startMetronomeTick();
        };
        if (silent || metronome.introPrepared(ctx)) {
          begin();
          return;
        }
        void metronome.ensureIntro(ctx).then(begin, (err) => {
          if (startId !== metronomeStartGen) return;
          begin();
          logger.audio("metronome_intro_failed", {
            error: err instanceof Error ? err.message : String(err)
          });
        });
      } catch (err) {
        stopMetronomeTick();
        metronome.stop();
        clearMetronomeBeat();
        set({ metronomePlaying: false });
        armContinuousNextVisual();
        logger.audio("metronome_start_failed", {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    },

    stopMetronome: () => endMetronome(),
    syncFreeVisualMetronome,

    previewContinuousNextMetronome: () => {
      if (get().metronomePlaying) return;
      if (!usesContinuousMetroTransport(get())) {
        metronome.stop();
        return;
      }
      armContinuousNextVisual();
    },

    setMetronomeVolume: (value) => {
      const next = Math.max(0, Math.min(1, value));
      if (get().deviceKind === "remote") {
        set({ metronomeVolume: next });
        sendSync({ type: "RemoteMixer", target: "metro", volume: next });
        return;
      }
      if (get().deviceKind !== "master") return;
      metronome.setVolume(next);
      set({ metronomeVolume: next });
      scheduleGigMixSave(get, set);
      broadcastMixer();
    },

    saveSongInfo: async (songId, info) => {
      if (get().deviceKind === "client") return;
      const previousMode = parseSongInfo(get().songs.find((song) => song.id === songId)?.info).playMode;
      const parsed = parseSongInfo(info);
      const songs = get().songs.map((song) =>
        song.id === songId ? { ...song, kita: parsed.kita, info: parsed } : song
      );
      controller.replaceSongs(
        playbackSongs(songs, get().fileIndex, get().gigs.find((item) => item.id === get().gigId), panicClickOnly(get()))
      );
      set({ songs });
      void writeSongInfo(songId, parsed).catch(() => undefined);
      void updateSongSettings(songId, (current) => ({
        ...current,
        metroNotes: parsed.metroNotes
      })).catch(() => undefined);
      try {
      const { selectedEntryId, gigs, gigId, metronomePlaying } = get();
      const gig = gigs.find((item) => item.id === gigId);
      const entry = selectedEntryId
        ? gig?.setlist.find((item) => item.entryId === selectedEntryId)
        : undefined;
      if (!entry || !isSongEntry(entry) || entry.songId !== songId || !gig) {
        if (metronomePlaying) {
          metronome.start(metronomeTempoMap(parsed), metronome.time);
        }
        return;
      }
      const index = gig.setlist.indexOf(entry);
      const audioPlaying =
        get().playback.state === PlaybackState.Playing ||
        get().playback.state === PlaybackState.Transitioning;
      if (previousMode === parsed.playMode) {
        if (metronomePlaying) {
          metronome.start(metronomeTempoMap(parsed), metronome.time);
        }
        return;
      }
      const time = audioPlaying
        ? (get().playback.clock?.time ?? get().previewTime)
        : metronomePlaying
          ? metronome.time
          : get().previewTime;
      if (audioPlaying || metronomePlaying) {
        if (parsed.playMode === PlayMode.View) {
          get().startMetronome(0);
          return;
        }
        if (parsed.playMode === PlayMode.Free) {
          get().stop();
          return;
        }
        if (audioPlaying && isDeckPlayMode(previousMode)) {
          return;
        }
        stopMetronomeTick();
        metronome.stop();
        set({ metronomePlaying: false, previewTime: time });
        if (!deckReadyAt(index)) {
          await controller.selectIndex(index);
        }
        const after = controller.getSnapshot();
        if (after.currentIndex !== index || after.state === PlaybackState.Error) return;
        controller.seek(time);
        await controller.play();
        startTick();
        broadcastPlay();
        return;
      }
      if (isDeckPlayMode(parsed.playMode) && !deckReadyAt(index)) {
        await controller.selectIndex(index);
      }
      } finally {
        syncFreeVisualMetronome();
      }
    },

    setSetlistPerformanceMode: async (mode) => {
      if (get().deviceKind === "client") return;
      const current = currentGig(get());
      if (!current) return;
      const previous = parseSetlistPerformanceMode(current.performanceMode);
      const nextMode = parseSetlistPerformanceMode(mode);
      if (previous === nextMode) return;
      const next = { ...current, performanceMode: nextMode };
      if (!isSongLibraryGig(current)) await saveGig(next);
      set({ gigs: get().gigs.map((item) => (item.id === next.id ? next : item)) });
      controller.replaceSongs(playbackSongs(get().songs, get().fileIndex, next, panicClickOnly(get())));
      broadcastShow();
      shareLocalClientPack(get);
      const { selectedEntryId, songs, fileIndex, metronomePlaying, playback } = get();
      const entry = selectedEntryId
        ? next.setlist.find((item) => item.entryId === selectedEntryId)
        : undefined;
      if (!entry || !isSongEntry(entry)) return;
      const song = songs.find((item) => item.id === entry.songId);
      const files = song ? fileIndex[song.id] : undefined;
      const previousEffective = effectivePlayMode(song, files, previous);
      const effective = effectivePlayMode(song, files, nextMode);
      const audioPlaying =
        playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
      const index = next.setlist.indexOf(entry);
      if (!audioPlaying && !metronomePlaying) {
        if (isDeckPlayMode(effective) && !deckReadyAt(index)) {
          await controller.selectIndex(index);
        }
        if (usesContinuousMetroTransport(get()) && !isFreeSetlistMode(nextMode)) {
          get().previewContinuousNextMetronome();
        }
        syncFreeVisualMetronome();
        return;
      }
      if (effective === PlayMode.Free || isFreeSetlistMode(nextMode)) {
        get().stop();
        syncFreeVisualMetronome();
        return;
      }
      if (effective === PlayMode.View) {
        clearPanic();
        get().startMetronome(0);
        return;
      }
      if (audioPlaying && isDeckPlayMode(previousEffective) && isDeckPlayMode(effective)) {
        return;
      }
      stopMetronomeTick();
      metronome.stop();
      set({ metronomePlaying: false, previewTime: 0 });
      if (!deckReadyAt(index)) await controller.selectIndex(index);
      const after = controller.getSnapshot();
      if (after.currentIndex !== index || after.state === PlaybackState.Error) return;
      controller.seek(0);
      await controller.play();
      startTick();
      broadcastPlay();
    },

    setPanicTarget: (time) => {
      const song = selectedSongOf(get());
      const snapped = snapToSectionBoundary(song?.sections, time);
      set({ panicTargetTime: snapped });
      broadcastClock(controller.getSnapshot(), true);
    },

    setPanic: (on) => {
      if (get().deviceKind === "client") return;
      const state = get();
      const gig = currentGig(state);
      const entry = state.selectedEntryId
        ? gig?.setlist.find((item) => item.entryId === state.selectedEntryId)
        : undefined;
      const song =
        entry && isSongEntry(entry) ? state.songs.find((item) => item.id === entry.songId) : undefined;
      const files = song ? state.fileIndex[song.id] : undefined;
      const mode = effectivePlayMode(song, files, gig?.performanceMode);
      if (!song || !isDeckPlayMode(mode) || !hasClickFlac(song, files)) return;
      if (on) {
        if (state.panicActive || state.panicResumeAt != null) return;
        if (!songPlaying(state)) return;
        const time = state.playback.clock?.time ?? state.previewTime;
        const starts = measureStartTimes(song.tempoMap, song.duration);
        const target = panicDefaultTarget(song.sections, starts, time);
        set({
          panicActive: true,
          panicTargetTime: target,
          panicResumeAt: null
        });
        controller.replaceSongs(engineSongs());
        broadcastClock(controller.getSnapshot(), true);
        return;
      }
      if (!state.panicActive && state.panicResumeAt == null) return;
      const playing =
        state.playback.state === PlaybackState.Playing ||
        state.playback.state === PlaybackState.Transitioning;
      if (!playing) {
        finishPanicJump();
        return;
      }
      const time = state.playback.clock?.time ?? state.previewTime;
      const starts = measureStartTimes(song.tempoMap, song.duration);
      const resumeAt = nextMeasureStart(starts, time, song.duration);
      set({ panicActive: false, panicResumeAt: resumeAt });
    }
  };
});

function selectedSongOf(state: MasterState): Song | undefined {
  const gig = currentGig(state);
  const entry = state.selectedEntryId
    ? gig?.setlist.find((item) => item.entryId === state.selectedEntryId)
    : undefined;
  return entry && isSongEntry(entry)
    ? state.songs.find((item) => item.id === entry.songId)
    : undefined;
}

export function currentGig(state: MasterState): Gig | undefined {
  return (
    state.gigs.find((gig) => gig.id === state.gigId) ??
    (state.gigId === SONG_LIBRARY_GIG_ID ? songLibraryGig(state.songs) : undefined)
  );
}

export function selectableGigs(state: MasterState): Gig[] {
  return listedGigs(state.gigs, state.songs);
}
