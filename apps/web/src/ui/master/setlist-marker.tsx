import {
  ELIF_KONUSMA_LABEL,
  STOP_LABEL,
  isSongEntry,
  isTalkEntry,
  type BreakSetlistEntry,
  type SetlistEntry
} from "@dbk/core";
import { currentGig, useMasterStore } from "../../store/master-store";
import { LockIcon, StopIcon } from "../shared/icons";

export const CONCERT_FINAL_LABEL = "CONCERT FINAL";

export type SetlistMarkerLabel =
  | typeof ELIF_KONUSMA_LABEL
  | typeof STOP_LABEL
  | typeof CONCERT_FINAL_LABEL;

export const ELIF_KEY_CHANGE_NOTE = "Ton ve saz değişimi";

export function stageBodyEntries(entries: SetlistEntry[]): SetlistEntry[] {
  return entries.filter((entry) => isTalkEntry(entry) || (isSongEntry(entry) && !entry.skipped));
}

export function setlistHasSongs(entries: SetlistEntry[]): boolean {
  return entries.some(isSongEntry);
}

export function ElifLabel() {
  return <span className="elif-label">{ELIF_KONUSMA_LABEL}</span>;
}

export function StopLabel() {
  return <span className="elif-label">{STOP_LABEL}</span>;
}

export function TalkLeadIcon(props: { locked?: boolean; stop?: boolean }) {
  if (props.locked) {
    return (
      <span className="elif-lock">
        <LockIcon />
      </span>
    );
  }
  if (props.stop) {
    return (
      <span className="elif-lock">
        <StopIcon />
      </span>
    );
  }
  return null;
}

export function TalkLabel(props: { entry?: BreakSetlistEntry; label?: SetlistMarkerLabel }) {
  const stop = props.entry
    ? props.entry.label === STOP_LABEL
    : props.label === STOP_LABEL;
  return stop ? <StopLabel /> : <ElifLabel />;
}

export function ElifNote() {
  return <span className="elif-note">{ELIF_KEY_CHANGE_NOTE}</span>;
}

export function ConcertFinalBlock(props: { variant: "prep" | "lyrics" }) {
  if (props.variant === "prep") {
    return (
      <div className="set-block is-final">
        <div className="set-marker prep-marker is-concert-final" aria-label={CONCERT_FINAL_LABEL}>
          <span className="prep-marker-label">{CONCERT_FINAL_LABEL}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="lyrics-set-block is-final">
      <div className="set-marker lyrics-marker is-concert-final" aria-label={CONCERT_FINAL_LABEL}>
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
  notes?: string;
  attr?: "data-lyric-song" | "data-chord-song" | "data-drum-song" | "data-nota-song";
}) {
  const elifNotes = useMasterStore((state) => currentGig(state)?.notes?.trim() ?? "");
  if (!props.label) return null;
  const anchor =
    props.entryId && props.attr ? { [props.attr]: props.entryId } : undefined;
  const elif = props.label === ELIF_KONUSMA_LABEL;
  const stop = props.label === STOP_LABEL;
  const talk = elif || stop;
  const notes = stop ? (props.notes?.trim() ?? "") : elifNotes;
  return (
    <div className="stage-finish-block" {...anchor}>
      <div
        className={`stage-finish-row${
          props.locked || stop ? " is-locked" : ""
        }${talk ? "" : " is-concert-final"}`}
        aria-label={
          elif && props.locked ? `${props.label} · ${ELIF_KEY_CHANGE_NOTE}` : props.label
        }
      >
        <TalkLeadIcon locked={props.locked} stop={stop} />
        {elif ? <ElifLabel /> : stop ? <StopLabel /> : props.label}
        {elif && props.locked ? <ElifNote /> : null}
      </div>
      {talk && props.showNotes && notes ? (
        <p className="elif-setlist-notes">{notes}</p>
      ) : null}
    </div>
  );
}
