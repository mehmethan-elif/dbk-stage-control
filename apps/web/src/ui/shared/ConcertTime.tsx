import { useEffect, useRef, useState } from "react";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatElapsed(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  return `${pad2(Math.floor(totalMin / 60))}:${pad2(totalMin % 60)}`;
}

export function ConcertTime() {
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef<number | null>(null);
  const startTimer = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (startedAt.current != null) setElapsedMs(Date.now() - startedAt.current);
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  const start = () => {
    startedAt.current = Date.now();
    setRunning(true);
    setElapsedMs(0);
  };

  const reset = () => {
    if (startTimer.current) {
      window.clearTimeout(startTimer.current);
      startTimer.current = 0;
    }
    startedAt.current = null;
    setRunning(false);
    setElapsedMs(0);
  };

  return (
    <button
      type="button"
      className={`concert-time-value${running ? " on" : ""}`}
      title={running ? "Double-click to reset concert time" : "Start concert time"}
      aria-label={running ? "Concert time. Double-click to reset" : "Start concert time"}
      aria-pressed={running}
      onClick={() => {
        if (running || startTimer.current) return;
        startTimer.current = window.setTimeout(() => {
          startTimer.current = 0;
          start();
        }, 280);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        reset();
      }}
    >
      {formatElapsed(elapsedMs)}
    </button>
  );
}
