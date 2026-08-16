export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

export type LogLine = {
  raw: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  kv: Record<string, string>;
};

// tauri-plugin-log numeric levels (1=Trace .. 5=Error). The numeric level, when present, is the
// source of truth; the [LEVEL] token is the fallback.
const NUMERIC_LEVEL: Record<number, LogLevel> = {
  1: "trace",
  2: "debug",
  3: "info",
  4: "warn",
  5: "error",
};

const TOKEN_LEVEL: Record<string, LogLevel> = {
  trace: "trace",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
};

// [timestamp][LEVEL] message  ->  three groups; anything else is unparseable.
const PREFIX = /^\[([^\]]*)\]\[([^\]]*)\]\s?(.*)$/s;
const KV = /([A-Za-z_]+)=(\S+)/g;

function levelFrom(pluginLevel: number | undefined, token: string): LogLevel {
  if (pluginLevel !== undefined && NUMERIC_LEVEL[pluginLevel]) {
    return NUMERIC_LEVEL[pluginLevel];
  }
  return TOKEN_LEVEL[token.trim().toLowerCase()] ?? "info";
}

function kvFrom(message: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const match of message.matchAll(KV)) {
    pairs[match[1]] = match[2];
  }
  return pairs;
}

export function parseLogLine(raw: string, pluginLevel?: number): LogLine {
  const match = raw.match(PREFIX);
  if (!match) {
    return {
      raw,
      timestamp: "",
      level: levelFrom(pluginLevel, ""),
      message: raw,
      kv: {},
    };
  }
  const [, timestamp, token, message] = match;
  return {
    raw,
    timestamp,
    level: levelFrom(pluginLevel, token),
    message,
    kv: kvFrom(message),
  };
}
