export {
  AppMode,
  BusId,
  DeckId,
  FinishMode,
  PlayMode,
  SetlistPerformanceMode,
  KNOWN_ROLES,
  PlaybackState,
  ROLE_LABELS,
  createId,
  DEFAULT_METRONOME_BPM,
  DEFAULT_METRONOME_DENOMINATOR,
  DEFAULT_METRONOME_NUMERATOR,
  ELIF_KONUSMA_LABEL,
  entryPlayMode,
  isElifKonusma,
  isLockedElif,
  isSongEntry,
  metronomeTempoMap,
  metronomeSongView,
  clickBeats,
  parseSongInfo,
  normalizeSong,
  songInfoFromPlayback,
  roleLabel,
  songDisplayName,
  songPlaybackName
} from "./models.js";
export type {
  AssetKind,
  AssetRef,
  AudioRole,
  BreakSetlistEntry,
  ChordEvent,
  PatternEvent,
  PatternNote,
  Gig,
  GigMusician,
  HardwareOutput,
  HardwareOutputId,
  KnownRoleId,
  LoadedBuffers,
  LoadedTrack,
  LyricLine,
  Musician,
  PerformanceClock,
  RoleId,
  Section,
  SetlistEntry,
  Song,
  SongInfo,
  SongSetlistEntry,
  TempoPoint
} from "./models.js";

export type { AudioDeck, AudioEngine, DeckEvent, DeckEventHandler } from "./audio-engine.js";
export { backingAssets, clickAsset, clickOnlyMixSilences, clickOnlySong, CLICK_FLAC, hasBackingAudio, hasClickFlac, hasOnlyClickAudio, hasPlaybackAudio, isClickFlacPath, isClickPlaybackTrack, performanceAudioSong, playNextCueSeconds } from "./audio-engine.js";

export { FakeAudioDeck, FakeAudioEngine } from "./fake-audio-engine.js";
export { PlaybackController } from "./playback-controller.js";
export type { BufferLoader, PlaybackListener, PlaybackSnapshot } from "./playback-controller.js";

export {
  currentLyricIndex,
  firstSectionNamed,
  measureRangeFill,
  measureStartTimes,
  nextMeasureStart,
  nextSectionStart,
  panicDefaultTarget,
  secondsPerBeat,
  secondsPerMeasure,
  secondsPerQuarter,
  sectionAfter,
  sectionAt,
  sectionBoundaryTimes,
  sectionForBoundary,
  sectionNamed,
  sectionIndexAt,
  resolveTempoMeters,
  snapSongToMeasureGrid,
  snapToMeasureStart,
  snapToSectionBoundary,
  tempoAt,
  timeToMusical
} from "./timeline.js";
export type { MusicalPosition } from "./timeline.js";

export {
  applyRemoteSetlist,
  canInsertElifAfter,
  effectiveFinishMode,
  elifPlacementValid,
  entryStartAt,
  songChainStartAt,
  estimateSetDuration,
  findSongEntryIndex,
  formatDuration,
  insertAfterSelected,
  insertElifAfterSelected,
  keepSkippedSongsInPlace,
  isLastSongEntry,
  lastSongIndex,
  listedSongKey,
  lockedElifEntry,
  moveEntry,
  nextSongIndex,
  nextUnskippedSongIndex,
  previousSongIndex,
  songEntries,
  songFollowedByElif,
  trimElifAfterLastSong,
  visibleSetlistEntries,
  withKeyChangeElifs
} from "./setlist.js";

export { formAt, formNextAt, formRepeats, isCodaName, songForm } from "./form.js";
export type {
  FormBlock,
  FormJump,
  FormPosition,
  FormVisit,
  SongForm,
  SongFormOptions
} from "./form.js";

export { checkGigReadiness, checkSongReadiness, songIssueSummary } from "./readiness.js";
export type { FileIndex, ReadinessIssue } from "./readiness.js";

export {
  fileNameOf,
  filterPracticeFiles,
  isMasterPracticeAudio,
  isPracticeFile,
  isSafePracticeFolder,
  normalizePracticeName,
  practiceExportFolder,
  practiceFolderSlug,
  practiceMasterAudio,
  practiceSongFolder,
  samePracticeFolder
} from "./practice-files.js";

export {
  CLIENT_LIBRARY_NAME,
  dropMissingSetlistSongs,
  localFoldersNotOnRemote,
  needsClientLibraryDownload,
  humanizePracticeFolder,
  publishedSongTitle,
  resolvePublishedSongId
} from "./client-library.js";
export type { ClientLibraryFile, ClientLibraryIndex, ClientLibrarySong } from "./client-library.js";

export { MemoryLibraryRepository } from "./persistence.js";
export type { LibraryRepository, LibrarySnapshot } from "./persistence.js";

export {
  DEFAULT_METRONOME_VOLUME,
  MIXER_CHANNELS,
  MIXER_GAIN_MAX,
  MIXER_GAIN_MIN,
  MIXER_STEMS,
  emptyMixerBank,
  emptyMixerLevels,
  emptyStrip,
  gigMixerState,
  mixerFileName,
  mixerStemAssets,
  mixerStemFromPath,
  parseMetronomeVolume,
  parseMixStrip,
  parseMixerBank,
  songHasMixerFile,
  songWithMixerStems
} from "./mixer.js";
export type { MixStripState, MixerBank, MixerChannel, MixerLevels, MixerStem } from "./mixer.js";

export {
  CORE_BAND_NAMES,
  MASTER_BAND_NAME,
  VOCAL_BAND_NAME,
  SETLIST_MODE_ICON_COLOR,
  STAGE_NAME_SLOTS,
  bandRoster,
  clientBandRoster,
  connectedBandKeys,
  declaredSongPlayMode,
  effectivePlayMode,
  extraStageNames,
  isBandNameConnected,
  isMasterBandName,
  isVocalBandName,
  isFreeSetlistMode,
  isMetronomeSetlistMode,
  setlistModeIsSilent,
  lanRosterState,
  normalizeBandName,
  mergeStageNames,
  padStageNames,
  stageNamesFilled,
  parseSetlistPerformanceMode,
  resolvedSongPlayMode,
  setlistPlayModeIcon,
  songForcedClickOnly,
  songsForcedClickOnly,
  songsForSetlistPerformance
} from "./setlist-performance.js";
export type { LanRosterState } from "./setlist-performance.js";
