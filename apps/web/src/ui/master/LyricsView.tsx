import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  createId,
  currentLyricIndex,
  entryPlayMode,
  FinishMode,
  hasBackingAudio,
  ELIF_KONUSMA_LABEL,
  isElifKonusma,
  isLockedElif,
  insertAfterSelected,
  isSongEntry,
  withKeyChangeElifs,
  PlaybackState,
  PlayMode,
  songDisplayName,
  type LyricLine,
  type Song,
  type SongSetlistEntry
} from "@dbk/core";
import { currentGig, useMasterStore } from "../../store/master-store";
import { StageSetlist } from "./StageSetlist";
import { CONCERT_FINAL_LABEL, StageFinishRow, stageBodyEntries } from "./setlist-marker";
import { StageSongHead } from "./StageSongHead";
import { SongTitleMeta } from "./stage-title-meta";
import { scrollStageToFullSectionsCentered, scrollStageToSongTitle } from "./stage-scroll";
import { sectionBarClass } from "./section-color";

const TIME_EPS = 0.05;

type StageRow =
  | { kind: "section"; time: number; end: number; name: string }
  | { kind: "lyric"; time: number; end: number; line: LyricLine; lyricIndex: number };

function lyricBlocks(line: LyricLine): string[] {
  return line.text.split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
}

function lyricCovers(lyrics: LyricLine[], time: number): boolean {
  return lyrics.some((line) => {
    if (Math.abs(line.time - time) <= TIME_EPS) return true;
    if (line.end == null) return false;
    return line.time < time + TIME_EPS && time + TIME_EPS < line.end;
  });
}

function stageRows(song: Song | undefined, showSections = true): StageRow[] {
  const lyrics = song?.lyrics ?? [];
  const rows: StageRow[] = [];
  if (showSections) {
    for (const section of song?.sections ?? []) {
      if (!lyricCovers(lyrics, section.start)) {
        rows.push({ kind: "section", time: section.start, end: section.end, name: section.name });
      }
    }
  }
  lyrics.forEach((line, lyricIndex) => {
    rows.push({
      kind: "lyric",
      time: line.time,
      end: line.end ?? line.time,
      line,
      lyricIndex
    });
  });
  rows.sort((a, b) => a.time - b.time || (a.kind === "section" ? -1 : 1));
  const duration = song?.duration ?? 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.end > row.time) continue;
    row.end = rows[i + 1]?.time ?? duration;
  }
  return rows;
}

function cueClass(current: number, index: number): string {
  if (current < 0) return "";
  if (index === current) return " current";
  if (index === current + 1) return " next future";
  return index < current ? " past" : " future";
}

function cueFill(current: number, index: number, start: number, end: number, time: number): number {
  if (current < 0) return 0;
  if (index < current) return 1;
  if (index > current) return 0;
  const span = Math.max(end - start, TIME_EPS);
  return Math.min(1, Math.max(0, (time - start) / span));
}

function songShowsSections(
  entry: SongSetlistEntry | undefined,
  song: Song | undefined,
  files?: string[],
  client = false
): boolean {
  if ((song?.sections.length ?? 0) === 0) return false;
  if (client) return true;
  if (!hasBackingAudio(song, files)) return false;
  return entryPlayMode(entry) === PlayMode.Playback;
}

function sectionPlayheadClass(name: string): string {
  const key = name.trim().toUpperCase();
  return key === "BOS" || key === "FIN" ? " playhead-red" : " playhead-green";
}

export function LyricsView() {
  const songs = useMasterStore((s) => s.songs);
  const fileIndex = useMasterStore((s) => s.fileIndex);
  const gig = useMasterStore(currentGig);
  const selectedEntryId = useMasterStore((s) => s.selectedEntryId);
  const selectSetlistEntry = useMasterStore((s) => s.selectSetlistEntry);
  const updateGig = useMasterStore((s) => s.updateGig);
  const previewTime = useMasterStore((s) => s.previewTime);
  const playback = useMasterStore((s) => s.playback);
  const readOnly = useMasterStore((s) => s.deviceKind === "client");
  const setlistOpen = useMasterStore((s) => s.setlistOpen);
  const zoom = useMasterStore((s) => s.stageZooms.lyrics);
  const autoScroll = useMasterStore((s) => s.autoScroll);
  const listEntries = gig ? withKeyChangeElifs(gig.setlist, songs) : [];
  const entries = listEntries.filter(isSongEntry);
  const addedIds = new Set(entries.map((entry) => entry.songId));
  const library = songs.filter((item) => !addedIds.has(item.id));
  const selected = selectedEntryId
    ? entries.find((entry) => entry.entryId === selectedEntryId)
    : undefined;
  const playing =
    playback.state === PlaybackState.Playing || playback.state === PlaybackState.Transitioning;
  const playingEntryId = playing
    ? (playback.clock?.setlistEntryId ?? selectedEntryId ?? undefined)
    : readOnly
      ? (selectedEntryId ?? undefined)
      : undefined;
  const liveSong = songs.find((item) => item.id === (playback.clock?.songId ?? selected?.songId));
  const rawTime = playing ? (playback.clock?.time ?? previewTime) : previewTime;
  const liveTime =
    liveSong && liveSong.duration > 0 ? Math.min(liveSong.duration, rawTime) : rawTime;
  const playingSong = songs.find(
    (item) => item.id === (playback.clock?.songId ?? selected?.songId)
  );
  const playingEntry = playingEntryId
    ? entries.find((entry) => entry.entryId === playingEntryId)
    : undefined;
  const currentIdx = playingEntryId
    ? currentLyricIndex(
        stageRows(
          playingSong,
          songShowsSections(
            playingEntry,
            playingSong,
            playingSong ? fileIndex[playingSong.id] : undefined,
            readOnly
          )
        ),
        liveTime
      )
    : -1;
  const stageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (autoScroll && currentIdx >= 0) return;
    if (!selectedEntryId) return;
    scrollStageToSongTitle(stageRef.current, `[data-lyric-song="${selectedEntryId}"]`);
  }, [selectedEntryId, autoScroll, currentIdx]);

  useEffect(() => {
    if (!autoScroll || currentIdx < 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    const current = stage.querySelector(".lyrics-cue.current");
    const next = stage.querySelector(".lyrics-cue.next");
    const fallbackId = playingEntryId ?? selectedEntryId;
    const fallback = fallbackId ? stage.querySelector(`[data-lyric-song="${fallbackId}"]`) : null;
    const node = current ?? fallback;
    if (!(node instanceof HTMLElement)) return;
    scrollStageToFullSectionsCentered(stage, node, next instanceof HTMLElement ? next : null);
  }, [autoScroll, currentIdx, playingEntryId, selectedEntryId, zoom]);

  const addSong = (songId: string) => {
    if (!gig) return;
    const entryId = createId("entry");
    void updateGig((currentGigState) => ({
      ...currentGigState,
      setlist: insertAfterSelected(currentGigState.setlist, selectedEntryId, {
        type: "song",
        entryId,
        songId,
        finishMode: FinishMode.Stop,
        playMode: PlayMode.View
      })
    })).then(() => selectSetlistEntry(entryId));
  };

  const toggleSkip = (entryId: string) => {
    void updateGig((currentGigState) => ({
      ...currentGigState,
      setlist: currentGigState.setlist.map((item) =>
        item.entryId === entryId && isSongEntry(item) ? { ...item, skipped: !item.skipped } : item
      )
    }));
  };

  const visible = entries.filter((entry) => !entry.skipped);
  const bodyEntries = stageBodyEntries(listEntries);
  return (
    <div className="lyrics-page">
      <div className={`lyrics-body${setlistOpen ? "" : " no-setlist"}`}>
        {setlistOpen ? (
          <StageSetlist
            entries={listEntries}
            library={readOnly ? [] : library}
            songs={songs}
            selectedEntryId={selectedEntryId}
            readOnly={readOnly}
            onSelect={selectSetlistEntry}
            onSkip={toggleSkip}
            onAdd={addSong}
            stageRef={stageRef}
            songAttr="data-lyric-song"
          />
        ) : null}
        <section
          ref={stageRef}
          className="lyrics-stage"
          style={{ "--lyrics-zoom": String(zoom) } as CSSProperties}
        >
          {visible.length === 0 ? (
            <div className="lyrics-empty meta">No lyrics</div>
          ) : (
            <>
              {bodyEntries.map((entry) => {
                if (isElifKonusma(entry)) {
                  return (
                    <StageFinishRow
                      key={entry.entryId}
                      label={ELIF_KONUSMA_LABEL}
                      entryId={entry.entryId}
                      locked={isLockedElif(entry)}
                      showNotes
                      attr="data-lyric-song"
                    />
                  );
                }
                if (!isSongEntry(entry)) return null;
                const item = songs.find((row) => row.id === entry.songId);
                const live = playingEntryId === entry.entryId;
                return (
                  <SongLyrics
                    key={entry.entryId}
                    entryId={entry.entryId}
                    song={item}
                    live={live}
                    time={liveTime}
                    showSections={songShowsSections(
                      entry,
                      item,
                      item ? fileIndex[item.id] : undefined,
                      readOnly
                    )}
                  />
                );
              })}
              {entries.length > 0 ? <StageFinishRow label={CONCERT_FINAL_LABEL} /> : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function SongLyrics(props: {
  entryId: string;
  song: Song | undefined;
  live: boolean;
  time: number;
  showSections: boolean;
}) {
  const rows = stageRows(props.song, props.showSections);
  const current = props.live ? currentLyricIndex(rows, props.time) : -1;
  return (
    <article className="lyrics-song" data-lyric-song={props.entryId}>
      <StageSongHead songId={props.song?.id} page="lyrics">
        <span className="nota-song-name">{songDisplayName(props.song)}</span>
        <SongTitleMeta song={props.song} entryId={props.entryId} />
      </StageSongHead>
      {rows.length === 0 ? (
        <div className="lyrics-empty meta">No lyrics</div>
      ) : (
        rows.map((row, index) =>
          row.kind === "section" ? (
            <CueRow
              key={`section-${row.time}-${row.name}-${index}`}
              className={`lyrics-section lyrics-section-name lyrics-cue${sectionBarClass(row.name)}${sectionPlayheadClass(row.name)}${cueClass(current, index)}`}
              fill={cueFill(current, index, row.time, row.end, props.time)}
            >
              {row.name}
            </CueRow>
          ) : (
            <CueRow
              key={`${row.line.time}-${row.lyricIndex}`}
              className={`lyrics-line lyrics-cue${cueClass(current, index)}`}
              fill={cueFill(current, index, row.time, row.end, props.time)}
            >
              {lyricBlocks(row.line).map((block, blockIndex) => (
                <div key={`${row.line.time}-${row.lyricIndex}-${blockIndex}`}>{block}</div>
              ))}
            </CueRow>
          )
        )
      )}
    </article>
  );
}

function CueRow(props: { className: string; fill: number; children: ReactNode }) {
  return (
    <div className={props.className} style={{ "--playhead": String(props.fill) } as CSSProperties}>
      <span className="lyrics-playhead" aria-hidden="true" />
      <div className="lyrics-cue-body">{props.children}</div>
    </div>
  );
}
