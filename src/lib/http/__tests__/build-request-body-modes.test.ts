import { describe, it, expect } from "vitest";

import { buildHttpRequest } from "@/lib/http/build-request";
import type { EffectiveConfig } from "@/lib/workspace/resolve";
import type {
  Auth,
  HttpMethod,
  KeyValue,
  RequestNode,
} from "@/lib/workspace/model";
import { authOf } from "@/lib/workspace/model";

// The test authors requests in the legacy flat style (`body` string + `bodyMode`
// + `bodyForm`); the builder folds those into the new `body` object so the many
// cases below stay readable. `body` is the json text, `bodyForm` the rows for the
// active form/multipart mode.
type BodyMode = "json" | "none" | "form" | "multipart";
type BodyModeExtras = {
  body?: string;
  bodyMode?: BodyMode;
  bodyForm?: KeyValue[];
};

const request = (
  overrides: Omit<Partial<RequestNode>, "body"> &
    BodyModeExtras & { id: string },
): RequestNode => {
  const { body, bodyMode, bodyForm, ...rest } = overrides;
  const active = bodyMode ?? "json";
  const rows = bodyForm ?? [];
  return {
    kind: "request",
    name: overrides.name ?? overrides.id,
    method: "POST",
    url: "https://example.test/path",
    params: { path: [], query: [] },
    config: {},
    ...rest,
    body: {
      active,
      types: {
        json: body ?? "",
        form: active === "form" ? rows : [],
        multipart: active === "multipart" ? rows : [],
      },
    },
  };
};

// Mirrors build-request.test.ts: a hand-built EffectiveConfig pins the resolved
// inputs buildHttpRequest consumes (resolveConfig is exercised elsewhere).
const effectiveOf = (over: {
  variables?: Record<string, string>;
  headers?: Record<string, string>;
  auth?: Auth;
  timeoutMs?: number;
}): EffectiveConfig => {
  const from = { scopeId: "test", scopeName: "test" };
  const wrapKeyed = (entries?: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(entries ?? {}).map(([k, v]) => [k, { value: v, from }]),
    );
  return {
    variables: wrapKeyed(over.variables),
    headers: wrapKeyed(over.headers),
    auth: { value: over.auth ?? authOf({ active: "none" }), from },
    scripts: { pre: { value: "", from }, post: { value: "", from } },
    timeoutMs: { value: over.timeoutMs ?? 30000, from },
  };
};

const contentTypeHeaders = (headers: KeyValue[]) =>
  headers.filter((h) => h.key.toLowerCase() === "content-type");

const contentTypeOf = (headers: KeyValue[]) =>
  contentTypeHeaders(headers)[0]?.value;

describe("buildHttpRequest - json mode (default)", () => {
  // AC-001 - behavior: bodyMode absent resolves to json; body passes through.
  it("should pass the body through verbatim if bodyMode is absent (json default)", () => {
    const node = request({ id: "r", method: "POST", body: '{"a":1}' });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.body).toBe('{"a":1}');
  });

  // AC-001 - behavior: json mode auto-adds Content-Type application/json.
  it("should auto-add Content-Type application/json if bodyMode is absent", () => {
    const node = request({ id: "r", method: "POST", body: '{"a":1}' });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(contentTypeOf(wire.headers)).toBe("application/json");
  });

  // AC-001 - behavior: an explicit json mode behaves identically to the default.
  it("should pass the body through and auto-add application/json if bodyMode is json", () => {
    const node = request({
      id: "r",
      method: "POST",
      body: '{"a":1}',
      bodyMode: "json",
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.body).toBe('{"a":1}');
    expect(contentTypeOf(wire.headers)).toBe("application/json");
  });
});

describe("buildHttpRequest - none mode", () => {
  // AC-002, TC-003 - behavior: none on a POST sends no body and no Content-Type.
  it("should send a null body and no Content-Type if bodyMode is none on a POST", () => {
    const node = request({
      id: "r",
      method: "POST",
      body: '{"a":1}',
      bodyMode: "none",
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.body).toBeNull();
    expect(contentTypeHeaders(wire.headers)).toHaveLength(0);
  });
});

describe("buildHttpRequest - form mode", () => {
  // AC-003, TC-001 - behavior: enabled rows encode to a=1&b=2.
  it("should encode enabled rows as a=1&b=2 if bodyMode is form", () => {
    const node = request({
      id: "r",
      method: "POST",
      bodyMode: "form",
      bodyForm: [
        { key: "a", value: "1" },
        { key: "b", value: "2" },
      ],
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.body).toBe("a=1&b=2");
  });

  // AC-003, TC-001 - behavior: form mode auto-sets the urlencoded Content-Type.
  it("should auto-set Content-Type application/x-www-form-urlencoded if bodyMode is form", () => {
    const node = request({
      id: "r",
      method: "POST",
      bodyMode: "form",
      bodyForm: [{ key: "a", value: "1" }],
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(contentTypeOf(wire.headers)).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  // AC-003, AC-006, TC-005 - behavior: keys and values are percent-encoded so
  // the wire round-trips through URLSearchParams back to the original pair.
  it("should percent-encode special chars in form keys and values", () => {
    const node = request({
      id: "r",
      method: "POST",
      bodyMode: "form",
      bodyForm: [{ key: "a b", value: "a&b" }],
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    // don't over-pin the space encoding (+ vs %20); assert the special chars are
    // escaped and the pair decodes back to the original key/value.
    expect(wire.body).not.toContain("a&b");
    expect(wire.body).toMatch(/a(\+|%20)b=a%26b/);
    const decoded = new URLSearchParams(wire.body ?? "");
    expect(decoded.get("a b")).toBe("a&b");
  });

  // AC-006, TC-005 - behavior: a disabled row is excluded from the wire.
  it("should exclude an enabled:false row from the form body", () => {
    const node = request({
      id: "r",
      method: "POST",
      bodyMode: "form",
      bodyForm: [
        { key: "a", value: "1" },
        { key: "skip", value: "x", enabled: false },
        { key: "b", value: "2" },
      ],
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.body).toBe("a=1&b=2");
    expect(wire.body).not.toContain("skip");
  });

  // AC-006, TC-005 - behavior: {{var}} tokens in both key and value are
  // interpolated from effective variables before encoding.
  it("should interpolate {{var}} in both form key and value", () => {
    const node = request({
      id: "r",
      method: "POST",
      bodyMode: "form",
      bodyForm: [{ key: "{{k}}", value: "{{v}}" }],
    });

    const wire = buildHttpRequest(
      node,
      effectiveOf({ variables: { k: "mykey", v: "myval" } }),
    );

    expect(wire.body).toContain("mykey=myval");
  });

  // AC-008, TC-008 - edge: an empty form sends an empty string body (not null),
  // and still auto-sets the Content-Type.
  it("should send an empty string body but still set Content-Type if the form has no rows", () => {
    const node = request({
      id: "r",
      method: "POST",
      bodyMode: "form",
      bodyForm: [],
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.body).toBe("");
    expect(contentTypeOf(wire.headers)).toBe(
      "application/x-www-form-urlencoded",
    );
  });
});

describe("buildHttpRequest - multipart mode", () => {
  // AC-004, TC-002 - behavior: a row becomes a Content-Disposition text part,
  // and the Content-Type boundary delimits that part in the body.
  it("should encode a row as a multipart text part with a boundary matching the Content-Type", () => {
    const node = request({
      id: "r",
      method: "POST",
      bodyMode: "multipart",
      bodyForm: [{ key: "a", value: "1" }],
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    const contentType = contentTypeOf(wire.headers) ?? "";
    const match = contentType.match(/^multipart\/form-data; boundary=(.+)$/);
    expect(match).not.toBeNull();
    const boundary = match![1];

    expect(wire.body).toContain(`--${boundary}`);
    expect(wire.body).toContain('name="a"');
    expect(wire.body).toContain("1");
    // RFC 7578 CRLF line endings.
    expect(wire.body).toContain("\r\n");
  });

  // AC-008, edge (spec §8) - behavior: an empty multipart still emits the closing
  // delimiter (a valid empty document) and keeps the multipart Content-Type.
  it("should emit only the closing boundary if multipart has no rows", () => {
    const node = request({
      id: "r",
      method: "POST",
      bodyMode: "multipart",
      bodyForm: [],
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    const contentType = contentTypeOf(wire.headers) ?? "";
    const boundary = contentType.match(
      /^multipart\/form-data; boundary=(.+)$/,
    )![1];
    expect(wire.body).toBe(`--${boundary}--\r\n`);
    expect(wire.body).not.toContain("Content-Disposition");
  });
});

describe("buildHttpRequest - empty-key rows", () => {
  // edge (spec §8) - behavior: a row whose key resolves to blank/whitespace is
  // dropped from both form and multipart wire output.
  it("should drop a blank-key row from the form body", () => {
    const node = request({
      id: "r",
      method: "POST",
      bodyMode: "form",
      bodyForm: [
        { key: "  ", value: "skip" },
        { key: "a", value: "1" },
      ],
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.body).toBe("a=1");
    expect(wire.body).not.toContain("skip");
  });

  it("should drop a blank-key row from the multipart body", () => {
    const node = request({
      id: "r",
      method: "POST",
      bodyMode: "multipart",
      bodyForm: [
        { key: "", value: "skip" },
        { key: "a", value: "1" },
      ],
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.body).toContain('name="a"');
    expect(wire.body).not.toContain("skip");
  });
});

describe("buildHttpRequest - user Content-Type override", () => {
  const modes: BodyMode[] = ["json", "form", "multipart"];

  modes.forEach((mode) => {
    // AC-005, TC-004 - behavior: an explicit (case-insensitive) Content-Type
    // header wins; exactly that one header is sent, the auto one is not added.
    it(`should send only the user Content-Type and not the auto one if set for ${mode} mode`, () => {
      const node = request({
        id: "r",
        method: "POST",
        body: '{"a":1}',
        bodyMode: mode,
        bodyForm: [{ key: "a", value: "1" }],
      });

      const wire = buildHttpRequest(
        node,
        effectiveOf({ headers: { "content-type": "text/plain" } }),
      );

      const cts = contentTypeHeaders(wire.headers);
      expect(cts).toHaveLength(1);
      expect(cts[0].value).toBe("text/plain");
    });
  });
});

describe("buildHttpRequest - bodyless methods ignore mode", () => {
  const bodylessMethods: HttpMethod[] = ["GET", "DELETE"];
  const modes: BodyMode[] = ["json", "form", "multipart"];

  bodylessMethods.forEach((method) => {
    modes.forEach((mode) => {
      // AC-007, TC-003 - behavior: GET/DELETE always drop the body and the auto
      // Content-Type, regardless of the body mode.
      it(`should send a null body and no auto Content-Type for ${method} in ${mode} mode`, () => {
        const node = request({
          id: "r",
          method,
          body: '{"a":1}',
          bodyMode: mode,
          bodyForm: [{ key: "a", value: "1" }],
        });

        const wire = buildHttpRequest(node, effectiveOf({}));

        expect(wire.body).toBeNull();
        expect(contentTypeHeaders(wire.headers)).toHaveLength(0);
      });
    });
  });
});
