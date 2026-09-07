export const LogCategory = {
  Audio: "AUDIO",
  Playback: "PLAYBACK",
  Network: "NETWORK",
  Database: "DATABASE",
  Client: "CLIENT",
  Sync: "SYNC",
  Import: "IMPORT",
  Reaper: "REAPER"
} as const;

export type LogCategory = (typeof LogCategory)[keyof typeof LogCategory];

export interface LogEvent {
  ts: string;
  category: LogCategory;
  event: string;
  data?: Record<string, unknown>;
}

export type LogSink = (event: LogEvent) => void;

export interface Logger {
  log(category: LogCategory, event: string, data?: Record<string, unknown>): void;
  audio(event: string, data?: Record<string, unknown>): void;
  playback(event: string, data?: Record<string, unknown>): void;
  network(event: string, data?: Record<string, unknown>): void;
  database(event: string, data?: Record<string, unknown>): void;
  client(event: string, data?: Record<string, unknown>): void;
  sync(event: string, data?: Record<string, unknown>): void;
  import(event: string, data?: Record<string, unknown>): void;
  reaper(event: string, data?: Record<string, unknown>): void;
}

function formatEvent(event: LogEvent): string {
  const payload = event.data ? ` ${JSON.stringify(event.data)}` : "";
  return `${event.ts} [${event.category}] ${event.event}${payload}`;
}

export function consoleSink(event: LogEvent): void {
  console.log(formatEvent(event));
}

export function memorySink(buffer: LogEvent[]): LogSink {
  return (event) => {
    buffer.push(event);
  };
}

export function createLogger(sink: LogSink = consoleSink): Logger {
  const log: Logger["log"] = (category, event, data) => {
    sink({
      ts: new Date().toISOString(),
      category,
      event,
      data
    });
  };

  return {
    log,
    audio: (event, data) => log(LogCategory.Audio, event, data),
    playback: (event, data) => log(LogCategory.Playback, event, data),
    network: (event, data) => log(LogCategory.Network, event, data),
    database: (event, data) => log(LogCategory.Database, event, data),
    client: (event, data) => log(LogCategory.Client, event, data),
    sync: (event, data) => log(LogCategory.Sync, event, data),
    import: (event, data) => log(LogCategory.Import, event, data),
    reaper: (event, data) => log(LogCategory.Reaper, event, data)
  };
}
