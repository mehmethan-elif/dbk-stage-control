import { hasBackingAudio, metronomeSongView, PlayMode, type Song } from "@dbk/core";
import type { CSSProperties } from "react";

const FALLBACK = "hsl(0 0% 18%)";
const FALLBACK_ACTIVE = "hsl(0 0% 24%)";

const BPM_MIN = 60;
const BPM_MAX = 200;
const BPM_STEP = 5;
const BPM_BUCKETS = (BPM_MAX - BPM_MIN) / BPM_STEP;

const LETTER_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

/** Fold Turkish/ASCII scale names to a stable token (KURDI, MINOR, …). */
function foldToken(value: string): string {
  return value
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replaceAll("İ", "I")
    .replaceAll("İ", "I")
    .replaceAll("Ü", "U")
    .replaceAll("Ö", "O")
    .replaceAll("Ş", "S")
    .replaceAll("Ç", "C")
    .replaceAll("Ğ", "G")
    .replaceAll("Â", "A")
    .replaceAll("Î", "I")
    .replaceAll("Û", "U");
}

const SCALE_HUES: Record<string, number> = {
  MINOR: 222,
  KURDI: 168,
  USSAK: 36,
  CARGAH: 92,
  HICAZ: 348
};

const TS_HUES: Record<string, number> = {
  "2/2": 200,
  "2/4": 188,
  "3/4": 22,
  "4/4": 268,
  "5/4": 302,
  "6/4": 178,
  "7/4": 286,
  "3/8": 10,
  "5/8": 328,
  "6/8": 128,
  "7/8": 358,
  "8/8": 248,
  "9/8": 48,
  "10/8": 72,
  "11/8": 146,
  "12/8": 108,
  "9/4": 62
};

function fill(hue: number, active: boolean, sat: number, light: number, lightActive: number): string {
  return `hsl(${Math.round(hue)} ${sat}% ${active ? lightActive : light}%)`;
}

function hashHue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function pitchClass(name: string): number | undefined {
  const n = name.trim().toUpperCase().replaceAll("♯", "#").replaceAll("♭", "B").replaceAll("İ", "I");
  if (!n) return undefined;
  const base = LETTER_PC[n.charAt(0)];
  if (base == null) return undefined;
  const acc = n.slice(1).replaceAll(" ", "");
  if (acc === "" || acc === "NAT" || acc === "NATUREL") return base;
  if (acc === "#" || acc === "IS" || acc === "DIYEZ" || acc === "S") return (base + 1) % 12;
  if (acc === "B" || acc === "ES" || acc === "BEMOL") return (base + 11) % 12;
  return base;
}

function keyHue(name: string): number {
  const pc = pitchClass(name);
  if (pc == null) return hashHue(foldToken(name));
  return pc * 30;
}

function scaleHue(scale: string): number {
  const token = foldToken(scale);
  return SCALE_HUES[token] ?? hashHue(token);
}

const STYLE_HUES: Record<string, number> = {
  ANKARA: 0,
  ATATURK: 24,
  AZERI: 48,
  BESTE: 72,
  CIFTE: 96,
  HALAY: 120,
  HORON: 144,
  MID: 168,
  ROMAN: 192,
  RUMELI: 216,
  SLOW: 240,
  TEKE: 264,
  TEREKEME: 288,
  TURKCU: 312,
  ZEYBEK: 336
};

function styleHue(style: string): number {
  const token = foldToken(style);
  return STYLE_HUES[token] ?? hashHue(token);
}

export type SongFacet = "key" | "scale" | "style";

function facetHue(facet: SongFacet, value: string): number {
  if (facet === "key") return keyHue(value);
  if (facet === "scale") return scaleHue(value);
  return styleHue(value);
}

export function sameFacet(facet: SongFacet, a: string, b: string): boolean {
  if (facet === "key") {
    const left = pitchClass(a);
    const right = pitchClass(b);
    if (left != null && right != null) return left === right;
  }
  return foldToken(a) === foldToken(b);
}

export function compareFacet(facet: SongFacet, a: string, b: string): number {
  if (facet === "key") {
    const left = pitchClass(a) ?? 99;
    const right = pitchClass(b) ?? 99;
    if (left !== right) return left - right;
  }
  return foldToken(a).localeCompare(foldToken(b), "en");
}

export function facetChipStyle(facet: SongFacet, value: string, on = false): CSSProperties {
  return {
    background: fill(facetHue(facet, value), on, 58, 24, 34),
    borderColor: on ? "var(--accent)" : `hsl(${Math.round(facetHue(facet, value))} 48% 38%)`
  };
}

function propertyFill(hue: number | undefined): CSSProperties | undefined {
  if (hue == null) return undefined;
  return {
    background: fill(hue, false, 58, 26, 32),
    borderColor: `hsl(${Math.round(hue)} 48% 38%)`
  };
}

export function songPropertyFills(song: Pick<Song, "key" | "scale" | "style" | "tempoMap">): {
  key?: CSSProperties;
  scale?: CSSProperties;
  style?: CSSProperties;
  ts?: CSSProperties;
  bpm?: CSSProperties;
} {
  const tempo = primaryTempo(song);
  return {
    key: propertyFill(song.key ? keyHue(song.key) : undefined),
    scale: propertyFill(song.scale ? scaleHue(song.scale) : undefined),
    style: propertyFill(song.style ? styleHue(song.style) : undefined),
    ts: propertyFill(
      tempo && tempo.numerator > 0 && tempo.denominator > 0
        ? tsHue(tempo.numerator, tempo.denominator)
        : undefined
    ),
    bpm: propertyFill(tempo && tempo.bpm > 0 ? bpmHue(tempo.bpm) : undefined)
  };
}

function tsHue(numerator: number, denominator: number): number {
  const label = `${numerator}/${denominator}`;
  const known = TS_HUES[label];
  if (known != null) return known;
  return (numerator * 67 + denominator * 97) % 360;
}

function bpmHue(bpm: number): number {
  const clamped = Math.min(BPM_MAX, Math.max(BPM_MIN, bpm));
  const bucket = Math.round((clamped - BPM_MIN) / BPM_STEP);
  return (bucket * (360 / (BPM_BUCKETS + 1))) % 360;
}

function primaryTempo(song: Pick<Song, "tempoMap">): { numerator: number; denominator: number; bpm: number } | undefined {
  const point = song.tempoMap.find((entry) => entry.bpm > 0 || (entry.numerator > 0 && entry.denominator > 0));
  if (!point) return undefined;
  return { numerator: point.numerator, denominator: point.denominator, bpm: point.bpm };
}

function stop(
  hue: number | undefined,
  active: boolean,
  sat: number,
  light: number,
  lightActive: number
): string {
  if (hue == null) return active ? FALLBACK_ACTIVE : FALLBACK;
  return fill(hue, active, sat, light, lightActive);
}

export function listedSongForColor(
  song: Song | undefined,
  playMode?: PlayMode,
  files?: string[]
): Song | undefined {
  if (!song) return undefined;
  const playback = hasBackingAudio(song, files) && playMode === PlayMode.Playback;
  return playback ? song : metronomeSongView(song);
}

export function songRowStyle(song: Pick<Song, "key" | "scale" | "style" | "tempoMap"> | undefined, active = false): CSSProperties | undefined {
  if (!song) return undefined;
  const tempo = primaryTempo(song);
  const key = stop(song.key ? keyHue(song.key) : undefined, active, 58, 26, 32);
  const scale = stop(song.scale ? scaleHue(song.scale) : undefined, active, 62, 26, 32);
  const style = stop(song.style ? styleHue(song.style) : undefined, active, 60, 26, 32);
  const ts = stop(
    tempo && tempo.numerator > 0 && tempo.denominator > 0
      ? tsHue(tempo.numerator, tempo.denominator)
      : undefined,
    active,
    54,
    28,
    34
  );
  const bpm = stop(tempo && tempo.bpm > 0 ? bpmHue(tempo.bpm) : undefined, active, 60, 28, 34);
  return {
    background: `linear-gradient(90deg, ${key} 0%, ${key} 10%, ${scale} 22%, ${scale} 32%, ${style} 44%, ${style} 54%, ${ts} 66%, ${ts} 76%, ${bpm} 88%, ${bpm} 100%)`
  };
}
