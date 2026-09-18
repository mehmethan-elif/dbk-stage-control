import { Fragment, type ReactNode } from "react";
import type { Song } from "@dbk/core";
import {
  applySongCueTone,
  cueMeasureAt,
  songCueTone,
  songCues,
  type RallDrumTone,
  type SongCueKind
} from "./rall-alert";

export function SongCueBar(props: {
  label: "RALL" | "FINAL";
  tone: RallDrumTone;
  kind: SongCueKind;
  attrPrefix: "lyric" | "chord" | "drum";
}) {
  const attr = `data-${props.attrPrefix}-${props.kind}`;
  return (
    <div
      className={`song-cue-bar is-${props.kind} ${props.tone}`}
      {...{ [attr]: props.tone }}
      aria-label={props.label}
    >
      {props.label}
    </div>
  );
}

export function SongCueBars(props: {
  song: Song | undefined;
  time: number;
  active?: boolean;
  attrPrefix: "lyric" | "chord" | "drum";
  wrap?: (bar: ReactNode, kind: SongCueKind) => ReactNode;
}) {
  const cues = songCues(props.song);
  if (cues.length === 0) return null;
  const measure = props.active === false ? undefined : cueMeasureAt(props.song, props.time);
  return (
    <>
      {cues.map((kind) => {
        const label = kind === "rall" ? "RALL" : "FINAL";
        const tone = songCueTone(measure, kind, props.song);
        const bar = (
          <SongCueBar
            key={kind}
            label={label}
            tone={tone}
            kind={kind}
            attrPrefix={props.attrPrefix}
          />
        );
        return props.wrap ? <Fragment key={kind}>{props.wrap(bar, kind)}</Fragment> : bar;
      })}
    </>
  );
}

export function paintSongCueBars(
  root: HTMLElement,
  song: Song | undefined,
  time: number,
  active: boolean,
  attrPrefix: "lyric" | "chord" | "drum"
): void {
  const measure = active ? cueMeasureAt(song, time) : undefined;
  for (const kind of ["rall", "final"] as const) {
    const tone = songCueTone(measure, kind, song);
    const attr = `data-${attrPrefix}-${kind}`;
    for (const el of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
      applySongCueTone(el, tone);
      if (kind === "rall") {
        if (attrPrefix === "lyric") el.dataset.lyricRall = tone;
        if (attrPrefix === "chord") el.dataset.chordRall = tone;
        if (attrPrefix === "drum") el.dataset.drumRall = tone;
      } else {
        if (attrPrefix === "lyric") el.dataset.lyricFinal = tone;
        if (attrPrefix === "chord") el.dataset.chordFinal = tone;
        if (attrPrefix === "drum") el.dataset.drumFinal = tone;
      }
    }
  }
}
