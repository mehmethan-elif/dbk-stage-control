import type { Song } from "@dbk/core";
import { skipsCountIn } from "./count-section";

export function DirectPassMark(props: { song: Song | undefined; setlist?: boolean }) {
  if (!skipsCountIn(props.song)) return null;
  return (
    <span
      className={`direct-pass-mark${props.setlist ? " is-setlist" : ""}`}
      role="img"
      aria-label="Direct pass — no count-in"
      title="Direct pass — no count-in"
    />
  );
}
