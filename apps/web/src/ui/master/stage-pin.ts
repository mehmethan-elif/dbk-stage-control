import { useEffect, type RefObject } from "react";
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
  useEffect(() => {
    stopStageScroll();
    if (opts.skip || !opts.scrollEntry) return;
    return pinStageSongWhenReady(stageRef, `[${songAttr}="${opts.scrollEntry}"]`);
  }, [opts.page, opts.scrollEntry, opts.skip, songAttr, stageRef]);
}
