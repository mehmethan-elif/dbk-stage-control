import {
  MIXER_CHANNELS,
  PlayMode,
  isSongEntry,
  mixerFileName,
  normalizeSong,
  parseMetronomeVolume,
  parseMixerBank,
  songHasMixerFile,
  type Gig,
  type MixStripState,
  type MixerBank,
  type MixerChannel,
  type Song
} from "@dbk/core";
import type {
  LoadGigSetlistEntry,
  MixerStateMessage,
  RemoteControlMessage,
  RemoteMixerMessage
} from "@dbk/protocol";
import { findSongByRef } from "./song-library";

export function remoteGigEntries(gig: Gig, songs: readonly Song[]): LoadGigSetlistEntry[] {
  return gig.setlist.map((entry) => {
    if (isSongEntry(entry)) {
      const song = findSongByRef(songs, entry.songId);
      const title = song?.title?.trim() || song?.folder?.trim();
      const duration = song?.duration ?? 0;
      return {
        type: "song" as const,
        entryId: entry.entryId,
        songId: entry.songId,
        ...(entry.skipped ? { skipped: true } : {}),
        ...(title ? { title } : {}),
        ...(duration > 0 ? { duration } : {})
      };
    }
    return {
      type: entry.type,
      entryId: entry.entryId,
      label: entry.label,
      ...(entry.notes?.trim() ? { notes: entry.notes } : {})
    };
  });
}

export function stubSongsFromRemoteSetlist(setlist: readonly LoadGigSetlistEntry[]): Song[] {
  const byId = new Map<string, Song>();
  for (const entry of setlist) {
    if (entry.type !== "song") continue;
    byId.set(
      entry.songId,
      normalizeSong({
        id: entry.songId,
        title: entry.title?.trim() || entry.songId,
        duration: entry.duration ?? 0
      })
    );
  }
  return [...byId.values()];
}

export function applyRemoteControl(
  message: RemoteControlMessage,
  actions: {
    selectSetlistEntry: (entryId: string) => void;
    playSelected: () => void | Promise<void>;
    stop: () => void;
    seek: (time: number) => void;
    selectedEntryId: string | null;
    playing: boolean;
    playingEntryId: string | null;
  }
): void {
  if (message.action === "stop") {
    actions.stop();
    return;
  }
  if (message.action === "seek") {
    if (typeof message.time === "number" && Number.isFinite(message.time)) {
      actions.seek(Math.max(0, message.time));
    }
    return;
  }
  if (message.action === "select") {
    if (message.setlistEntryId) actions.selectSetlistEntry(message.setlistEntryId);
    return;
  }
  if (message.action !== "play") return;
  const entryId = message.setlistEntryId ?? actions.selectedEntryId;
  if (entryId && entryId !== actions.selectedEntryId) {
    actions.selectSetlistEntry(entryId);
  }
  if (actions.playing && actions.playingEntryId && actions.playingEntryId === entryId) return;
  void actions.playSelected();
}

function isMixerChannel(value: string | undefined): value is MixerChannel {
  return Boolean(value && (MIXER_CHANNELS as readonly string[]).includes(value));
}

export function enabledMixerChannels(files: string[] | undefined): MixerChannel[] {
  return MIXER_CHANNELS.filter((channel) => songHasMixerFile(files, channel));
}

export function mixerFilesForChannels(channels: readonly string[] | undefined): string[] {
  return (channels ?? []).flatMap((channel) =>
    channel === "Main" || !(MIXER_CHANNELS as readonly string[]).includes(channel)
      ? []
      : [mixerFileName(channel as Exclude<MixerChannel, "Main">)]
  );
}

export function mixerStateMessage(input: {
  busMix: MixerBank;
  metronomeVolume: number;
  songId?: string;
  songTitle?: string;
  songMix?: MixerBank;
  songChannels?: readonly string[];
  playMode?: (typeof PlayMode)[keyof typeof PlayMode];
  songMixer?: boolean;
}): MixerStateMessage {
  return {
    type: "MixerState",
    busMix: input.busMix,
    metronomeVolume: input.metronomeVolume,
    ...(input.songId ? { songId: input.songId } : {}),
    ...(input.songTitle ? { songTitle: input.songTitle } : {}),
    ...(input.songMix ? { songMix: input.songMix } : {}),
    ...(input.songChannels && input.songChannels.length > 0
      ? { songChannels: [...input.songChannels] }
      : {}),
    ...(input.playMode ? { playMode: input.playMode } : {}),
    ...(input.songMixer != null ? { songMixer: input.songMixer } : {})
  };
}

export function applyMixerState(
  message: MixerStateMessage,
  current: {
    songMix: Record<string, MixerBank>;
    fileIndex: Record<string, string[]>;
    songs: Song[];
  }
): {
  busMix: MixerBank;
  metronomeVolume: number;
  songMix: Record<string, MixerBank>;
  fileIndex: Record<string, string[]>;
  songs: Song[];
  remoteSongMixer: boolean;
} {
  const songMix = { ...current.songMix };
  const fileIndex = { ...current.fileIndex };
  let songs = current.songs;
  if (message.songId) {
    if (message.songMix) songMix[message.songId] = parseMixerBank(message.songMix);
    fileIndex[message.songId] = mixerFilesForChannels(message.songChannels);
    if (message.playMode) {
      songs = songs.map((song) =>
        song.id === message.songId || song.folder === message.songId
          ? normalizeSong({
              ...song,
              info: { ...song.info, playMode: message.playMode }
            })
          : song
      );
    }
  }
  return {
    busMix: parseMixerBank(message.busMix),
    metronomeVolume: parseMetronomeVolume(message.metronomeVolume),
    songMix,
    fileIndex,
    songs,
    remoteSongMixer: message.songMixer === true
  };
}

export function applyRemoteMixer(
  message: RemoteMixerMessage,
  actions: {
    setSongMixStrip: (songId: string, channel: MixerChannel, patch: Partial<MixStripState>) => void;
    setBusMixStrip: (channel: MixerChannel, patch: Partial<MixStripState>) => void;
    setMetronomeVolume: (value: number) => void;
  }
): void {
  if (message.target === "metro") {
    if (typeof message.volume === "number" && Number.isFinite(message.volume)) {
      actions.setMetronomeVolume(message.volume);
    }
    return;
  }
  if (!isMixerChannel(message.channel) || !message.patch) return;
  if (message.target === "bus") {
    actions.setBusMixStrip(message.channel, message.patch);
    return;
  }
  if (message.target === "song" && message.songId) {
    actions.setSongMixStrip(message.songId, message.channel, message.patch);
  }
}
