import { PlayMode, songDisplayName, type Song } from "@dbk/core";
import {
  compareFacet,
  listedSongForColor,
  sameFacet,
  type SongFacet
} from "../shared/key-color";

function facetValues(song: Song, facet: SongFacet): string[] {
  const fromSong = facet === "key" ? song.key : facet === "scale" ? song.scale : song.style;
  const fromInfo =
    facet === "key" ? song.info?.key : facet === "scale" ? song.info?.scale : song.info?.style;
  const values: string[] = [];
  for (const raw of [fromInfo, fromSong]) {
    const text = raw?.trim();
    if (!text) continue;
    if (values.some((value) => sameFacet(facet, value, text))) continue;
    values.push(text);
  }
  return values;
}

function songFacet(song: Song, facet: SongFacet, playMode?: PlayMode, files?: string[]): string {
  const viewed = listedSongForColor(song, playMode, files) ?? song;
  const value = facet === "key" ? viewed.key : facet === "scale" ? viewed.scale : viewed.style;
  return value?.trim() || facetValues(song, facet)[0] || "";
}

export function groupLibrarySongs(
  songs: Song[],
  playModes: Record<string, PlayMode>,
  fileIndex: Record<string, string[]>
): Array<{ id: string; title: string; songs: Song[] }> {
  const groups: Array<{ key: string; scale: string; songs: Song[] }> = [];
  for (const song of songs) {
    const playMode = playModes[song.id] ?? PlayMode.View;
    const files = fileIndex[song.id];
    const key = songFacet(song, "key", playMode, files);
    const scale = songFacet(song, "scale", playMode, files);
    const existing = groups.find(
      (group) =>
        (key ? sameFacet("key", group.key, key) : !group.key) &&
        (scale ? sameFacet("scale", group.scale, scale) : !group.scale)
    );
    if (existing) existing.songs.push(song);
    else groups.push({ key, scale, songs: [song] });
  }
  groups.sort((left, right) => {
    if (!left.key && right.key) return 1;
    if (left.key && !right.key) return -1;
    const byKey = left.key && right.key ? compareFacet("key", left.key, right.key) : 0;
    if (byKey !== 0) return byKey;
    if (!left.scale && right.scale) return 1;
    if (left.scale && !right.scale) return -1;
    if (left.scale && right.scale) return compareFacet("scale", left.scale, right.scale);
    return 0;
  });
  for (const group of groups) {
    group.songs.sort((left, right) => {
      const leftMode = playModes[left.id] ?? PlayMode.View;
      const rightMode = playModes[right.id] ?? PlayMode.View;
      const leftStyle = songFacet(left, "style", leftMode, fileIndex[left.id]);
      const rightStyle = songFacet(right, "style", rightMode, fileIndex[right.id]);
      const byStyle =
        leftStyle && rightStyle
          ? compareFacet("style", leftStyle, rightStyle)
          : leftStyle
            ? -1
            : rightStyle
              ? 1
              : 0;
      if (byStyle !== 0) return byStyle;
      return songDisplayName(left).localeCompare(songDisplayName(right), "tr");
    });
  }
  return groups.map((group) => ({
    id: `${group.key || "none"}:${group.scale || "none"}`,
    title: [group.key || "—", group.scale || "—"].join(" "),
    songs: group.songs
  }));
}
