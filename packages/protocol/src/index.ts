export const PROTOCOL_VERSION = 1;

export type DeviceKind = "master" | "client" | "remote";

export const REMOTE_DEVICE_NAME = "REMOTE";

export function isRemoteKind(kind: string | undefined): boolean {
  return kind === "remote";
}

export function isRemotePeer(peer: { deviceKind?: string; deviceName?: string }): boolean {
  return peer.deviceKind === "remote";
}

export interface HelloMessage {
  type: "Hello";
  protocolVersion: number;
  deviceKind: DeviceKind;
  deviceName: string;
  deviceId: string;
  sessionId?: string;
}

export function masterSessionUpdate(
  previous: string | null,
  incoming: string | undefined
): { sessionId: string | null; restarted: boolean } {
  const sessionId = incoming?.trim() || null;
  if (!sessionId) return { sessionId: previous, restarted: false };
  return { sessionId, restarted: Boolean(previous && previous !== sessionId) };
}

export interface SyncPeer {
  deviceId: string;
  deviceKind: DeviceKind;
  deviceName: string;
}

export interface PeersMessage {
  type: "Peers";
  peers: SyncPeer[];
  masterSessionId?: string;
}

export interface RoleAssignmentMessage {
  type: "RoleAssignment";
  musicianId?: string;
  musicianName?: string;
  role: string;
}

export type LoadGigSetlistEntry =
  | {
      type: "song";
      entryId: string;
      songId: string;
      title?: string;
      duration?: number;
      finishMode?: "STOP" | "PLAY_NEXT";
      playMode?: "VIEW" | "PLAYBACK" | "CLICK_ONLY" | "FREE";
      skipped?: boolean;
      startAt?: number;
    }
  | {
      type: "break" | "talk" | "costume_change" | "set_marker";
      entryId: string;
      label: string;
      notes?: string;
    };

export interface LoadGigMessage {
  type: "LoadGig";
  gigId: string;
  name: string;
  setlistEntryIds: string[];
  setlist?: LoadGigSetlistEntry[];
  selectedEntryId?: string;
  performanceMode?:
    | "FOLLOW_SONG_INFO"
    | "CLICK_ONLY"
    | "METRONOME_CONTINUOUS"
    | "FREE";
  stageNames?: string[];
}

export interface SetlistEditMessage {
  type: "SetlistEdit";
  gigId: string;
  deviceName: string;
  setlist: LoadGigSetlistEntry[];
}

export interface LoadSongMessage {
  type: "LoadSong";
  songId: string;
  setlistEntryId: string;
  title: string;
}

export interface PrepareSongMessage {
  type: "PrepareSong";
  songId: string;
}

export interface PlayMessage {
  type: "Play";
  songId: string;
  setlistEntryId: string;
  at: number;
  /** Master wall clock (Date.now) when the packet was sent. */
  sent?: number;
}

export interface StopMessage {
  type: "Stop";
}

export interface SeekMessage {
  type: "Seek";
  time: number;
  /** Master wall clock (Date.now) when the packet was sent. */
  sent?: number;
}

export interface PositionMessage {
  type: "Position";
  songId: string;
  setlistEntryId: string;
  time: number;
  measure: number;
  beat: number;
  section?: string;
  playing: boolean;
  nextSongId?: string;
  finishMode?: "STOP" | "PLAY_NEXT";
  /** Master wall clock (Date.now) when the packet was sent. */
  sent?: number;
}

export interface MetronomeMessage {
  type: "Metronome";
  /** False stops the pulse. Omitted on ticks. */
  playing?: boolean;
  /** Seconds until the click should paint. Master schedules ahead; clients wait this long. */
  in?: number;
  /** Monotonic pulse id. Clients ignore older or echoed ids. */
  seq?: number;
}

export interface SectionChangedMessage {
  type: "SectionChanged";
  section: string;
}

export interface NextSongMessage {
  type: "NextSong";
  songId: string;
  setlistEntryId: string;
}

export interface ClientStatusMessage {
  type: "ClientStatus";
  deviceId: string;
  ready: boolean;
  missingAssets: string[];
}

export interface ErrorMessage {
  type: "Error";
  message: string;
}

export type RemoteControlAction = "select" | "play" | "stop" | "seek";

export interface RemoteControlMessage {
  type: "RemoteControl";
  action: RemoteControlAction;
  setlistEntryId?: string;
  time?: number;
}

export interface RemoteMixStrip {
  gainDb: number;
  muted: boolean;
  solo: boolean;
}

export type RemoteMixBank = Record<string, RemoteMixStrip>;

export interface MixerStateMessage {
  type: "MixerState";
  busMix: RemoteMixBank;
  metronomeVolume: number;
  songId?: string;
  songTitle?: string;
  songMix?: RemoteMixBank;
  songChannels?: string[];
  playMode?: "VIEW" | "PLAYBACK" | "CLICK_ONLY" | "FREE";
  songMixer?: boolean;
}

export interface RemoteMixerMessage {
  type: "RemoteMixer";
  target: "song" | "bus" | "metro";
  songId?: string;
  channel?: string;
  patch?: Partial<RemoteMixStrip>;
  volume?: number;
}

export type SyncMessage =
  | HelloMessage
  | PeersMessage
  | RoleAssignmentMessage
  | LoadGigMessage
  | SetlistEditMessage
  | LoadSongMessage
  | PrepareSongMessage
  | PlayMessage
  | StopMessage
  | SeekMessage
  | PositionMessage
  | MetronomeMessage
  | SectionChangedMessage
  | NextSongMessage
  | ClientStatusMessage
  | RemoteControlMessage
  | MixerStateMessage
  | RemoteMixerMessage
  | ErrorMessage;

export function parseSyncMessage(raw: string): SyncMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || !("type" in value)) {
      return null;
    }
    const type = (value as { type: unknown }).type;
    if (typeof type !== "string") return null;
    return value as SyncMessage;
  } catch {
    return null;
  }
}
