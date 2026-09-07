import { entryPlayMode, isSongEntry, type Song } from "@dbk/core";
import { Fragment } from "react";
import { currentGig, useMasterStore } from "../../store/master-store";
import { listedSongForColor } from "../shared/key-color";

export function songToneScale(song: Song | undefined): string | undefined {
  const tone = song?.key?.trim();
  const scale = song?.scale?.trim();
  const text = [tone, scale].filter(Boolean).join(" ");
  return text || undefined;
}

export function songBpm(song: Song | undefined): string | undefined {
  const bpms = (song?.tempoMap ?? []).map((point) => point.bpm).filter((bpm) => bpm > 0);
  if (bpms.length === 0) return undefined;
  const min = Math.min(...bpms);
  const max = Math.max(...bpms);
  return `${min === max ? min : `${min}–${max}`} BPM`;
}

export function songTimeSig(song: Song | undefined): string | undefined {
  const meters = [
    ...new Set(
      (song?.tempoMap ?? [])
        .filter((point) => point.numerator > 0 && point.denominator > 0)
        .map((point) => `${point.numerator}/${point.denominator}`)
    )
  ];
  return meters.length > 0 ? meters.join(", ") : undefined;
}

export function songTitleMetaParts(song: Song | undefined): string[] {
  return [songToneScale(song), song?.style?.trim(), songTimeSig(song), songBpm(song)].filter(
    (part): part is string => Boolean(part && part.trim())
  );
}

export function SongTitleMeta(props: { song: Song | undefined; entryId: string }) {
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const gig = useMasterStore(currentGig);
  const entry = gig?.setlist.find((item) => item.entryId === props.entryId);
  const playMode = entry && isSongEntry(entry) ? entryPlayMode(entry) : undefined;
  const files = props.song ? fileIndex[props.song.id] : undefined;
  const parts = songTitleMetaParts(listedSongForColor(props.song, playMode, files));
  if (parts.length === 0) return null;
  return (
    <span className="nota-song-meta">
      {parts.map((part, index) => (
        <Fragment key={`${index}-${part}`}>
          {index > 0 ? <span className="nota-song-meta-dot" aria-hidden="true" /> : null}
          <span>{part}</span>
        </Fragment>
      ))}
    </span>
  );
}
