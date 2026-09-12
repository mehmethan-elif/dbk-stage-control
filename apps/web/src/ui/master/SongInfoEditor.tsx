import { useEffect, useState } from "react";
import { parseSongInfo, songInfoFromPlayback, type Song, type SongInfo } from "@dbk/core";
import { useMasterStore } from "../../store/master-store";
import { songPropertyFills } from "../shared/key-color";

const KEY_LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const KEY_ACCIDENTALS = ["#", "b", ""] as const;
const SCALES = ["CARGAH", "HICAZ", "KURDI", "MINOR", "USSAK"];
const STYLES = [
  "ANKARA",
  "ATATURK",
  "AZERI",
  "BESTE",
  "CIFTE",
  "HALAY",
  "HORON",
  "MID",
  "ROMAN",
  "RUMELI",
  "SLOW",
  "TEKE",
  "TEREKEME",
  "TURKCU",
  "ZEYBEK"
];

type KeyLetter = (typeof KEY_LETTERS)[number] | "";
type KeyAccidental = (typeof KEY_ACCIDENTALS)[number];

const TS_NUM_MIN = 2;
const TS_NUM_MAX = 12;
const TS_DENS = [4, 8, 16] as const;

function snapTsNumerator(value: number): number {
  if (!Number.isFinite(value)) return 4;
  return Math.min(TS_NUM_MAX, Math.max(TS_NUM_MIN, Math.round(value)));
}

function snapTsDenominator(value: number): number {
  if (!Number.isFinite(value)) return 4;
  return TS_DENS.reduce((best, option) =>
    Math.abs(option - value) < Math.abs(best - value) ? option : best
  );
}

function stepTsNumerator(current: number, delta: number): number {
  return snapTsNumerator(current + delta);
}

function stepTsDenominator(current: number, delta: number): number {
  const snapped = snapTsDenominator(current);
  const index = Math.max(0, TS_DENS.indexOf(snapped as (typeof TS_DENS)[number]));
  const next = Math.min(TS_DENS.length - 1, Math.max(0, index + delta));
  return TS_DENS[next];
}

export function SongInfoEditor(props: {
  song: Song;
  scales: string[];
  styles: string[];
  readOnly?: boolean;
  playbackValues?: boolean;
  onClose?: () => void;
}) {
  const saveSongInfo = useMasterStore((s) => s.saveSongInfo);
  const source = props.playbackValues
    ? songInfoFromPlayback(props.song)
    : parseSongInfo({ ...props.song.info, kita: props.song.info?.kita ?? props.song.kita });
  const parsedKey = splitKey(source.key);
  const [duration, setDuration] = useState(source.duration ? formatClock(source.duration) : "");
  const [bpm, setBpm] = useState(String(source.bpm));
  const [numerator, setNumerator] = useState(snapTsNumerator(source.numerator));
  const [denominator, setDenominator] = useState(snapTsDenominator(source.denominator));
  const [keyLetter, setKeyLetter] = useState<KeyLetter>(parsedKey.letter);
  const [keyAccidental, setKeyAccidental] = useState<KeyAccidental>(parsedKey.accidental);
  const [scale, setScale] = useState(source.scale ?? "");
  const [style, setStyle] = useState(source.style ?? "");
  const [kita, setKita] = useState(kitaDigit(source.kita));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const disabled = Boolean(props.readOnly);

  useEffect(() => {
    if (!props.onClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  const persist = (next: SongInfo) => {
    if (disabled) return;
    setError(null);
    setSaving(true);
    void saveSongInfo(props.song.id, next)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not save song info.");
      })
      .finally(() => setSaving(false));
  };

  const commit = (patch: Partial<{
    duration: string;
    bpm: string;
    numerator: number;
    denominator: number;
    keyLetter: KeyLetter;
    keyAccidental: KeyAccidental;
    scale: string;
    style: string;
    kita: string;
  }>) => {
    const parsed = parseDurationInput(patch.duration ?? duration);
    if (!parsed.ok) {
      setError("Duration must be minutes or m:ss.");
      return;
    }
    setDuration(parsed.seconds ? formatClock(parsed.seconds) : "");
    const next = parseSongInfo({
      ...source,
      bpm: Number(patch.bpm ?? bpm),
      numerator: patch.numerator ?? numerator,
      denominator: patch.denominator ?? denominator,
      duration: parsed.seconds,
      key: joinKey(patch.keyLetter ?? keyLetter, patch.keyAccidental ?? keyAccidental),
      scale: patch.scale ?? scale,
      style: patch.style ?? style,
      kita: Number(kitaDigit(patch.kita ?? kita))
    });
    persist(next);
  };

  if (props.playbackValues) {
    const fills = songPropertyFills(props.song);
    const values = [
      ["Key", source.key || "—", fills.key],
      ["Scale", source.scale || "—", fills.scale],
      ["Style", source.style || "—", fills.style],
      ["Kita", source.kita != null && source.kita > 0 ? String(source.kita) : "—", undefined],
      ["TS", `${source.numerator}/${source.denominator}`, fills.ts],
      ["BPM", String(source.bpm), fills.bpm],
      ["Duration", source.duration ? formatClock(source.duration) : "—", undefined]
    ] as const;
    return (
      <div className="song-info-inline is-playback-values">
        {values.map(([label, value, style]) => (
          <div className="song-info-line" key={label}>
            <span>{label}</span>
            <span className="song-info-value" style={style}>
              {value}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <form
      className={`song-info-inline${disabled ? " is-readonly" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        commit({});
      }}
    >
      <div className="song-info-line">
        <span>Key</span>
        <div className="song-info-key">
          <select
            aria-label="Key letter"
            value={keyLetter}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value as KeyLetter;
              setKeyLetter(next);
              if (!next) setKeyAccidental("");
              commit({ keyLetter: next, keyAccidental: next ? keyAccidental : "" });
            }}
          >
            <option value="">{"\u00a0"}</option>
            {KEY_LETTERS.map((letter) => (
              <option key={letter} value={letter}>
                {letter}
              </option>
            ))}
          </select>
          <select
            aria-label="Key accidental"
            value={keyAccidental}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value as KeyAccidental;
              setKeyAccidental(next);
              commit({ keyAccidental: next });
            }}
          >
            {KEY_ACCIDENTALS.map((accidental) => (
              <option key={accidental || "natural"} value={accidental}>
                {accidental === "" ? "\u00a0" : accidental}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="song-info-line">
        <span>Scale</span>
        <select
          className="song-info-line-control"
          aria-label="Scale"
          value={scale}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setScale(next);
            commit({ scale: next });
          }}
        >
          <option value="">{"\u00a0"}</option>
          {choiceOptions(SCALES, props.scales, scale).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="song-info-line">
        <span>Style</span>
        <select
          className="song-info-line-control"
          aria-label="Style"
          value={style}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setStyle(next);
            commit({ style: next });
          }}
        >
          <option value="">{"\u00a0"}</option>
          {choiceOptions(STYLES, props.styles, style).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="song-info-line">
        <span>Kita</span>
        <input
          className="song-info-line-compact"
          value={kita}
          inputMode="numeric"
          pattern="[0-9]"
          maxLength={1}
          autoComplete="off"
          aria-label="Kita"
          disabled={disabled}
          onChange={(event) => setKita(kitaDigit(event.target.value))}
          onBlur={() => commit({ kita })}
        />
      </div>
      <div className="song-info-line">
        <span>TS</span>
        <div className="song-info-ts">
          <div className="song-info-meter">
            <TsStepper
              value={numerator}
              label="Beats per bar"
              disabled={disabled}
              canUp={numerator < TS_NUM_MAX}
              canDown={numerator > TS_NUM_MIN}
              onStep={(delta) => {
                const next = stepTsNumerator(numerator, delta);
                setNumerator(next);
                commit({ numerator: next });
              }}
            />
            <span>/</span>
            <TsStepper
              value={denominator}
              label="Beat unit"
              disabled={disabled}
              canUp={denominator < 16}
              canDown={denominator > 4}
              onStep={(delta) => {
                const next = stepTsDenominator(denominator, delta);
                setDenominator(next);
                commit({ denominator: next });
              }}
            />
          </div>
        </div>
      </div>
      <div className="song-info-line">
        <span>BPM</span>
        <input
          className="song-info-line-compact"
          value={bpm}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => setBpm(digitsOnly(event.target.value))}
          onBlur={() => commit({ bpm })}
        />
      </div>
      <div className="song-info-line">
        <span>Duration</span>
        <input
          className="song-info-line-compact"
          value={duration}
          placeholder="---"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => setDuration(event.target.value)}
          onBlur={() => commit({ duration })}
        />
      </div>
      {error ? <p className="song-info-error">{error}</p> : null}
      {saving ? <p className="song-info-status">Saving…</p> : null}
    </form>
  );
}

function TsStepper(props: {
  value: number;
  label: string;
  disabled?: boolean;
  canUp?: boolean;
  canDown?: boolean;
  onStep: (delta: number) => void;
}) {
  return (
    <div className="song-info-stepper">
      <span aria-label={props.label}>{props.value}</span>
      <button
        type="button"
        aria-label={`Increase ${props.label}`}
        disabled={props.disabled || props.canUp === false}
        onClick={() => props.onStep(1)}
      >
        <span aria-hidden="true">▲</span>
      </button>
      <button
        type="button"
        aria-label={`Decrease ${props.label}`}
        disabled={props.disabled || props.canDown === false}
        onClick={() => props.onStep(-1)}
      >
        <span aria-hidden="true">▼</span>
      </button>
    </div>
  );
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function kitaDigit(value: string | number | undefined): string {
  const digit = String(value ?? "0").replace(/\D/g, "").slice(-1);
  return digit === "" ? "0" : digit;
}

function choiceOptions(preset: string[], extra: string[], current: string): string[] {
  const out: string[] = [];
  for (const value of [...preset, ...extra, current]) {
    const text = value.trim();
    if (!text) continue;
    if (out.some((item) => item.toLocaleUpperCase("tr-TR") === text.toLocaleUpperCase("tr-TR"))) continue;
    out.push(text);
  }
  return out;
}

function splitKey(raw: string | undefined): { letter: KeyLetter; accidental: KeyAccidental } {
  const text = raw?.trim() ?? "";
  const letter = text.charAt(0).toUpperCase();
  if (!KEY_LETTERS.includes(letter as (typeof KEY_LETTERS)[number])) {
    return { letter: "", accidental: "" };
  }
  const rest = text.slice(1).trim();
  const folded = rest.toUpperCase().replaceAll("♯", "#").replaceAll("♭", "B");
  if (folded === "#" || folded === "IS" || folded === "S") return { letter: letter as KeyLetter, accidental: "#" };
  if (folded === "B" || folded === "ES" || rest === "b") return { letter: letter as KeyLetter, accidental: "b" };
  return { letter: letter as KeyLetter, accidental: "" };
}

function joinKey(letter: KeyLetter, accidental: KeyAccidental): string {
  if (!letter) return "";
  return `${letter}${accidental}`;
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function parseDurationInput(text: string): { ok: true; seconds?: number } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "0" || trimmed === "0:00") return { ok: true };
  const clock = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (clock) {
    const minutes = Number(clock[1]);
    const seconds = Number(clock[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return { ok: false };
    const total = minutes * 60 + seconds;
    return total > 0 ? { ok: true, seconds: total } : { ok: true };
  }
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  const minutes = Number(trimmed);
  if (!Number.isFinite(minutes) || minutes <= 0) return { ok: true };
  return { ok: true, seconds: minutes * 60 };
}
