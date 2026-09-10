import { PlayMode, setlistPlayModeIcon, type Song } from "@dbk/core";
import { EighthNoteIcon, NotationIcon, ViewIcon } from "../shared/icons";

export function PlayModeMark(props: {
  song: Song | undefined;
  files?: string[];
  setlistMode?: string;
  className?: string;
}) {
  const mark = setlistPlayModeIcon(props.song, props.files, props.setlistMode);
  const Icon =
    mark.playMode === PlayMode.ClickOnly
      ? EighthNoteIcon
      : mark.playMode === PlayMode.Playback
        ? NotationIcon
        : ViewIcon;
  return (
    <span className={`play-mode-mark${props.className ? ` ${props.className}` : ""}`} style={{ color: mark.color }} aria-hidden="true">
      <Icon />
    </span>
  );
}
