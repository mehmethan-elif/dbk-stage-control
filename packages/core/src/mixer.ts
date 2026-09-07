import type { AssetRef, Song } from "./models.js";

export const MIXER_STEMS = [
  "Click",
  "Kick",
  "Bass",
  "Drums",
  "Perc",
  "Keys",
  "Pluck",
  "Guitar",
  "Melody",
  "String",
  "Choir"
] as const;

export type MixerStem = (typeof MIXER_STEMS)[number];

export const MIXER_CHANNELS = [...MIXER_STEMS, "Main"] as const;
export type MixerChannel = (typeof MIXER_CHANNELS)[number];

export interface MixStripState {
  gainDb: number;
  muted: boolean;
  solo: boolean;
}

export type MixerBank = Record<MixerChannel, MixStripState>;

export function emptyStrip(): MixStripState {
  return { gainDb: 0, muted: false, solo: false };
}

export function emptyMixerBank(): MixerBank {
  return {
    Click: emptyStrip(),
    Kick: emptyStrip(),
    Bass: emptyStrip(),
    Drums: emptyStrip(),
    Perc: emptyStrip(),
    Keys: emptyStrip(),
    Pluck: emptyStrip(),
    Guitar: emptyStrip(),
    Melody: emptyStrip(),
    String: emptyStrip(),
    Choir: emptyStrip(),
    Main: emptyStrip()
  };
}

export const DEFAULT_METRONOME_VOLUME = 0.7;
export const MIXER_GAIN_MIN = -60;
export const MIXER_GAIN_MAX = 12;

export function parseMetronomeVolume(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_METRONOME_VOLUME;
  return Math.min(1, Math.max(0, parsed));
}

export function parseMixStrip(raw: unknown): MixStripState {
  if (!raw || typeof raw !== "object") return emptyStrip();
  const row = raw as Record<string, unknown>;
  const gain = Number(row.gainDb);
  return {
    gainDb: Number.isFinite(gain) ? Math.min(MIXER_GAIN_MAX, Math.max(MIXER_GAIN_MIN, gain)) : 0,
    muted: row.muted === true,
    solo: row.solo === true
  };
}

export function parseMixerBank(raw: unknown): MixerBank {
  const source =
    raw && typeof raw === "object" && "strips" in raw
      ? (raw as { strips?: unknown }).strips
      : raw;
  const row = source && typeof source === "object" ? (source as Record<string, unknown>) : {};
  const bank = emptyMixerBank();
  for (const channel of MIXER_CHANNELS) {
    if (channel in row) bank[channel] = parseMixStrip(row[channel]);
  }
  return bank;
}

export function gigMixerState(gig: { busMix?: unknown; metronomeVolume?: unknown } | undefined): {
  busMix: MixerBank;
  metronomeVolume: number;
} {
  return {
    busMix: parseMixerBank(gig?.busMix),
    metronomeVolume: parseMetronomeVolume(gig?.metronomeVolume)
  };
}

export type MixerLevels = Record<MixerChannel, number>;

export function emptyMixerLevels(): MixerLevels {
  return {
    Click: 0,
    Kick: 0,
    Bass: 0,
    Drums: 0,
    Perc: 0,
    Keys: 0,
    Pluck: 0,
    Guitar: 0,
    Melody: 0,
    String: 0,
    Choir: 0,
    Main: 0
  };
}

export function mixerFileName(channel: MixerStem): string {
  return `${channel}.flac`;
}

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

export function mixerStemFromPath(path: string): MixerStem | undefined {
  const name = fileName(path);
  const stem = MIXER_STEMS.find((channel) => mixerFileName(channel) === name);
  return stem;
}

export function songHasMixerFile(files: string[] | undefined, channel: MixerChannel): boolean {
  if (channel === "Main") return true;
  if (!files) return false;
  const wanted = mixerFileName(channel);
  return files.some((file) => fileName(file) === wanted);
}

export function mixerStemAssets(song: Song, files: string[]): AssetRef[] {
  const existing = new Set(song.assets.map((asset) => fileName(asset.path)));
  const extra: AssetRef[] = [];
  for (const channel of MIXER_STEMS) {
    const path = mixerFileName(channel);
    if (!files.some((file) => fileName(file) === path)) continue;
    if (existing.has(path)) continue;
    extra.push({
      id: `mix_${channel.toLowerCase()}`,
      kind: "audio",
      path,
      hash: "file",
      audioRole: channel === "Click" ? "click" : "stem",
      label: channel
    });
  }
  return extra;
}

export function songWithMixerStems(song: Song, files: string[]): Song {
  const extra = mixerStemAssets(song, files);
  if (extra.length === 0) return song;
  return { ...song, assets: [...song.assets, ...extra] };
}
