import { useEffect, useState } from "react";
import { isBandNameConnected, isMasterBandName, normalizeBandName } from "@dbk/core";
import type { SyncPeer } from "@dbk/protocol";

export function useNavigatorOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? false : navigator.onLine
  );
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

export function BandRoster({
  names,
  peers,
  selected,
  onSelect,
  disabled,
  masterOnline
}: {
  names: readonly string[];
  peers: readonly SyncPeer[];
  selected?: string | null;
  onSelect?: (name: string) => void;
  disabled?: boolean;
  masterOnline?: boolean;
}) {
  const selectable = Boolean(onSelect) && !disabled;
  return (
    <div className="lan-roster" role={selectable ? "radiogroup" : "list"} aria-label="Band members">
      {names.map((name) => {
        const connected =
          (masterOnline && isMasterBandName(name)) || isBandNameConnected(name, peers);
        const on = selected ? normalizeBandName(selected) === normalizeBandName(name) : false;
        const className = `lan-roster-name${connected ? " connected" : ""}${on ? " selected" : ""}`;
        if (selectable) {
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={on}
              className={className}
              disabled={disabled}
              onClick={() => onSelect?.(name)}
            >
              {name}
            </button>
          );
        }
        return (
          <div key={name} role="listitem" className={className}>
            {name}
          </div>
        );
      })}
    </div>
  );
}
