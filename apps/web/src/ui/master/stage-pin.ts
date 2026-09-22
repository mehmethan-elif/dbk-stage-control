import { useEffect, type RefObject } from "react";
import { useMasterStore } from "../../store/master-store";
import { pinStageSongWhenReady, stopStageScroll } from "./stage-scroll";

/** Pin the selected song to the top when the page opens or the view button changes. */
export function usePinSelectedSong(
  stageRef: RefObject<HTMLElement | null>,
  songAttr: string,
  opts: {
    page: string;
    scrollEntry: string | null | undefined;
    skip: boolean;
  }
) {
  /**
   * Showing or hiding the setlist leaves the stage a different width, so the pages under it
   * re-flow and the song being read slides off the top — furthest on the score, where the
   * pages are widest and a re-flow moves the most. That is the same "the view button changed"
   * case this hook already exists for, so it pins again rather than leaving the player to
   * find their place mid-song.
   */
  const setlistOpen = useMasterStore((s) => s.setlistOpen);
  /**
   * Pressing the button for the page already showing changes nothing about the page, so on
   * the band's copies — where that button does not toggle away and back — there was nothing
   * for this to react to and the press did nothing at all. It is the player asking to be
   * taken back to their song after reading ahead, so it counts as a view change too.
   */
  const pinNonce = useMasterStore((s) => s.stagePinNonce);
  useEffect(() => {
    stopStageScroll();
    if (opts.skip || !opts.scrollEntry) return;
    return pinStageSongWhenReady(stageRef, `[${songAttr}="${opts.scrollEntry}"]`);
  }, [opts.page, opts.scrollEntry, opts.skip, songAttr, stageRef, setlistOpen, pinNonce]);
}
