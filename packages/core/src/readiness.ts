import type { Gig, RoleId, Song } from "./models.js";
import { isClickFlacPath } from "./audio-engine.js";

export interface ReadinessIssue {
  songId: string;
  songTitle: string;
  code: string;
  message: string;
}

export interface FileIndex {
  [songId: string]: string[];
}

function hasFile(files: string[] | undefined, path: string): boolean {
  if (!files) return false;
  const normalized = path.replace(/^\.\//, "");
  return files.some((file) => file === path || file === normalized || file.endsWith(`/${normalized}`));
}

export function checkSongReadiness(
  song: Song,
  requiredRoles: RoleId[],
  files?: string[]
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const add = (code: string, message: string) => {
    issues.push({ songId: song.id, songTitle: song.title, code, message });
  };

  const backing = song.assets.find((a) => a.kind === "audio" && a.audioRole === "backing");
  const clickAssetRef = song.assets.find((a) => a.kind === "audio" && a.audioRole === "click");

  if (!backing) add("missing_backing", "Backing track missing.");
  else if (files && !hasFile(files, backing.path)) add("missing_backing", "Backing track missing.");

  if (files) {
    if (!files.some((file) => isClickFlacPath(file))) add("missing_click", "Click track missing.");
  } else if (!clickAssetRef) {
    add("missing_click", "Click track missing.");
  }

  const instrumental = requiredRoles.filter((role) => role !== "vocal");
  for (const role of instrumental) {
    const xml = song.assets.find((a) => a.kind === "musicxml" && a.role === role);
    if (!xml) add("missing_musicxml", `MusicXML missing for ${role}.`);
    else if (files && !hasFile(files, xml.path)) add("missing_musicxml", `MusicXML missing for ${role}.`);
  }

  if (requiredRoles.includes("vocal")) {
    const lyrics = song.assets.find((a) => a.kind === "lyrics");
    if (!lyrics) add("missing_lyrics", "Lyrics missing.");
    else if (files && !hasFile(files, lyrics.path)) add("missing_lyrics", "Lyrics missing.");
  }

  if (!song.tempoMap || song.tempoMap.length === 0) {
    add("missing_tempo", "Tempo map missing.");
  }

  if (!song.sections || song.sections.length === 0) {
    add("missing_sections", "Sections missing.");
  }

  return issues;
}

export function checkGigReadiness(
  gig: Gig,
  songs: Map<string, Song>,
  fileIndex?: FileIndex
): ReadinessIssue[] {
  const roles = gig.musicians.map((m) => m.role);
  const issues: ReadinessIssue[] = [];
  const seen = new Set<string>();

  for (const entry of gig.setlist) {
    if (entry.type !== "song") continue;
    if (seen.has(entry.songId)) continue;
    seen.add(entry.songId);
    const song = songs.get(entry.songId);
    if (!song) {
      issues.push({
        songId: entry.songId,
        songTitle: entry.songId,
        code: "missing_song",
        message: "Song is not in the library."
      });
      continue;
    }
    issues.push(...checkSongReadiness(song, roles, fileIndex?.[song.id]));
  }

  return issues;
}

export function songIssueSummary(issues: ReadinessIssue[], songId: string): string | null {
  const forSong = issues.filter((issue) => issue.songId === songId);
  if (forSong.length === 0) return null;
  return forSong.map((issue) => issue.message.replace(/\.$/, "")).join(" · ");
}
