import { describe, expect, it } from "vitest";

import {
  parseUrlQuery,
  syncParamsFromUrl,
  syncUrlFromParams,
} from "@/lib/http/query-sync";

describe("parseUrlQuery", () => {
  // AC-011 - behavior: the `?a=1&b=2` part parses into ordered raw key/value pairs.
  it("should parse a ?query into ordered key/value pairs", () => {
    expect(parseUrlQuery("https://api.com/p?a=1&b=2")).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ]);
  });

  // AC-011 - behavior: a url with no query yields no pairs.
  it("should return an empty array if the url has no query", () => {
    expect(parseUrlQuery("https://api.com/p")).toEqual([]);
  });

  // AC-012 - behavior: a {{var}} token in a value is kept raw (not encoded).
  it("should keep a {{var}} token in a query value verbatim", () => {
    expect(parseUrlQuery("https://api.com/p?token={{t}}")).toEqual([
      { key: "token", value: "{{t}}" },
    ]);
  });

  // AC-011 - behavior: a key with no `=` parses with an empty value.
  it("should parse a bare key with no value as an empty-value pair", () => {
    expect(parseUrlQuery("https://api.com/p?flag")).toEqual([
      { key: "flag", value: "" },
    ]);
  });

  // AC-012 - behavior: a #fragment after the query is NOT swallowed into the last
  // value (the query ends at `#`).
  it("should not include a #fragment in the parsed query values", () => {
    expect(parseUrlQuery("https://api.com/p?a=1#frag")).toEqual([
      { key: "a", value: "1" },
    ]);
  });
});

describe("syncParamsFromUrl - URL drives the grid (AC-011, AC-014)", () => {
  // AC-011 - behavior: typing ?a=1 into an empty-query url adds an enabled row.
  it("should add an enabled row for a key typed into the url", () => {
    expect(
      syncParamsFromUrl("https://api.com/p", "https://api.com/p?a=1", []),
    ).toEqual([{ key: "a", value: "1", enabled: true }]);
  });

  // AC-011 - behavior: editing the value of a url key updates that row's value.
  it("should update an existing row's value when the url value changes", () => {
    expect(
      syncParamsFromUrl("https://api.com/p?a=1", "https://api.com/p?a=2", [
        { key: "a", value: "1", enabled: true },
      ]),
    ).toEqual([{ key: "a", value: "2", enabled: true }]);
  });

  // AC-014 - behavior: removing an enabled key from the url disables its row
  // (value kept), it is NOT deleted.
  it("should disable a row whose key was removed from the url, keeping its value", () => {
    expect(
      syncParamsFromUrl("https://api.com/p?a=1", "https://api.com/p", [
        { key: "a", value: "1", enabled: true },
      ]),
    ).toEqual([{ key: "a", value: "1", enabled: false }]);
  });

  // AC-014 - behavior: a key removed from the url whose row has an EMPTY value is
  // dropped (not disabled), so char-by-char typing leaves no empty partial rows.
  it("should drop an empty-value row whose key left the url (typing cruft)", () => {
    expect(
      syncParamsFromUrl("https://api.com/p?q=", "https://api.com/p?qw=", [
        { key: "q", value: "", enabled: true },
      ]),
    ).toEqual([{ key: "qw", value: "", enabled: true }]);
  });

  // AC-014 - behavior: re-typing a disabled row's key into the url re-enables it.
  it("should re-enable a disabled row when its key is typed back into the url", () => {
    expect(
      syncParamsFromUrl("https://api.com/p", "https://api.com/p?a=1", [
        { key: "a", value: "1", enabled: false },
      ]),
    ).toEqual([{ key: "a", value: "1", enabled: true }]);
  });

  // AC-016, AC-011 - behavior: a row whose key is NOT in either url (a legacy /
  // non-mirrored param) is left untouched while a new url key is appended.
  it("should leave a non-url row untouched and append a newly typed key", () => {
    expect(
      syncParamsFromUrl("https://api.com/p?a=1", "https://api.com/p?a=1&b=2", [
        { key: "a", value: "1", enabled: true },
        { key: "c", value: "3", enabled: true },
      ]),
    ).toEqual([
      { key: "a", value: "1", enabled: true },
      { key: "c", value: "3", enabled: true },
      { key: "b", value: "2", enabled: true },
    ]);
  });

  // AC-012 - behavior: a {{var}} value typed into the url is stored raw in the row.
  it("should store a {{var}} url value raw in the added row", () => {
    expect(
      syncParamsFromUrl("https://api.com/p", "https://api.com/p?t={{x}}", []),
    ).toEqual([{ key: "t", value: "{{x}}", enabled: true }]);
  });
});

describe("syncUrlFromParams - grid drives the URL (AC-012, AC-013)", () => {
  // AC-012 - behavior: enabled rows are written into the url query in grid order.
  it("should write enabled rows into the url query in order", () => {
    expect(
      syncUrlFromParams("https://api.com/p", [
        { key: "a", value: "1", enabled: true },
        { key: "b", value: "2", enabled: true },
      ]),
    ).toBe("https://api.com/p?a=1&b=2");
  });

  // AC-013 - behavior: a disabled row is excluded from the url query.
  it("should exclude a disabled row from the url query", () => {
    expect(
      syncUrlFromParams("https://api.com/p", [
        { key: "a", value: "1", enabled: true },
        { key: "b", value: "2", enabled: false },
      ]),
    ).toBe("https://api.com/p?a=1");
  });

  // AC-013 - behavior: no enabled rows strips the `?` entirely.
  it("should strip the query string when no rows are enabled", () => {
    expect(
      syncUrlFromParams("https://api.com/p?a=1", [
        { key: "a", value: "1", enabled: false },
      ]),
    ).toBe("https://api.com/p");
  });

  // AC-012 - behavior: the path and :pathParams before the `?` are preserved.
  it("should preserve the path and :pathParams while rewriting the query", () => {
    expect(
      syncUrlFromParams("https://api.com/users/:id?old=9", [
        { key: "a", value: "1", enabled: true },
      ]),
    ).toBe("https://api.com/users/:id?a=1");
  });

  // AC-012 - behavior: a #fragment is preserved (reattached after the new query).
  it("should preserve a #fragment when rewriting the query", () => {
    expect(
      syncUrlFromParams("https://api.com/p?old=9#frag", [
        { key: "a", value: "1", enabled: true },
      ]),
    ).toBe("https://api.com/p?a=1#frag");
  });

  // AC-013 - behavior: stripping the query keeps the #fragment on the base.
  it("should keep the #fragment when the query is stripped to empty", () => {
    expect(
      syncUrlFromParams("https://api.com/p?old=9#frag", [
        { key: "old", value: "9", enabled: false },
      ]),
    ).toBe("https://api.com/p#frag");
  });

  // AC-004-style - behavior: a blank-key row is not written to the url.
  it("should skip a blank-key row", () => {
    expect(
      syncUrlFromParams("https://api.com/p", [
        { key: "", value: "x", enabled: true },
        { key: "a", value: "1", enabled: true },
      ]),
    ).toBe("https://api.com/p?a=1");
  });

  // AC-012 - behavior: a {{var}} value is written raw (not percent-encoded).
  it("should write a {{var}} value into the url raw", () => {
    expect(
      syncUrlFromParams("https://api.com/p", [
        { key: "t", value: "{{x}}", enabled: true },
      ]),
    ).toBe("https://api.com/p?t={{x}}");
  });
});
