import { describe, expect, it } from "vitest";

import { buildHttpRequest } from "@/lib/http/build-request";
import type { Auth, KeyValue, RequestNode } from "@/lib/workspace/model";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";
import type { EffectiveConfig } from "@/lib/workspace/resolve";

const request = (
  overrides: Partial<RequestNode> & { id: string },
): RequestNode => ({
  kind: "request",
  name: overrides.name ?? overrides.id,
  method: "GET",
  url: "https://example.test/path",
  body: emptyBody(),
  params: emptyParams(),
  config: {},
  ...overrides,
});

const queryParams = (entries: Record<string, string>): KeyValue[] =>
  Object.entries(entries).map(([key, value]) => ({ key, value }));

// Mirrors build-request.test.ts: a hand-built EffectiveConfig pins the resolved
// inputs buildHttpRequest consumes (resolveConfig is exercised elsewhere).
const effectiveOf = (over: {
  variables?: Record<string, string>;
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
    headers: {},
    auth: { value: over.auth ?? authOf({ active: "none" }), from },
    scripts: { pre: { value: "", from }, post: { value: "", from } },
    timeoutMs: { value: over.timeoutMs ?? 30000, from },
  };
};

describe("buildHttpRequest - path param substitution (AC-006)", () => {
  // AC-006, TC-006 - behavior: a :name in the url is replaced by its pathParams value.
  it("should substitute a :name in the url from the request pathParams", () => {
    const node = request({
      id: "r",
      url: "https://api.com/users/:id",
      params: { path: [{ key: "id", value: "42" }], query: [] },
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.url).toBe("https://api.com/users/42");
  });

  // AC-006, E-2, TC-007 - behavior: a repeated :name is replaced at every occurrence.
  it("should replace every occurrence of a repeated :name with the one value", () => {
    const node = request({
      id: "r",
      url: "https://api.com/:id/x/:id",
      params: { path: [{ key: "id", value: "9" }], query: [] },
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.url).toBe("https://api.com/9/x/9");
  });

  // AC-006, E-4, TC-006 - behavior: a {{var}} inside a path-param value is
  // interpolated from effective variables before substitution.
  it("should interpolate a {{var}} in a path-param value before substituting it", () => {
    const node = request({
      id: "r",
      url: "https://api.com/users/:id",
      params: { path: [{ key: "id", value: "{{uid}}" }], query: [] },
    });

    const wire = buildHttpRequest(
      node,
      effectiveOf({ variables: { uid: "7" } }),
    );

    expect(wire.url).toBe("https://api.com/users/7");
  });

  // AC-006 - behavior: path substitution runs alongside the existing {{var}}
  // interpolation of the rest of the url (the base) - both resolve.
  it("should substitute the path param and still interpolate {{base}} in the rest of the url", () => {
    const node = request({
      id: "r",
      url: "{{base}}/users/:id",
      params: { path: [{ key: "id", value: "42" }], query: [] },
    });

    const wire = buildHttpRequest(
      node,
      effectiveOf({ variables: { base: "https://api.com" } }),
    );

    expect(wire.url).toBe("https://api.com/users/42");
  });

  // AC-006 - behavior: path params are substituted BEFORE query params are appended.
  it("should substitute the path param and then append the query params", () => {
    const node = request({
      id: "r",
      url: "https://api.com/users/:id",
      params: {
        path: [{ key: "id", value: "42" }],
        query: queryParams({ foo: "bar" }),
      },
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.url).toBe("https://api.com/users/42?foo=bar");
  });

  // AC-009, E-1 - behavior: a :8080 port is not substituted, only the real :name is.
  it("should leave a :8080 port intact while substituting the :name path param", () => {
    const node = request({
      id: "r",
      url: "https://host:8080/users/:id",
      params: { path: [{ key: "id", value: "42" }], query: [] },
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.url).toBe("https://host:8080/users/42");
  });
});

describe("buildHttpRequest - empty path param stays literal (AC-007)", () => {
  // AC-007, E-3, TC-008 - behavior: an empty path-param value leaves the :name in
  // the sent url verbatim.
  it("should keep the :name literal in the sent url if the path param value is empty", () => {
    const node = request({
      id: "r",
      url: "https://api.com/users/:id",
      params: { path: [{ key: "id", value: "" }], query: [] },
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.url).toBe("https://api.com/users/:id");
  });

  // AC-007, TC-008 - behavior: a :name with no pathParams at all stays literal.
  it("should keep the :name literal if the request has no pathParams", () => {
    const node = request({ id: "r", url: "https://api.com/users/:id" });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.url).toBe("https://api.com/users/:id");
  });

  // AC-006, AC-007 - behavior: a filled param substitutes while an empty sibling
  // stays literal, then query params still append.
  it("should substitute a filled path param, keep an empty one literal, and append query", () => {
    const node = request({
      id: "r",
      url: "https://api.com/users/:id/posts/:postId",
      params: {
        path: [
          { key: "id", value: "42" },
          { key: "postId", value: "" },
        ],
        query: queryParams({ q: "x" }),
      },
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.url).toBe("https://api.com/users/42/posts/:postId?q=x");
  });
});
