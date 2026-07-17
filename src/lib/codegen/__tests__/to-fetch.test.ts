import { describe, it, expect } from "vitest";

// Imported before the module exists so RED fails on the missing feature, not a
// typo. Once src/lib/codegen/to-fetch.ts ships these assertions pin its output.
import { toFetch } from "@/lib/codegen/to-fetch";
import type { HttpRequest } from "@/lib/http/model";
import type { Auth, HttpMethod, KeyValue } from "@/lib/workspace/model";
import { authOf } from "@/lib/workspace/model";

// A hand-built RESOLVED wire request (toFetch consumes buildHttpRequest output),
// same fixture shape as to-curl.test.ts's `wire()`.
const wire = (
  over: Partial<HttpRequest> & {
    method?: HttpMethod;
    headers?: KeyValue[];
    body?: string | null;
    auth?: Auth;
  } = {},
): HttpRequest => ({
  method: "GET",
  url: "https://api.example.com/widgets",
  headers: [],
  body: null,
  auth: authOf({ active: "none" }),
  timeoutMs: 30000,
  httpVersion: "auto",
  requestId: "rid",
  ...over,
});

// A JS/JSON double-quoted string literal (handles backslash escapes), used to
// pull an emitted literal back out of the code so JSON.parse can round-trip it.
const STRING_LITERAL = "(\"(?:[^\"\\\\]|\\\\.)*\")";

describe("toFetch - shape (AC-009)", () => {
  // AC-009, TC-001 - behavior: POST + JSON body + 2 headers emits a fetch call
  // with method, a headers object, and a body, each string JSON.stringify'd.
  it("should emit fetch(url, { method, headers, body }) with quoted keys/values if the request has a body and headers", () => {
    const req = wire({
      method: "POST",
      headers: [
        { key: "Content-Type", value: "application/json" },
        { key: "X-Trace", value: "abc" },
      ],
      body: '{"name":"foo"}',
    });

    const out = toFetch(req);

    expect(out.startsWith("fetch(")).toBe(true);
    expect(out.trimEnd().endsWith(";")).toBe(true);
    expect(out).toMatch(/method:\s*"POST"/);

    // url is the first arg, emitted as a JS string literal that round-trips.
    const urlLit = out.match(new RegExp(`fetch\\(\\s*${STRING_LITERAL}`));
    expect(urlLit).not.toBeNull();
    expect(JSON.parse(urlLit![1])).toBe(req.url);

    // each header key + value is a JS string literal.
    expect(out).toMatch(/"Content-Type":\s*"application\/json"/);
    expect(out).toMatch(/"X-Trace":\s*"abc"/);

    // body is a JS string literal that round-trips to the wire body.
    const bodyLit = out.match(new RegExp(`body:\\s*${STRING_LITERAL}`));
    expect(bodyLit).not.toBeNull();
    expect(JSON.parse(bodyLit![1])).toBe('{"name":"foo"}');
  });

  // AC-009 - behavior: method is ALWAYS emitted, even for a bare GET.
  it("should always emit the method even for a GET", () => {
    const out = toFetch(wire({ method: "GET" }));

    expect(out).toMatch(/method:\s*"GET"/);
  });

  // TC-011, AC-012 - behavior: a QUERY wire request emits method "QUERY" (and its
  // body, since QUERY is not bodyless on the wire).
  it("should emit the method QUERY and its body for a QUERY request", () => {
    const out = toFetch(wire({ method: "QUERY", body: '{"q":1}' }));

    expect(out).toMatch(/method:\s*"QUERY"/);
    expect(out).toMatch(/body:\s*"/);
  });

  // AC-009, TC-002 - edge: a GET with no headers omits BOTH the headers object
  // and the body key.
  it("should omit the headers object and the body key if the request has no headers and no body", () => {
    const out = toFetch(wire({ method: "GET" }));

    expect(out).toMatch(/method:\s*"GET"/);
    expect(out).not.toMatch(/^\s*headers:/m);
    expect(out).not.toMatch(/^\s*body:/m);
  });

  // AC-009, TC-003 - edge: an empty-string body omits the body key.
  it("should omit the body key if the body is an empty string", () => {
    const out = toFetch(wire({ method: "POST", body: "" }));

    expect(out).toMatch(/method:\s*"POST"/);
    expect(out).not.toMatch(/^\s*body:/m);
  });

  // AC-009 - edge: a null body omits the body key.
  it("should omit the body key if the body is null", () => {
    const out = toFetch(wire({ method: "DELETE", body: null }));

    expect(out).toMatch(/method:\s*"DELETE"/);
    expect(out).not.toMatch(/^\s*body:/m);
  });

  // AC-009 - edge: with headers but no body, the headers object is present and
  // the body key is absent.
  it("should emit the headers object but omit the body key if there are headers and no body", () => {
    const out = toFetch(
      wire({ method: "GET", headers: [{ key: "Accept", value: "*/*" }] }),
    );

    expect(out).toMatch(/"Accept":\s*"\*\/\*"/);
    expect(out).not.toMatch(/^\s*body:/m);
  });
});

describe("toFetch - escaping (AC-010)", () => {
  // AC-010, TC-004 - behavior: a body with a double-quote, newline, and
  // backslash is escaped so the emitted literal JSON.parses back to the input.
  it("should escape double-quotes, newlines, and backslashes in the body so the emitted literal round-trips", () => {
    const body = 'a "quoted"\nsecond\\line';
    const out = toFetch(wire({ method: "POST", body }));

    const lit = out.match(new RegExp(`body:\\s*${STRING_LITERAL}`));
    expect(lit).not.toBeNull();
    // no raw (unescaped) newline should leak into the source.
    expect(lit![1]).not.toContain("\n");
    expect(JSON.parse(lit![1])).toBe(body);
  });

  // AC-010, TC-005 - behavior: a header value with a double-quote, newline, and
  // backslash is escaped in the headers object and round-trips.
  it("should escape a double-quote, newline, and backslash inside a header value", () => {
    const value = 'v"q\nn\\b';
    const out = toFetch(
      wire({ method: "GET", headers: [{ key: "X-Note", value }] }),
    );

    const lit = out.match(new RegExp(`"X-Note":\\s*${STRING_LITERAL}`));
    expect(lit).not.toBeNull();
    expect(JSON.parse(lit![1])).toBe(value);
  });

  // AC-010 - behavior: a url with a double-quote, newline, and backslash is
  // escaped in the first fetch argument and round-trips.
  it("should escape a double-quote, newline, and backslash inside the url", () => {
    const url = 'https://x/"a"\n\\b';
    const out = toFetch(wire({ method: "GET", url }));

    const lit = out.match(new RegExp(`fetch\\(\\s*${STRING_LITERAL}`));
    expect(lit).not.toBeNull();
    expect(lit![1]).not.toContain("\n");
    expect(JSON.parse(lit![1])).toBe(url);
  });
});
