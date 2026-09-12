import { useEffect, useRef } from "react";
import {
  MIXER_CHANNELS,
  PlayMode,
  emptyMixerBank,
  emptyMixerLevels,
  entryPlayMode,
  hasPlaybackAudio,
  isSongEntry,
  songHasMixerFile,
  type MixerChannel
} from "@dbk/core";
import { currentGig, readBusLevels, useMasterStore } from "../../store/master-store";
import { findSongByRef } from "../../store/song-library";

const FADER_MIN = -60;
const FADER_MAX = 12;
const METER_MIN_DB = -60;
const PEAK_HOLD_MS = 80;

function formatDb(db: number): string {
  if (Math.abs(db) < 0.05) return "0 dB";
  const rounded = Math.round(db * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded} dB`;
}

function peakToMeter(peak: number): number {
  if (peak <= 1e-8) return 0;
  const db = 20 * Math.log10(peak);
  return Math.max(0, Math.min(1, (db - METER_MIN_DB) / -METER_MIN_DB));
}

export function MixerView() {
  const songs = useMasterStore((s) => s.songs);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const songMix = useMasterStore((s) => s.songMix);
  const busMix = useMasterStore((s) => s.busMix);
  const setSongMixStrip = useMasterStore((s) => s.setSongMixStrip);
  const setBusMixStrip = useMasterStore((s) => s.setBusMixStrip);
  const liveMeters = useMasterStore((s) => s.deviceKind === "master");
  const remoteSongMixer = useMasterStore((s) => s.remoteSongMixer);
  const deviceKind = useMasterStore((s) => s.deviceKind);
  const metronomeVolume = useMasterStore((s) => s.metronomeVolume);
  const setMetronomeVolume = useMasterStore((s) => s.setMetronomeVolume);
  const gig = useMasterStore(currentGig);
  const entry = gig?.setlist.find((item) => item.entryId === selectedEntryId);
  const songEntry = entry && isSongEntry(entry) ? entry : undefined;
  const song = songEntry ? findSongByRef(songs, songEntry.songId) : undefined;
  const files = song
    ? [
        ...(fileIndex[song.id] ?? []),
        ...(songEntry.songId !== song.id ? (fileIndex[songEntry.songId] ?? []) : []),
        ...(song.folder && song.folder !== song.id ? (fileIndex[song.folder] ?? []) : [])
      ]
    : undefined;
  const mode = entryPlayMode(songEntry, song?.info);
  const metronomeMode =
    deviceKind === "remote"
      ? !remoteSongMixer
      : Boolean(songEntry) &&
        (mode === PlayMode.View ||
          (mode === PlayMode.Playback && !hasPlaybackAudio(song, files)));
  const songBank = song
    ? (songMix[song.id] ?? (songEntry ? songMix[songEntry.songId] : undefined) ?? emptyMixerBank())
    : emptyMixerBank();
  const meterFills = useRef(new Map<MixerChannel, HTMLDivElement>());
  const meterPeaks = useRef(new Map<MixerChannel, HTMLDivElement>());

  useEffect(() => {
    const displayed = emptyMixerLevels();
    const held = emptyMixerLevels();
    const heldAt: Record<MixerChannel, number> = { ...emptyMixerLevels() };
    let raf = 0;
    const loop = (now: number) => {
      const levels = readBusLevels();
      for (const channel of MIXER_CHANNELS) {
        const target = peakToMeter(levels[channel]);
        displayed[channel] = target;
        if (target >= held[channel]) {
          held[channel] = target;
          heldAt[channel] = now;
        } else if (now - heldAt[channel] > PEAK_HOLD_MS) {
          held[channel] = target;
        }
        const fill = meterFills.current.get(channel);
        if (fill) fill.style.transform = `scaleY(${displayed[channel]})`;
        const peak = meterPeaks.current.get(channel);
        if (peak) {
          peak.style.bottom = `${held[channel] * 100}%`;
          peak.style.opacity = held[channel] > 0.02 ? "1" : "0";
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="mixer">
      {song ? (
        <section className="mixer-row">
          <div className="mixer-row-head">Song mixer · {song.title}</div>
          <div className="mixer-strips">
            {!metronomeMode
              ? (
              MIXER_CHANNELS.map((channel) => {
                const enabled = songHasMixerFile(files, channel);
                const strip = songBank[channel];
                return (
                  <MixerStrip
                    key={`song-${channel}`}
                    channel={channel}
                    enabled={enabled}
                    gainDb={strip.gainDb}
                    muted={strip.muted}
                    solo={false}
                    showSolo={false}
                    onGain={(gainDb) => setSongMixStrip(songEntry.songId, channel, { gainDb })}
                    onMute={() => setSongMixStrip(songEntry.songId, channel, { muted: !strip.muted })}
                  />
                );
              })
                )
              : null}
          </div>
        </section>
      ) : null}
      <section className="mixer-row">
        <div className="mixer-row-head">
          <span>Bus mixer</span>
          <MetroLevel volume={metronomeVolume} onVolume={setMetronomeVolume} />
        </div>
        <div className="mixer-strips">
          {MIXER_CHANNELS.map((channel) => {
            const strip = busMix[channel];
            return (
              <MixerStrip
                key={`bus-${channel}`}
                channel={channel}
                enabled
                gainDb={strip.gainDb}
                muted={strip.muted}
                solo={strip.solo}
                showSolo
                showMeter={liveMeters}
                meterFillRef={(el) => {
                  if (el) meterFills.current.set(channel, el);
                  else meterFills.current.delete(channel);
                }}
                meterPeakRef={(el) => {
                  if (el) meterPeaks.current.set(channel, el);
                  else meterPeaks.current.delete(channel);
                }}
                onGain={(gainDb) => setBusMixStrip(channel, { gainDb })}
                onMute={() => setBusMixStrip(channel, { muted: !strip.muted })}
                onSolo={() => setBusMixStrip(channel, { solo: !strip.solo })}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

function MetroLevel(props: { volume: number; onVolume: (value: number) => void }) {
  const reset = () => props.onVolume(0.7);
  return (
    <div className="mixer-metro-level" onDoubleClick={reset}>
      <span>Metronom</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={props.volume}
        aria-label="Metronome volume"
        onChange={(event) => props.onVolume(Number(event.target.value))}
        onDoubleClick={reset}
      />
      <span className="mixer-metro-value">{Math.round(props.volume * 100)}%</span>
    </div>
  );
}

function MixerStrip(props: {
  channel: MixerChannel;
  enabled: boolean;
  gainDb: number;
  muted: boolean;
  solo: boolean;
  showSolo: boolean;
  showMeter?: boolean;
  meterFillRef?: (el: HTMLDivElement | null) => void;
  meterPeakRef?: (el: HTMLDivElement | null) => void;
  onGain: (gainDb: number) => void;
  onMute: () => void;
  onSolo?: () => void;
}) {
  const resetGain = () => {
    if (!props.enabled) return;
    props.onGain(0);
  };

  return (
    <div className={`mixer-strip${props.enabled ? "" : " disabled"}`}>
      <div className="mixer-fader-wrap" onDoubleClick={resetGain}>
        <div className="mixer-db">{formatDb(props.gainDb)}</div>
        <div className="mixer-fader-row">
          <input
            className="mixer-fader"
            type="range"
            min={FADER_MIN}
            max={FADER_MAX}
            step={0.5}
            value={props.gainDb}
            disabled={!props.enabled}
            aria-label={`${props.channel} gain`}
            onChange={(event) => props.onGain(Number(event.target.value))}
            onDoubleClick={resetGain}
          />
          {props.showMeter ? (
            <div className="mixer-meter" aria-hidden="true">
              <div className="mixer-meter-fill" ref={props.meterFillRef} />
              <div className="mixer-meter-peak" ref={props.meterPeakRef} />
            </div>
          ) : null}
        </div>
      </div>
      <div className="mixer-btns">
        <button
          className={props.muted ? "on mute" : ""}
          disabled={!props.enabled}
          aria-label={`${props.channel} mute`}
          aria-pressed={props.muted}
          onClick={props.onMute}
        >
          M
        </button>
        {props.showSolo ? (
          <button
            className={props.solo ? "on solo" : ""}
            disabled={!props.enabled}
            aria-label={`${props.channel} solo`}
            aria-pressed={props.solo}
            onClick={props.onSolo}
          >
            S
          </button>
        ) : null}
      </div>
      <div className="mixer-label">{props.channel}</div>
    </div>
  );
}
