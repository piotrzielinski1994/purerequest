import { describe, expect, it } from "vitest";

import { buildHttpRequest } from "@/lib/http/build-request";
import type { Auth, RequestNode } from "@/lib/workspace/model";
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

const jsonBody = (json: string): RequestNode["body"] => ({
  active: "json",
  types: {
    json,
    form: [],
    multipart: [],
    graphql: { query: "", variables: "" },
  },
});

const authHeaderOf = (headers: { key: string; value: string }[]) =>
  headers.find((h) => h.key.toLowerCase() === "authorization");

describe("buildHttpRequest - body interpolation", () => {
  // AC-009 - behavior: {{var}} tokens in the body are interpolated for POST
  it("should interpolate {{var}} tokens in the request body for POST", () => {
    const node = request({
      id: "r",
      method: "POST",
      body: jsonBody('{"user":"{{name}}"}'),
    });

    const wire = buildHttpRequest(
      node,
      effectiveOf({ variables: { name: "ada" } }),
    );

    expect(wire.body).toBe('{"user":"ada"}');
  });

  // AC-009 - behavior: {{process.env.X}} token in the body resolves from processEnv
  it("should interpolate {{process.env.X}} in the request body", () => {
    const node = request({
      id: "r",
      method: "PUT",
      body: jsonBody('{"token":"{{process.env.JWT}}"}'),
    });

    const wire = buildHttpRequest(node, effectiveOf({}), { JWT: "ey.signed" });

    expect(wire.body).toBe('{"token":"ey.signed"}');
  });

  // AC-009 - behavior: PATCH body interpolated too
  it("should interpolate {{var}} tokens in the request body for PATCH", () => {
    const node = request({
      id: "r",
      method: "PATCH",
      body: jsonBody("amount={{amount}}"),
    });

    const wire = buildHttpRequest(
      node,
      effectiveOf({ variables: { amount: "1999" } }),
    );

    expect(wire.body).toBe("amount=1999");
  });
});

describe("buildHttpRequest - auth interpolation", () => {
  // AC-009, TC-003 - behavior: bearer token interpolated from process.env
  it("should interpolate {{process.env.X}} into the bearer token", () => {
    const node = request({ id: "r" });

    const wire = buildHttpRequest(
      node,
      effectiveOf({
        auth: authOf({ active: "bearer", token: "{{process.env.TOKEN}}" }),
      }),
      { TOKEN: "abc123" },
    );

    expect(authHeaderOf(wire.headers)?.value).toBe("Bearer abc123");
  });

  // AC-009 - behavior: bearer token interpolated from a plain variable
  it("should interpolate a {{var}} into the bearer token", () => {
    const node = request({ id: "r" });

    const wire = buildHttpRequest(
      node,
      effectiveOf({
        variables: { jwt: "ey.var" },
        auth: authOf({ active: "bearer", token: "{{jwt}}" }),
      }),
    );

    expect(authHeaderOf(wire.headers)?.value).toBe("Bearer ey.var");
  });

  // AC-009 - behavior: basic username + password interpolated before base64
  it("should interpolate {{var}} into the basic username and password", () => {
    const node = request({ id: "r" });

    const wire = buildHttpRequest(
      node,
      effectiveOf({
        variables: { user: "alice", pass: "s3cret" },
        auth: authOf({
          active: "basic",
          username: "{{user}}",
          password: "{{pass}}",
        }),
      }),
    );

    const expected = `Basic ${btoa("alice:s3cret")}`;
    expect(authHeaderOf(wire.headers)?.value).toBe(expected);
  });

  // AC-009 - behavior: basic creds resolved from process.env
  it("should interpolate {{process.env.X}} into the basic credentials", () => {
    const node = request({ id: "r" });

    const wire = buildHttpRequest(
      node,
      effectiveOf({
        auth: authOf({
          active: "basic",
          username: "{{process.env.USER}}",
          password: "{{process.env.PASS}}",
        }),
      }),
      { USER: "bob", PASS: "hunter2" },
    );

    const expected = `Basic ${btoa("bob:hunter2")}`;
    expect(authHeaderOf(wire.headers)?.value).toBe(expected);
  });
});

describe("buildHttpRequest - process.env in url and headers", () => {
  // AC-009, TC-003 - behavior: process.env token resolves in a header value
  it("should interpolate {{process.env.X}} in a header value", () => {
    const node = request({ id: "r" });

    const wire = buildHttpRequest(
      node,
      effectiveOf({
        headers: { Authorization: "Bearer {{process.env.TOKEN}}" },
      }),
      { TOKEN: "abc123" },
    );

    const header = wire.headers.find((h) => h.key === "Authorization");
    expect(header?.value).toBe("Bearer abc123");
  });

  // AC-009 - behavior: process.env token resolves in the url
  it("should interpolate {{process.env.X}} in the url", () => {
    const node = request({ id: "r", url: "{{process.env.BASE}}/get" });

    const wire = buildHttpRequest(node, effectiveOf({}), {
      BASE: "https://env.test",
    });

    expect(wire.url).toBe("https://env.test/get");
  });

  // AC-005, TC-003 - behavior: a bare {{KEY}} does not read process.env
  it("should leave a bare {{KEY}} untouched if it only exists in process.env", () => {
    const node = request({ id: "r", url: "{{TOKEN}}/get" });

    const wire = buildHttpRequest(node, effectiveOf({}), { TOKEN: "abc123" });

    expect(wire.url).toBe("{{TOKEN}}/get");
  });
});
