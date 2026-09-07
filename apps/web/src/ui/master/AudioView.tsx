import { useEffect } from "react";
import type { AudioRoutingMode } from "@dbk/audio";
import { useMasterStore } from "../../store/master-store";

const ROUTING_MODES: Array<{
  mode: AudioRoutingMode;
  minimumChannels: number;
  profile: string;
  backing: string;
  backingOutput: string;
  click: string;
  clickOutput: string;
  outputTone?: "yellow" | "green" | "red";
}> = [
  {
    mode: 1,
    minimumChannels: 2,
    profile: "Home Practice",
    backing: "Backing Tracks",
    backingOutput: "Output 1-2",
    click: "Click",
    clickOutput: "Output 1-2",
    outputTone: "yellow"
  },
  {
    mode: 2,
    minimumChannels: 3,
    profile: "Stage Multi",
    backing: "Backing Tracks",
    backingOutput: "Output 1-2",
    click: "Click",
    clickOutput: "Output 3",
    outputTone: "green"
  },
  {
    mode: 3,
    minimumChannels: 2,
    profile: "Stage Mono",
    backing: "Backing Tracks",
    backingOutput: "Output 1",
    click: "Click",
    clickOutput: "Output 2",
    outputTone: "red"
  }
];

export function AudioView() {
  const outputs = useMasterStore((state) => state.audioOutputs);
  const deviceId = useMasterStore((state) => state.audioDeviceId);
  const channels = useMasterStore((state) => state.audioOutputChannels);
  const routingMode = useMasterStore((state) => state.audioRoutingMode);
  const error = useMasterStore((state) => state.audioError);
  const refreshOutputs = useMasterStore((state) => state.refreshAudioOutputs);
  const setDevice = useMasterStore((state) => state.setAudioDevice);
  const setRoutingMode = useMasterStore((state) => state.setAudioRoutingMode);

  useEffect(() => {
    void refreshOutputs();
  }, [refreshOutputs]);

  return (
    <main className="audio-page">
      <section className="audio-settings">
        <div className="audio-setting-row audio-soundcard-row">
          <select
            value={deviceId}
            aria-label="Soundcard"
            onChange={(event) => void setDevice(event.target.value)}
          >
            {outputs.length === 0 ? <option value={deviceId}>System Default</option> : null}
            {outputs.map((output) => (
              <option key={output.id} value={output.id}>
                {output.label}
              </option>
            ))}
          </select>
        </div>

        <div className="audio-routing-group" role="radiogroup" aria-label="Routing mode">
          {ROUTING_MODES.map((item) => {
            const disabled = channels < item.minimumChannels;
            return (
              <div className="audio-setting-row" key={item.mode}>
                <button
                  type="button"
                  className={`audio-routing-button ${item.outputTone}${routingMode === item.mode ? " on" : ""}`}
                  role="radio"
                  aria-checked={routingMode === item.mode}
                  disabled={disabled}
                  onClick={() => setRoutingMode(item.mode)}
                >
                  MODE {item.mode}
                </button>
                <span
                  className={`audio-routing-description${routingMode === item.mode ? ` ${item.outputTone}` : ""}`}
                >
                  <span>{item.profile}</span>
                  <span>
                    {item.backing}{" "}
                    <span className={item.outputTone ? `audio-output-chip ${item.outputTone}` : undefined}>
                      {item.backingOutput}
                    </span>
                  </span>
                  <span>
                    {item.click}{" "}
                    <span className={item.outputTone ? `audio-output-chip ${item.outputTone}` : undefined}>
                      {item.clickOutput}
                    </span>
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="audio-device-status">
          {channels} output{channels === 1 ? "" : "s"} available
        </div>
        {error ? <div className="audio-device-error">{error}</div> : null}
      </section>
    </main>
  );
}
