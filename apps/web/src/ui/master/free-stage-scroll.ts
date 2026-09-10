import { useEffect, type RefObject } from "react";
import { isElifKonusma, isSongEntry, withKeyChangeElifs } from "@dbk/core";
import {
  currentGig,
  useMasterStore,
  usesFreeMetroTransport
} from "../../store/master-store";
import { currentEntryIdFromStageTitles, isStageScrollAnimating, scrollStageToSongTitle } from "./stage-scroll";

export type StageSongAttr =
  | "data-lyric-song"
  | "data-chord-song"
  | "data-drum-song"
  | "data-nota-song";

export function syncSelectedFromStageScroll(entryId: string): void {
  const state = useMasterStore.getState();
  if (!usesFreeMetroTransport(state)) return;
  if (state.selectedEntryId === entryId) return;
  const gig = currentGig(state);
  const displayed = gig ? withKeyChangeElifs(gig.setlist, state.songs) : [];
  const entry = displayed.find((item) => item.entryId === entryId);
  if (!entry) return;
  if (!isElifKonusma(entry) && !(isSongEntry(entry) && !entry.skipped)) return;
  useMasterStore.setState({ selectedEntryId: entryId });
}

export function useFreeStageScrollSelection(
  stageRef: RefObject<HTMLElement | null>,
  songAttr: StageSongAttr,
  contentKey = ""
) {
  const freeMode = useMasterStore(usesFreeMetroTransport);

  useEffect(() => {
    if (!freeMode) return;
    const id = useMasterStore.getState().selectedEntryId;
    if (!id) return;
    scrollStageToSongTitle(stageRef.current, `[${songAttr}="${id}"]`);
  }, [freeMode, songAttr, stageRef]);

  useEffect(() => {
    if (!freeMode) return;
    const stage = stageRef.current;
    if (!stage) return;

    let frame = 0;
    const sync = () => {
      frame = 0;
      if (isStageScrollAnimating()) return;
      const id = currentEntryIdFromStageTitles(stage, songAttr);
      if (id) syncSelectedFromStageScroll(id);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(sync);
    };

    stage.addEventListener("scroll", onScroll, { passive: true });
    stage.addEventListener("stagescrollend", sync);
    window.addEventListener("resize", onScroll);
    if (!isStageScrollAnimating()) sync();
    return () => {
      stage.removeEventListener("scroll", onScroll);
      stage.removeEventListener("stagescrollend", sync);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [contentKey, freeMode, songAttr, stageRef]);
}
