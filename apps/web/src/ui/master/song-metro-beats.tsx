import { useEffect, useRef } from "react";
import {
  metronomeTempoMap,
  parseSongInfo,
  secondsPerBeat,
  tempoAt,
  timeToMusical,
  type Song,
  type TempoPoint
} from "@dbk/core";
import { followClockPlaying, followClockTime } from "../../store/follow-clock";
import { metronomeVisualNow, onMetronomeBeat, useMasterStore } from "../../store/master-store";

export function freePageMetroTone(
  entryId: string | undefined,
  selectedEntryId: string | null | undefined,
  nextSongEntryId: string | null | undefined
): "current" | "next" | undefined {
  if (!entryId) return undefined;
  if (entryId === selectedEntryId) return "current";
  if (nextSongEntryId && entryId === nextSongEntryId) return "next";
  return undefined;
}

export function previewPulseBeatIndex(now: number, interval: number): number {
  return Math.floor((now + 0.004) / Math.max(0.05, interval));
}

type PreviewClock = {
  listeners: Set<() => void>;
  raf: number;
  lastBeat: number;
  interval: number;
};

const previewClocks = new Map<string, PreviewClock>();

export function songPlayheadBeatIndex(map: TempoPoint[], time: number): number {
  const pos = timeToMusical(map, time);
  return pos.measure * 32 + Math.floor(pos.beat);
}

function songTempoMap(songId: string): TempoPoint[] {
  return useMasterStore.getState().songs.find((item) => item.id === songId)?.tempoMap ?? [];
}

function playbackVisualTime(songId: string): number {
  if (followClockPlaying()) return followClockTime();
  const state = useMasterStore.getState();
  if (state.playback.clock?.songId === songId) return state.playback.clock.time ?? 0;
  return state.previewTime;
}

type PlaybackClock = {
  listeners: Set<() => void>;
  raf: number;
  lastBeat: number;
};

const playbackClocks = new Map<string, PlaybackClock>();

function subscribePlaybackPulse(songId: string, onBeat: () => void): () => void {
  let clock = playbackClocks.get(songId);
  if (!clock) {
    clock = {
      listeners: new Set(),
      raf: 0,
      lastBeat: songPlayheadBeatIndex(songTempoMap(songId), playbackVisualTime(songId))
    };
    playbackClocks.set(songId, clock);
    const tick = () => {
      const beat = songPlayheadBeatIndex(songTempoMap(songId), playbackVisualTime(songId));
      if (beat !== clock.lastBeat) {
        clock.lastBeat = beat;
        for (const listener of clock.listeners) listener();
      }
      clock.raf = requestAnimationFrame(tick);
    };
    clock.raf = requestAnimationFrame(tick);
  }
  clock.listeners.add(onBeat);
  return () => {
    clock.listeners.delete(onBeat);
    if (clock.listeners.size === 0) {
      cancelAnimationFrame(clock.raf);
      playbackClocks.delete(songId);
    }
  };
}

function subscribePreviewPulse(key: string, interval: number, onBeat: () => void): () => void {
  let clock = previewClocks.get(key);
  if (!clock) {
    clock = { listeners: new Set(), raf: 0, lastBeat: -1, interval };
    previewClocks.set(key, clock);
    const tick = () => {
      const beat = previewPulseBeatIndex(metronomeVisualNow(), clock.interval);
      if (beat !== clock.lastBeat) {
        clock.lastBeat = beat;
        for (const listener of clock.listeners) listener();
      }
      clock.raf = requestAnimationFrame(tick);
    };
    clock.raf = requestAnimationFrame(tick);
  }
  clock.interval = interval;
  clock.listeners.add(onBeat);
  return () => {
    clock.listeners.delete(onBeat);
    if (clock.listeners.size === 0) {
      cancelAnimationFrame(clock.raf);
      previewClocks.delete(key);
    }
  };
}

export function MetroPulse({
  song,
  active,
  tone,
  follow
}: {
  song?: Song;
  active: boolean;
  tone?: "current" | "next";
  follow?: "sound" | "playback";
}) {
  const flashRef = useRef<HTMLSpanElement>(null);
  const parsed = song ? parseSongInfo(song.info) : undefined;
  const pulseKey = parsed ? `${parsed.bpm}:${parsed.denominator}` : "";

  useEffect(() => {
    const el = flashRef.current;
    const flash = () => {
      if (!el) return;
      el.classList.remove("is-on");
      void el.offsetWidth;
      el.classList.add("is-on");
    };
    if (!active) {
      el?.classList.remove("is-on");
      return;
    }
    if (follow === "playback" && song?.id) {
      return subscribePlaybackPulse(song.id, flash);
    }
    if (follow === "sound") {
      const pending: number[] = [];
      const unsub = onMetronomeBeat((beat) => {
        pending.push(beat.at);
        pending.sort((left, right) => left - right);
      });
      const paintDue = (now: number) => {
        let due = false;
        while (pending.length > 0 && (pending[0] ?? 0) <= now + 0.004) {
          pending.shift();
          due = true;
        }
        if (due) flash();
      };
      let raf = 0;
      const loop = () => {
        paintDue(metronomeVisualNow());
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => {
        unsub();
        cancelAnimationFrame(raf);
      };
    }
    if (!song || !pulseKey) return;
    const info = parseSongInfo(song.info);
    const interval = Math.max(0.05, secondsPerBeat(tempoAt(metronomeTempoMap(info), 0)));
    return subscribePreviewPulse(pulseKey, interval, flash);
  }, [active, follow, song?.id, pulseKey]);

  return (
    <span
      ref={flashRef}
      className={`prep-metro-flash${tone ? ` is-${tone}` : ""}`}
      aria-hidden="true"
    />
  );
}
