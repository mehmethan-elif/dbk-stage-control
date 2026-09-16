export type PracticeHandoff = "play-next" | "land";

/**
 * What PRACTICE should do at this tick: start the next mix, land on ELIF/STOP, or keep playing.
 * play-next starts the following song at the cue and leaves the current Master.mp3 ringing.
 * A STOP or ELIF KONUSMA waits for that tail; cutting at the cue is what PLAY NEXT is for.
 */
export function practiceHandoff(opts: {
  ended: boolean;
  time: number;
  cue: number | null;
  shouldPlayNext: boolean;
  already: boolean;
}): PracticeHandoff | null {
  if (opts.already) return null;
  const atCue = opts.cue != null && opts.time + 0.03 >= opts.cue;
  if (opts.shouldPlayNext && (opts.ended || atCue)) return "play-next";
  if (opts.ended) return "land";
  return null;
}

/** Whether PRACTICE should start the next Master mix at this tick. */
export function practicePlayNextDue(opts: {
  ended: boolean;
  time: number;
  cue: number | null;
  shouldPlayNext: boolean;
  already: boolean;
}): boolean {
  return practiceHandoff(opts) === "play-next";
}

/** WebKit often reports the first currentTime already past the requested start. */
export function shouldRewindHtmlAudioStart(currentTime: number, startAt: number): boolean {
  return currentTime - startAt > 0.04;
}
