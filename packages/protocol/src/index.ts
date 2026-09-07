export const PROTOCOL_VERSION = 1;

export type DeviceKind = "master" | "client";

export interface HelloMessage {
  type: "Hello";
  protocolVersion: number;
  deviceKind: DeviceKind;
  deviceName: string;
  deviceId: string;
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
      finishMode: "STOP" | "PLAY_NEXT";
      playMode?: "VIEW" | "PLAYBACK";
      skipped?: boolean;
      startAt?: number;
    }
  | {
      type: "break" | "talk" | "costume_change" | "set_marker";
      entryId: string;
      label: string;
    };

export interface LoadGigMessage {
  type: "LoadGig";
  gigId: string;
  name: string;
  setlistEntryIds: string[];
  setlist?: LoadGigSetlistEntry[];
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
}

export interface StopMessage {
  type: "Stop";
}

export interface SeekMessage {
  type: "Seek";
  time: number;
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

export type SyncMessage =
  | HelloMessage
  | RoleAssignmentMessage
  | LoadGigMessage
  | LoadSongMessage
  | PrepareSongMessage
  | PlayMessage
  | StopMessage
  | SeekMessage
  | PositionMessage
  | SectionChangedMessage
  | NextSongMessage
  | ClientStatusMessage
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
