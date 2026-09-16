import { entryPlayMode, isSongEntry, type Song } from "@dbk/core";
import { Fragment } from "react";
import { currentGig, useMasterStore } from "../../store/master-store";
import { listedSongForColor } from "../shared/key-color";
import { type StageNotesPage } from "./stage-page-notes";

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

/** The tempo the song is counted in. A rall drops the tempo bar by bar, and a range of the tempos
 * a song passes through is not a number anybody can count. */
export function songStartBpm(song: Song | undefined): string | undefined {
  const bpm = (song?.tempoMap ?? []).find((point) => point.bpm > 0)?.bpm;
  return bpm ? `${bpm} BPM` : undefined;
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

export function songKita(song: Song | undefined): string | undefined {
  const kita = song?.kita ?? song?.info?.kita;
  return kita != null && kita > 0 ? `KITA ${kita}` : undefined;
}

export function songTitleMetaParts(song: Song | undefined): string[] {
  return [songToneScale(song), song?.style?.trim(), songKita(song), songTimeSig(song), songBpm(song)].filter(
    (part): part is string => Boolean(part && part.trim())
  );
}

/**
 * On stage each page carries only what it is read for. The singer wants the key she is coming in
 * on, the score and chord pages the verse and the meter alongside it, and the drummer the verse,
 * the meter and the tempo he counts. Everything about a song is still on the prep page, which is
 * read standing still.
 */
const PAGE_META: Record<StageNotesPage, ((song: Song | undefined) => string | undefined)[]> = {
  lyrics: [songToneScale],
  score: [songToneScale, songKita, songTimeSig],
  chord: [songToneScale, songKita, songTimeSig],
  drums: [songKita, songTimeSig, songStartBpm]
};

export function stagePageMetaParts(song: Song | undefined, page: StageNotesPage): string[] {
  return PAGE_META[page]
    .map((part) => part(song))
    .filter((part): part is string => Boolean(part && part.trim()));
}

export function SongTitleMeta(props: {
  song: Song | undefined;
  entryId: string;
  page: StageNotesPage;
}) {
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const gig = useMasterStore(currentGig);
  const entry = gig?.setlist.find((item) => item.entryId === props.entryId);
  const playMode = entry && isSongEntry(entry) ? entryPlayMode(entry, props.song?.info) : undefined;
  const files = props.song ? fileIndex[props.song.id] : undefined;
  const parts = stagePageMetaParts(listedSongForColor(props.song, playMode, files), props.page);
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
