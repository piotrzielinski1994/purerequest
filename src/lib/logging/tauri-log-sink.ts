import type { LogSink, LogSinkLevel } from "@pziel/pureui";
import { invoke } from "@tauri-apps/api/core";

// The app-side Tauri binding for the hoisted LogSink port (pureui owns the port
// + noop). Sends a leveled message to the Rust file log (same per-launch file as
// the backend's own log::info! lines). Best-effort: a no-op outside a Tauri host
// (invoke rejects) and never throws, so instrumentation can't break the app.
export function createTauriLogSink(): LogSink {
  return {
    log: async (level, message) => {
      try {
        await invoke("log_message", { level, message });
      } catch {
        // no-op outside a Tauri host
      }
    },
  };
}

const sink = createTauriLogSink();

export function logMessage(
  level: LogSinkLevel,
  message: string,
): Promise<void> {
  return sink.log(level, message);
}
