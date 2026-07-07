import { describe, it, expect } from "vitest";

import { buildHttpRequest } from "@/lib/http/build-request";
import type { EffectiveConfig } from "@/lib/workspace/resolve";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";
import type { Auth, KeyValue, RequestNode } from "@/lib/workspace/model";

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

describe("buildHttpRequest - query dedup by key (AC-015)", () => {
  // AC-015 - behavior: a key present in BOTH the url query and the request's query
  // params is sent once (the url value wins), not duplicated.
  it("should not duplicate a key that is in both the url and the query params", () => {
    const node = request({
      id: "r",
      url: "https://api.com/get?qwe=123",
      params: { path: [], query: queryParams({ qwe: "123" }) },
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.url).toBe("https://api.com/get?qwe=123");
  });

  // AC-015 - behavior: when the url and the query params disagree on a key's value,
  // the url value wins (it is the request's own mirror) and the param is not re-added.
  it("should let the url value win for a key present in both", () => {
    const node = request({
      id: "r",
      url: "https://api.com/get?qwe=123",
      params: { path: [], query: queryParams({ qwe: "999" }) },
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.url).toBe("https://api.com/get?qwe=123");
  });

  // AC-015, AC-016 - behavior: a query param whose key is NOT in the url still
  // appends, alongside the url's own query.
  it("should still append a query param key that is not in the url", () => {
    const node = request({
      id: "r",
      url: "https://api.com/get?qwe=123",
      params: { path: [], query: queryParams({ foo: "bar" }) },
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.url).toBe("https://api.com/get?qwe=123&foo=bar");
  });
});
