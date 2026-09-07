import { parseMixerBank, type MixerBank } from "@dbk/core";
import { readSongSettings, updateSongSettings } from "./song-settings";

export async function loadSongMixer(songId: string): Promise<MixerBank | null> {
  try {
    const settings = await readSongSettings(songId);
    if (settings.mixer != null) return parseMixerBank(settings.mixer);
    return null;
  } catch {
    return null;
  }
}

export async function loadSongMixers(songIds: string[]): Promise<Record<string, MixerBank>> {
  const entries = await Promise.all(
    songIds.map(async (songId) => {
      const bank = await loadSongMixer(songId);
      return bank ? ([songId, bank] as const) : null;
    })
  );
  const out: Record<string, MixerBank> = {};
  for (const entry of entries) {
    if (entry) out[entry[0]] = entry[1];
  }
  return out;
}

export async function saveSongMixer(songId: string, bank: MixerBank): Promise<void> {
  await updateSongSettings(songId, (settings) => ({ ...settings, mixer: bank }));
}
