import {
  ELIF_KONUSMA_LABEL,
  isElifKonusma,
  isSongEntry,
  type SetlistEntry
} from "@dbk/core";
import { currentGig, useMasterStore } from "../../store/master-store";
import { LockIcon } from "../shared/icons";

export const CONCERT_FINAL_LABEL = "CONCERT FINAL";

export type SetlistMarkerLabel = typeof ELIF_KONUSMA_LABEL | typeof CONCERT_FINAL_LABEL;

export const ELIF_KEY_CHANGE_NOTE = "Ton ve saz değişimi";

export function stageBodyEntries(entries: SetlistEntry[]): SetlistEntry[] {
  return entries.filter((entry) => isElifKonusma(entry) || (isSongEntry(entry) && !entry.skipped));
}

export function setlistHasSongs(entries: SetlistEntry[]): boolean {
  return entries.some(isSongEntry);
}

export function ElifLabel() {
  return <span className="elif-label">{ELIF_KONUSMA_LABEL}</span>;
}

export function ElifNote() {
  return <span className="elif-note">{ELIF_KEY_CHANGE_NOTE}</span>;
}

export function ConcertFinalBlock(props: { variant: "prep" | "lyrics" }) {
  if (props.variant === "prep") {
    return (
      <div className="set-block is-final">
        <div className="set-marker prep-marker" aria-label={CONCERT_FINAL_LABEL}>
          <span className="prep-marker-label">{CONCERT_FINAL_LABEL}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="lyrics-set-block is-final">
      <div className="set-marker lyrics-marker" aria-label={CONCERT_FINAL_LABEL}>
        {CONCERT_FINAL_LABEL}
      </div>
    </div>
  );
}

export function StageFinishRow(props: {
  label: SetlistMarkerLabel | null;
  entryId?: string;
  locked?: boolean;
  showNotes?: boolean;
  attr?: "data-lyric-song" | "data-chord-song" | "data-drum-song" | "data-nota-song";
}) {
  const elifNotes = useMasterStore((state) => currentGig(state)?.notes?.trim() ?? "");
  if (!props.label) return null;
  const anchor =
    props.entryId && props.attr ? { [props.attr]: props.entryId } : undefined;
  const elif = props.label === ELIF_KONUSMA_LABEL;
  return (
    <div className="stage-finish-block" {...anchor}>
      <div
        className={`stage-finish-row${props.locked ? " is-locked" : ""}`}
        aria-label={
          elif && props.locked ? `${props.label} · ${ELIF_KEY_CHANGE_NOTE}` : props.label
        }
      >
        {props.locked ? (
          <span className="elif-lock">
            <LockIcon />
          </span>
        ) : null}
        {elif ? <ElifLabel /> : props.label}
        {elif && props.locked ? <ElifNote /> : null}
      </div>
      {elif && props.showNotes && elifNotes ? (
        <p className="elif-setlist-notes">{elifNotes}</p>
      ) : null}
    </div>
  );
}
