import { useEffect, useRef, useState } from "react";
import {
  padStageNames,
  parseSetlistPerformanceMode,
  SetlistPerformanceMode,
  SETLIST_MODE_ICON_COLOR,
  STAGE_NAME_SLOTS
} from "@dbk/core";
import { currentGig, useMasterStore } from "../../store/master-store";
import { isSongLibraryGig } from "../../store/song-library";
import { EighthNoteIcon, ViewIcon } from "../shared/icons";

const MODE_OPTIONS: Array<{
  mode: SetlistPerformanceMode;
  label: string;
  color: string;
  icon: "follow" | "click" | "metro";
}> = [
  {
    mode: SetlistPerformanceMode.FollowSongInfo,
    label: "Follow Song Info",
    color: SETLIST_MODE_ICON_COLOR.follow,
    icon: "follow"
  },
  {
    mode: SetlistPerformanceMode.ClickOnly,
    label: "Click Only",
    color: SETLIST_MODE_ICON_COLOR.click,
    icon: "click"
  },
  {
    mode: SetlistPerformanceMode.MetronomeContinuous,
    label: "Metronome",
    color: SETLIST_MODE_ICON_COLOR.continuous,
    icon: "metro"
  },
  {
    mode: SetlistPerformanceMode.Free,
    label: "Free",
    color: SETLIST_MODE_ICON_COLOR.free,
    icon: "metro"
  }
];

function ModeButton({
  mode,
  label,
  color,
  icon,
  selected,
  disabled,
  onSelect
}: {
  mode: SetlistPerformanceMode;
  label: string;
  color: string;
  icon: "follow" | "click" | "metro";
  selected: boolean;
  disabled: boolean;
  onSelect: (mode: SetlistPerformanceMode) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`setlist-perf-row${selected ? " on" : ""}`}
      disabled={disabled}
      onClick={() => {
        onSelect(mode);
      }}
    >
      <span className={`setlist-perf-check${selected ? " is-on" : ""}`} aria-hidden="true" />
      <span className="setlist-perf-icon" style={{ color }} aria-hidden="true">
        {icon === "click" ? <EighthNoteIcon /> : <ViewIcon />}
      </span>
      <span className="setlist-perf-label">{label}</span>
    </button>
  );
}

let persistTimer = 0;

function persistStageNames(next: string[], immediate = false): void {
  const padded = padStageNames(next);
  const run = () => {
    persistTimer = 0;
    const storeGig = currentGig(useMasterStore.getState());
    if (!storeGig || isSongLibraryGig(storeGig)) return;
    const current = padStageNames(storeGig.stageNames);
    if (current.every((value, index) => value === padded[index])) return;
    void useMasterStore.getState().updateGig((gig) => ({ ...gig, stageNames: padded }));
  };
  window.clearTimeout(persistTimer);
  if (immediate) run();
  else persistTimer = window.setTimeout(run, 250);
}

export function SetlistPerformancePanel() {
  const gig = useMasterStore(currentGig);
  const readOnly = useMasterStore((s) => s.deviceKind === "client");
  const setMode = useMasterStore((s) => s.setSetlistPerformanceMode);
  const selected = parseSetlistPerformanceMode(gig?.performanceMode);
  const library = isSongLibraryGig(gig);
  const namesLocked = readOnly || !gig || library;
  const [names, setNames] = useState(() => padStageNames(gig?.stageNames));
  const namesRef = useRef(names);
  const focusedRef = useRef(false);
  namesRef.current = names;

  useEffect(() => {
    if (focusedRef.current) return;
    setNames(padStageNames(gig?.stageNames));
  }, [gig?.id, gig?.stageNames]);

  useEffect(() => {
    return () => {
      const next = padStageNames(namesRef.current);
      const storeGig = currentGig(useMasterStore.getState());
      if (
        storeGig &&
        !next.some((name) => name.trim()) &&
        padStageNames(storeGig.stageNames).some((name) => name.trim())
      ) {
        return;
      }
      persistStageNames(next, true);
    };
  }, [gig?.id]);

  return (
    <section className="panel prep-side-panel setlist-perf-panel">
      <div className="panel-head">
        <h2>
          <span className="prep-active-setlist">SETLIST PERFORMANCE</span>
        </h2>
      </div>
      <div className="panel-body setlist-perf-body">
        <div role="radiogroup" aria-label="Setlist performance mode" className="setlist-perf-modes">
          {MODE_OPTIONS.map((option) => (
            <ModeButton
              key={option.mode}
              mode={option.mode}
              label={option.label}
              color={option.color}
              icon={option.icon}
              selected={selected === option.mode}
              disabled={readOnly || !gig}
              onSelect={(mode) => {
                void setMode(mode);
              }}
            />
          ))}
        </div>
        <div className="setlist-perf-guests">
          <div className="setlist-perf-guests-label">Other musicians</div>
          <div className="setlist-perf-names" aria-label="Other musicians">
            {Array.from({ length: STAGE_NAME_SLOTS }, (_, index) => (
              <input
                key={index}
                className="setlist-perf-name"
                value={names[index] ?? ""}
                placeholder="Name"
                disabled={namesLocked}
                aria-label={`Other musician ${index + 1}`}
                onFocus={() => {
                  focusedRef.current = true;
                }}
                onChange={(event) => {
                  const next = [...namesRef.current];
                  next[index] = event.target.value;
                  namesRef.current = next;
                  setNames(next);
                  persistStageNames(next);
                }}
                onBlur={(event) => {
                  focusedRef.current = false;
                  const next = [...namesRef.current];
                  next[index] = event.target.value;
                  namesRef.current = next;
                  setNames(next);
                  persistStageNames(next, true);
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
