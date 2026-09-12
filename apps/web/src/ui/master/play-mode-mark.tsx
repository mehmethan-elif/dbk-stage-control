import { PlayMode, setlistPlayModeIcon, type Song } from "@dbk/core";
import { EighthNoteIcon, FreeIcon, NotationIcon, ViewIcon } from "../shared/icons";

export function PlayModeMark(props: {
  song: Song | undefined;
  files?: string[];
  setlistMode?: string;
  className?: string;
  inheritColor?: boolean;
}) {
  const mark = setlistPlayModeIcon(props.song, props.files, props.setlistMode);
  const Icon =
    mark.playMode === PlayMode.ClickOnly
      ? EighthNoteIcon
      : mark.playMode === PlayMode.Playback
        ? NotationIcon
        : mark.playMode === PlayMode.Free
          ? FreeIcon
          : ViewIcon;
  const label = mark.playMode === PlayMode.Playback ? "Backing tracks" : "Metronome";
  return (
    <span
      className={`play-mode-mark${props.className ? ` ${props.className}` : ""}`}
      style={props.inheritColor ? undefined : { color: mark.color }}
      title={label}
      aria-hidden="true"
    >
      <Icon />
    </span>
  );
}
