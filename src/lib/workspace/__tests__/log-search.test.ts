import { describe, expect, it } from "vitest";
import { parseLogLine } from "@/lib/workspace/log-line";
// F1 - pure structured search over parsed LogLines. Tokenizes a `field:value` / bare query
// (double-quotes allow spaces in a value), matches case-insensitive substring per field, AND-combined.
// Nothing exists yet - the import fails until log-search.ts ships, so each test fails on the
// missing feature, not a typo.
import { filterLogLines } from "@/lib/workspace/log-search";

// A small fixture spanning the shapes/levels the filter must discriminate.
const sendGet = parseLogLine(
  "[2026-08-16T10:00:01Z][INFO] send GET https://example.com/api/users",
  3,
);
const recvGet = parseLogLine(
  "[2026-08-16T10:00:02Z][INFO] recv GET https://example.com/api/users (200 in 12ms)",
  3,
);
const recvPostErr = parseLogLine(
  "[2026-08-16T10:00:03Z][ERROR] recv POST https://example.com/api/login (500 in 3200ms)",
  5,
);
const sendSlowWarn = parseLogLine(
  "[2026-08-16T10:00:05Z][WARN] recv GET https://example.com/api/slow (200 in 5200ms)",
  4,
);

const lines = [sendGet, recvGet, recvPostErr, sendSlowWarn];

describe("filterLogLines - field tokens (AC-05)", () => {
  // AC-05 - behavior: level:warn returns only the warn line.
  it("should return only warn lines for level:warn", () => {
    expect(filterLogLines(lines, "level:warn")).toEqual([sendSlowWarn]);
  });

  // AC-05 - behavior: level:error returns only the error line.
  it("should return only error lines for level:error", () => {
    expect(filterLogLines(lines, "level:error")).toEqual([recvPostErr]);
  });

  // AC-05 - behavior: message:login matches the recv-post line whose message contains login.
  it("should match the message field by case-insensitive substring", () => {
    expect(filterLogLines(lines, "message:login")).toEqual([recvPostErr]);
    expect(filterLogLines(lines, "message:LOGIN")).toEqual([recvPostErr]);
  });

  // AC-05 - behavior: level:error AND message:users (bare url) - a send and its recv, not the error.
  it("should not leak a level:error into lines whose message has users but level info", () => {
    expect(filterLogLines(lines, "level:error message:users")).toEqual([]);
  });
});

describe("filterLogLines - quoted message term (AC-06)", () => {
  // AC-06 - behavior: message:"(500 in 3200ms)" (quoted, has spaces) matches the timing tail that
  // lives in message, returning only the failing post line.
  it("should match a quoted message term against the tail in message", () => {
    expect(filterLogLines(lines, 'message:"(500 in 3200ms)"')).toEqual([
      recvPostErr,
    ]);
  });

  // AC-06 - behavior: the message field is matched, not raw - a term absent from message is absent.
  it("should not match a quoted message term that appears nowhere in message", () => {
    expect(filterLogLines(lines, 'message:"totally absent phrase"')).toEqual(
      [],
    );
  });
});

describe("filterLogLines - combining and empties (AC-07)", () => {
  // AC-07 - behavior: two field tokens are AND-combined.
  it("should AND-combine multiple field tokens", () => {
    expect(filterLogLines(lines, "level:info message:recv")).toEqual([recvGet]);
  });

  // AC-07 - behavior: AND of a field token and a bare term.
  it("should AND-combine a field token with a bare term", () => {
    expect(filterLogLines(lines, "level:error 3200")).toEqual([recvPostErr]);
  });

  // AC-07 - behavior: an empty query returns every line.
  it("should return all lines for an empty query", () => {
    expect(filterLogLines(lines, "")).toEqual(lines);
  });

  // AC-07 - behavior: a whitespace-only query returns every line.
  it("should return all lines for a whitespace-only query", () => {
    expect(filterLogLines(lines, "   ")).toEqual(lines);
  });
});

describe("filterLogLines - bare terms and unknown fields (AC-08)", () => {
  // AC-08 - behavior: a bare term is a case-insensitive substring match on the whole raw line.
  it("should match a bare term as a case-insensitive substring of raw", () => {
    expect(filterLogLines(lines, "api/login")).toEqual([recvPostErr]);
    expect(filterLogLines(lines, "EXAMPLE.COM")).toEqual(lines);
  });

  // AC-08 - behavior: an unknown field prefix makes the WHOLE token a bare term matched on raw
  // (so `foo:bar` looks for the literal substring "foo:bar", found nowhere here).
  it("should treat an unknown field prefix as a bare term on raw", () => {
    expect(filterLogLines(lines, "foo:bar")).toEqual([]);
    expect(filterLogLines(lines, "nope:whatever")).toEqual([]);
  });

  // AC-08 - behavior: a bare `GET` matches the method text in every line except the error post.
  it("should match the method as a bare term", () => {
    expect(filterLogLines(lines, "GET")).toEqual([
      sendGet,
      recvGet,
      sendSlowWarn,
    ]);
  });
});
