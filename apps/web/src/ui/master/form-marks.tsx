import type { ReactNode } from "react";
import type { FormBlock, FormVisit, SongForm } from "@dbk/core";

export function SegnoIcon() {
  return (
    <svg className="form-cue-icon form-segno-icon" viewBox="0 0 48 68" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.2 9.15C12.72 9.15 13.29 9.32 13.53 10.24L13.7 10.82C14.27 13.06 15.54 17.96 19.74 17.96C23.14 17.96 25.5 15.94 25.5 12.43C25.5 11.17 25.21 9.84 24.81 8.52C23.48 4.72 17.96 3.28 13.7 3.28C7.94 3.28 1.38 10.42 1.38 18.65C1.38 20.6 1.78 22.68 2.71 24.75C5.35 30.79 17.38 38.16 18.01 38.45C18.36 38.62 18.53 38.73 18.53 39.08C18.53 39.42 18.36 39.83 18.01 40.4C17.44 41.55 5.53 63.02 5.53 63.02C5.35 63.37 5.24 63.77 5.24 64.12C5.24 65.44 6.27 66.53 7.6 66.53C8.4 66.53 9.27 66.01 9.67 65.27C9.67 65.27 22.5 42.07 22.73 41.55C22.73 41.67 23.42 41.15 23.77 41.15C24.98 41.44 41.55 46.33 41.55 54.16C41.55 57.38 39.6 59.57 36.78 59.97L36.49 60.09C34.76 60.09 33.38 58.88 33.38 56.35L33.38 55.42C33.38 52.26 31.31 49.96 28.95 49.96C28.66 49.96 28.32 50.01 27.97 50.13C24.92 50.88 22.1 52.2 22.1 55.48C22.1 60.55 27.22 64.98 32.12 64.98C33.21 64.98 34.36 64.81 35.57 64.35C42.24 62.16 46.62 56.75 46.62 49.84C46.62 49.09 46.56 48.29 46.45 47.48C45.24 38.33 32.12 30.96 31.14 30.45C30.1 29.87 29.7 29.58 29.7 29.12C29.7 29.01 29.81 28.83 29.87 28.66C30.27 27.97 43.17 4.89 43.17 4.89C43.4 4.43 43.45 4.14 43.45 3.68C43.45 2.36 42.42 1.38 41.15 1.38C40.35 1.38 39.48 1.78 39.08 2.53C39.08 2.53 25.9 26.3 25.38 27.05C25.15 27.51 24.98 27.74 24.63 27.74C24.4 27.74 24.17 27.68 23.83 27.51C23.08 27.22 10.59 22.45 8.4 18.71C7.94 17.78 7.25 16.06 7.25 14.33C7.25 12.09 8.23 9.73 11.74 9.15ZM35.45 25.67C35.45 28.26 37.58 30.39 40.17 30.39C42.82 30.39 44.89 28.26 44.89 25.67C44.89 23.02 42.82 20.95 40.17 20.95C37.58 20.95 35.45 23.02 35.45 25.67ZM12.66 42.42C12.66 39.83 10.59 37.7 7.94 37.7C5.35 37.7 3.17 39.83 3.17 42.42C3.17 45.06 5.35 47.14 7.94 47.14C10.59 47.14 12.66 45.06 12.66 42.42Z"
      />
    </svg>
  );
}

export function CodaIcon() {
  return (
    <svg className="form-cue-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="6.4" fill="none" stroke="currentColor" strokeWidth="2.15" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.15"
        strokeLinecap="round"
        d="M12 3.4v17.2M3.4 12h17.2"
      />
    </svg>
  );
}

export function DalSegnoIcon() {
  return (
    <span className="form-ds-mark">
      <span className="form-ds-letters">D.S.</span>
      <SegnoIcon />
    </span>
  );
}

export function DalSegnoAlCodaIcon() {
  return (
    <span className="form-ds-mark">
      <span className="form-ds-letters">D.S.</span>
      <SegnoIcon />
      <CodaIcon />
    </span>
  );
}

function formCue(kind: "segno" | "coda" | "to-coda" | "ds" | "ds-al-coda"): {
  className: string;
  label: string;
  icon: ReactNode;
} {
  if (kind === "segno") return { className: "form-senyo", label: "Segno", icon: <SegnoIcon /> };
  if (kind === "coda") return { className: "form-coda", label: "Coda", icon: <CodaIcon /> };
  if (kind === "to-coda") return { className: "form-ds", label: "To coda", icon: <CodaIcon /> };
  if (kind === "ds-al-coda") return { className: "form-ds", label: "Dal segno al coda", icon: <DalSegnoAlCodaIcon /> };
  return { className: "form-ds", label: "Dal segno", icon: <DalSegnoIcon /> };
}

export function formStartCue(block: FormBlock) {
  if (block.segno) return formCue("segno");
  if (block.coda) return formCue("coda");
  return null;
}

export function formEndCue(block: FormBlock, toCodaInBar = true) {
  if (block.ds && block.toCoda) return formCue("ds-al-coda");
  if (block.ds) return formCue("ds");
  if (toCodaInBar && block.toCoda) return formCue("to-coda");
  return null;
}

export function formInlineCue(
  block: FormBlock,
  atSectionStart: boolean,
  atSectionEnd: boolean,
  atToCoda = atSectionEnd
) {
  if (atToCoda && block.toCoda && !block.ds) return formCue("to-coda");
  if (atSectionStart || atSectionEnd) return null;
  return null;
}

export function ChordMeasureCue(props: {
  block: FormBlock;
  atSectionStart: boolean;
  atSectionEnd: boolean;
  atToCoda?: boolean;
}) {
  const cue = formInlineCue(
    props.block,
    props.atSectionStart,
    props.atSectionEnd,
    props.atToCoda
  );
  if (!cue) return null;
  return (
    <span className={`chord-measure-cue ${cue.className}`} title={cue.label}>
      {cue.icon}
    </span>
  );
}

export function ChordRepeatMark(props: { side: "start" | "end" }) {
  return (
    <span className={`chord-repeat-mark ${props.side}`} aria-hidden="true">
      {props.side === "end" ? <span className="chord-repeat-dots" /> : null}
      <span className="chord-repeat-line" />
      {props.side === "start" ? <span className="chord-repeat-dots" /> : null}
    </span>
  );
}

export function FormSectionBar(props: {
  block: FormBlock;
  form?: SongForm;
  visit?: FormVisit | null;
  extra?: string | null;
  extraClass?: string;
  showRepeats?: boolean;
  showJumps?: boolean;
  toCodaInBar?: boolean;
}) {
  const showRepeats = props.showRepeats !== false;
  const showJumps = props.showJumps !== false;
  const startCue = showJumps ? formStartCue(props.block) : null;
  const endCue = showJumps ? formEndCue(props.block, props.toCodaInBar !== false) : null;
  return (
    <div className="form-section-bar">
      <span className="form-section-lead">
        {startCue ? <span className={startCue.className} title={startCue.label}>{startCue.icon}</span> : null}
        {showRepeats && props.block.repeatStart ? (
          <span className="form-repeat-bar" aria-hidden="true">
            |:
          </span>
        ) : null}
        <span>{props.block.name}</span>
        {showRepeats && props.block.repeatEnd ? (
          <span className="form-repeat-bar" aria-hidden="true">
            :|
          </span>
        ) : null}
      </span>
      <span className="form-section-tail">
        {props.extra ? <span className={props.extraClass}>{props.extra}</span> : null}
        {endCue ? <span className={endCue.className} title={endCue.label}>{endCue.icon}</span> : null}
      </span>
    </div>
  );
}
