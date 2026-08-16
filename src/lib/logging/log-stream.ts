import { attachLogger } from "@tauri-apps/plugin-log";

// Port for the application log stream (F1). The native build subscribes to tauri-plugin-log's
// Webview target (every backend `log::` record + the FE log_message bridge arrive here); the
// browser/test build uses the noop. Kept behind a port so the Logs tab wiring stays
// unit-testable without a real webview.
export type LogStream = {
  // Calls `onLine` for each log record with the pre-formatted message + numeric level (1..5).
  // Returns a promise resolving to an unsubscribe function.
  subscribe: (
    onLine: (raw: string, level: number) => void,
  ) => Promise<() => void>;
};

export function createTauriLogStream(): LogStream {
  return {
    subscribe: (onLine) =>
      attachLogger((record) => onLine(record.message, record.level)),
  };
}

export function createNoopLogStream(): LogStream {
  return {
    subscribe: () => Promise.resolve(() => {}),
  };
}
