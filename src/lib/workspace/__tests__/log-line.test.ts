import { describe, expect, it } from "vitest";

// F1 - pure parser for the Logs tab. Turns a pre-formatted plugin message
// (`[ts][LEVEL] msg`) + an optional numeric plugin level into a structured LogLine.
// Nothing exists yet - the import fails until log-line.ts ships, so each test fails on
// the missing feature, not a typo.
import { parseLogLine } from "@/lib/workspace/log-line";

// The shapes the purerequest backend emits (send/recv/cancel), exactly as
// tauri-plugin-log delivers them in the `message` field.
const SEND =
  "[2026-08-16T10:00:01Z][INFO] send GET https://example.com/api/users";
const RECV =
  "[2026-08-16T10:00:02Z][INFO] recv GET https://example.com/api/users (200 in 12ms)";
const RECV_ERR =
  "[2026-08-16T10:00:03Z][ERROR] recv POST https://example.com/api/login (500 in 3200ms)";
const CANCEL = "[2026-08-16T10:00:04Z][INFO] cancel 42";

const TS = "2026-08-16T10:00:01Z";

describe("parseLogLine - purerequest shapes (AC-03)", () => {
  // AC-03 - behavior: a send line splits into timestamp/level/message.
  it("should parse a send line into timestamp, info level and message", () => {
    const line = parseLogLine(SEND, 3);

    expect(line.raw).toBe(SEND);
    expect(line.timestamp).toBe(TS);
    expect(line.level).toBe("info");
    expect(line.message).toBe("send GET https://example.com/api/users");
  });

  // AC-03 - behavior: a recv line keeps the status/timing tail in message and the
  // url (with `=` in query strings) is NOT captured as kv.
  it("should parse a recv line and keep the status tail in message, not kv", () => {
    const line = parseLogLine(RECV, 3);

    expect(line.level).toBe("info");
    expect(line.message).toBe(
      "recv GET https://example.com/api/users (200 in 12ms)",
    );
    expect(line.kv).toEqual({});
  });

  // AC-03 - behavior: an error recv line is error level.
  it("should parse an error recv line as error", () => {
    const line = parseLogLine(RECV_ERR, 5);

    expect(line.level).toBe("error");
    expect(line.message).toBe(
      "recv POST https://example.com/api/login (500 in 3200ms)",
    );
  });

  // AC-03 - behavior: a cancel line parses with a bare id, no kv.
  it("should parse a cancel line with a bare id", () => {
    const line = parseLogLine(CANCEL, 3);

    expect(line.level).toBe("info");
    expect(line.message).toBe("cancel 42");
    expect(line.kv).toEqual({});
  });
});

describe("parseLogLine - unparseable fallback (AC-03)", () => {
  // AC-03 - behavior: a line not matching the `[ts][LEVEL] msg` shape falls back to an info line
  // whose message is the raw text, empty timestamp, empty kv.
  it("should fall back to an info line with raw message and empty kv when the shape does not match", () => {
    const raw = "some line that does not match the shape at all";
    const line = parseLogLine(raw);

    expect(line).toEqual({
      raw,
      timestamp: "",
      level: "info",
      message: raw,
      kv: {},
    });
  });

  // AC-03 - side-effect-contract: the parser NEVER throws, on any input.
  it("should never throw on empty or malformed input", () => {
    expect(() => parseLogLine("")).not.toThrow();
    expect(() => parseLogLine("[unterminated bracket")).not.toThrow();
    expect(() => parseLogLine("][")).not.toThrow();

    const empty = parseLogLine("");
    expect(empty.level).toBe("info");
    expect(empty.timestamp).toBe("");
    expect(empty.kv).toEqual({});
  });
});

describe("parseLogLine - level source precedence (AC-04)", () => {
  // AC-04 - behavior: the numeric plugin level wins over the [LEVEL] token (INFO token + numeric 5
  // -> error).
  it("should take the level from the numeric plugin level over the token", () => {
    expect(parseLogLine(SEND, 5).level).toBe("error");
  });

  // AC-04 - behavior: with no numeric level, the [LEVEL] token is used.
  it("should take the level from the [LEVEL] token when no numeric level is given", () => {
    expect(parseLogLine(RECV_ERR).level).toBe("error");
    expect(
      parseLogLine(
        "[2026-08-16T10:00:05Z][WARN] recv GET https://example.com/api/slow (200 in 5200ms)",
      ).level,
    ).toBe("warn");
  });

  // AC-04 - behavior: the full numeric mapping 1=trace,2=debug,3=info,4=warn,5=error.
  it("should map each numeric plugin level to its LogLevel", () => {
    const base = "[2026-08-16T10:00:01Z][INFO] send GET https://example.com";
    expect(parseLogLine(base, 1).level).toBe("trace");
    expect(parseLogLine(base, 2).level).toBe("debug");
    expect(parseLogLine(base, 3).level).toBe("info");
    expect(parseLogLine(base, 4).level).toBe("warn");
    expect(parseLogLine(base, 5).level).toBe("error");
  });
});
