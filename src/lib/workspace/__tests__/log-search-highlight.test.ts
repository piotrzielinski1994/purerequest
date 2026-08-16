import { describe, expect, it } from "vitest";

import { highlightLogSearch } from "@/lib/workspace/log-search";

// The concatenation of every segment's text must reproduce the input verbatim (the overlay must
// align 1:1 with the real input), so this helper guards that invariant in every case.
function joined(query: string): string {
  return highlightLogSearch(query)
    .map((seg) => seg.text)
    .join("");
}

describe("highlightLogSearch", () => {
  // behavior: a `field:` prefix is a key segment, its remainder a value segment.
  it("should split a field token into a key segment and a value segment", () => {
    expect(highlightLogSearch("level:error")).toEqual([
      { text: "level:", kind: "key" },
      { text: "error", kind: "value" },
    ]);
  });

  // behavior: level and message split the same way.
  it("should mark level and message as keys", () => {
    expect(highlightLogSearch("level:error")[0]).toEqual({
      text: "level:",
      kind: "key",
    });
    expect(highlightLogSearch("message:boom")[0]).toEqual({
      text: "message:",
      kind: "key",
    });
  });

  // behavior: ANY `key:` prefix is a key, even one that is not a known filter field - the coloring
  // is a typing affordance, not a validity check.
  it("should mark any key prefix, even an unknown field", () => {
    expect(highlightLogSearch("foo:bar")).toEqual([
      { text: "foo:", kind: "key" },
      { text: "bar", kind: "value" },
    ]);
  });

  // behavior: multiple tokens - each key/value split, whitespace preserved as a plain segment.
  it("should split each token and preserve whitespace as plain", () => {
    expect(highlightLogSearch("level:error message:recv")).toEqual([
      { text: "level:", kind: "key" },
      { text: "error", kind: "value" },
      { text: " ", kind: "plain" },
      { text: "message:", kind: "key" },
      { text: "recv", kind: "value" },
    ]);
  });

  // behavior: a bare term (no colon) is plain.
  it("should leave a bare term plain", () => {
    expect(highlightLogSearch("refused")).toEqual([
      { text: "refused", kind: "plain" },
    ]);
  });

  // behavior: the key split is case-insensitive-agnostic (any casing still splits at the colon).
  it("should split a key regardless of case", () => {
    expect(highlightLogSearch("Level:error")[0]).toEqual({
      text: "Level:",
      kind: "key",
    });
  });

  // behavior: empty query yields no segments.
  it("should return no segments for an empty query", () => {
    expect(highlightLogSearch("")).toEqual([]);
  });

  // invariant: segments always reconstruct the input exactly, including quotes + inner spaces.
  it("should reconstruct the input verbatim for a quoted field value", () => {
    expect(joined('message:"connection refused" level:error')).toBe(
      'message:"connection refused" level:error',
    );
  });

  // invariant: leading/trailing/interior whitespace is preserved verbatim.
  it("should preserve surrounding whitespace verbatim", () => {
    expect(joined("  level:error   message:recv  ")).toBe(
      "  level:error   message:recv  ",
    );
  });
});
