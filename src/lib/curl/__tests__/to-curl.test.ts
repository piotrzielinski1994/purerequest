import { describe, it, expect } from "vitest";

import { toCurl } from "@/lib/curl/to-curl";
import type { HttpRequest } from "@/lib/http/model";
import type { Auth, HttpMethod, KeyValue } from "@/lib/workspace/model";
import { authOf } from "@/lib/workspace/model";

// A hand-built RESOLVED wire request (toCurl consumes buildHttpRequest output).
// Defaults mirror a typical wire shape: no auth header re-emission, body the
// caller controls. requestId/timeoutMs are present but never serialized.
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
  requestId: "rid",
  ...over,
});

describe("toCurl - shape (AC-001)", () => {
  // AC-001, TC-001 - behavior: method via -X, single-quoted url, one -H per
  // resolved header in order (auth already a header, not re-emitted from .auth).
  it("should emit -X METHOD, the single-quoted url, and one -H per resolved header in order", () => {
    const req = wire({
      method: "POST",
      url: "https://api.example.com/widgets?page=2",
      headers: [
        { key: "Authorization", value: "Bearer abc123" },
        { key: "Content-Type", value: "application/json" },
      ],
      auth: authOf({ active: "bearer", token: "abc123" }),
      body: '{"name":"foo"}',
    });

    const out = toCurl(req);

    expect(out).toBe(
      "curl -X POST 'https://api.example.com/widgets?page=2' \\\n" +
        "  -H 'Authorization: Bearer abc123' \\\n" +
        "  -H 'Content-Type: application/json' \\\n" +
        "  --data-raw '{\"name\":\"foo\"}'",
    );
  });

  // AC-001 - behavior: header order is preserved exactly as on the wire request.
  it("should preserve resolved header order", () => {
    const req = wire({
      method: "GET",
      headers: [
        { key: "B", value: "2" },
        { key: "A", value: "1" },
      ],
    });

    const out = toCurl(req);
    const bIndex = out.indexOf("-H 'B: 2'");
    const aIndex = out.indexOf("-H 'A: 1'");

    expect(bIndex).toBeGreaterThanOrEqual(0);
    expect(aIndex).toBeGreaterThan(bIndex);
  });

  // AC-001 - behavior: a request with no headers emits no -H flags.
  it("should emit no -H flags if the wire request has no headers", () => {
    const out = toCurl(wire({ method: "GET" }));

    expect(out).toBe("curl -X GET 'https://api.example.com/widgets'");
  });
});

describe("toCurl - body / --data-raw (AC-002)", () => {
  // AC-002 - behavior: a non-empty wire body is emitted via --data-raw.
  it("should emit --data-raw for a non-empty wire body", () => {
    const out = toCurl(wire({ method: "POST", body: "x=1" }));

    expect(out).toContain("--data-raw 'x=1'");
  });

  // AC-002, TC-002 - edge: a GET (wire body null) emits no data flag.
  it("should emit no data flag if the wire body is null (GET/DELETE)", () => {
    const out = toCurl(wire({ method: "GET", body: null }));

    expect(out).not.toContain("--data-raw");
    expect(out).not.toContain("-d ");
  });

  // AC-002, TC-002 - edge: an empty-string wire body emits no data flag.
  it("should emit no data flag if the wire body is an empty string", () => {
    const out = toCurl(wire({ method: "POST", body: "" }));

    expect(out).not.toContain("--data-raw");
    expect(out).not.toContain("-d ");
  });
});

describe("toCurl - quoting (AC-003)", () => {
  // AC-003, TC-001 - behavior: an embedded single quote in the body is escaped
  // with the POSIX '\'' idiom (close, escaped quote, reopen).
  it("should escape an embedded single quote in the body via the '\\'' idiom", () => {
    const out = toCurl(wire({ method: "POST", body: "name='foo'" }));

    expect(out).toContain("--data-raw 'name='\\''foo'\\'''");
  });

  // AC-003 - behavior: a single quote inside a header value is escaped too.
  it("should escape a single quote inside a header value", () => {
    const out = toCurl(
      wire({
        method: "GET",
        headers: [{ key: "X-Note", value: "it's here" }],
      }),
    );

    expect(out).toContain("-H 'X-Note: it'\\''s here'");
  });

  // AC-003 - behavior: a newline inside the body survives literally in-quote.
  it("should keep a newline inside the body literal within single quotes", () => {
    const out = toCurl(wire({ method: "POST", body: "line1\nline2" }));

    expect(out).toContain("--data-raw 'line1\nline2'");
  });
});
