import { useState } from "react";
import type { DeviceKind } from "@dbk/protocol";
import { MASTER_HOST_KEY, SYNC_PORT } from "../../native/sync";

export function RoleGate(props: {
  onChoose: (kind: DeviceKind, syncHost?: string) => void;
}) {
  const [host, setHost] = useState(() => localStorage.getItem(MASTER_HOST_KEY) ?? "");
  const [joining, setJoining] = useState(false);

  return (
    <div className="role-gate">
      <div className="brand">DBK Stage Control</div>
      <p className="role-gate-copy">This iPad is the show. The Mac stays home.</p>
      {joining ? (
        <form
          className="role-join"
          onSubmit={(event) => {
            event.preventDefault();
            const value = host.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
            if (!value) return;
            localStorage.setItem(MASTER_HOST_KEY, value);
            props.onChoose("client", value);
          }}
        >
          <label className="topbar-label" htmlFor="master-ip">
            Master iPad address
          </label>
          <input
            id="master-ip"
            className="role-ip"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder={`192.168.1.5 or 192.168.1.5:${SYNC_PORT}`}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="role-actions">
            <button type="submit" className="lyrics-btn on">
              Join as client
            </button>
            <button type="button" className="lyrics-btn" onClick={() => setJoining(false)}>
              Back
            </button>
          </div>
        </form>
      ) : (
        <div className="role-actions">
          <button type="button" className="lyrics-btn on" onClick={() => props.onChoose("master")}>
            This iPad is master
          </button>
          <button type="button" className="lyrics-btn" onClick={() => setJoining(true)}>
            Join as client
          </button>
        </div>
      )}
      <p className="role-gate-help">
        Master keeps the full stem library on this iPad. Band members open the public page, add it to the home
        screen, and DBK downloads charts plus Master.mp3 — not this Xcode app.
      </p>
    </div>
  );
}

export function LibraryMissing(props: { master: boolean }) {
  return (
    <div className="role-gate">
      <div className="brand">No songs on this iPad</div>
      <p className="role-gate-copy">
        Connect the iPad to a Mac, open Finder, select the iPad, then copy your <code>library</code> folder into{" "}
        <strong>DBK Stage Control</strong>.
      </p>
      <p className="role-gate-help">
        The folder must contain <code>songs</code>, same as on your computer. {props.master
          ? "Master plays stems from this copy. Publish the band library from the Mac."
          : "Use the browser page on band tablets. It downloads the published library."}
      </p>
    </div>
  );
}
