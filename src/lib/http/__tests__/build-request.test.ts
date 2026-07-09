import { describe, it, expect } from "vitest";

import { buildHttpRequest } from "@/lib/http/build-request";
import { resolveConfig } from "@/lib/workspace/resolve";
import type { EffectiveConfig } from "@/lib/workspace/resolve";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";
import type {
  Auth,
  HttpMethod,
  KeyValue,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";

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

// A hand-built EffectiveConfig so each test pins exactly the resolved inputs
// buildHttpRequest consumes (resolveConfig is exercised in resolve.test.ts).
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

describe("buildHttpRequest - method and url", () => {
  // AC-003 — behavior
  it("should carry the node method and url through to the wire request", () => {
    const node = request({
      id: "r",
      method: "POST",
      url: "https://api.example.com/items",
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.method).toBe("POST");
    expect(wire.url).toBe("https://api.example.com/items");
  });

  // AC-003 — behavior
  it("should carry timeoutMs from the effective config", () => {
    const node = request({ id: "r" });

    const wire = buildHttpRequest(node, effectiveOf({ timeoutMs: 5000 }));

    expect(wire.timeoutMs).toBe(5000);
  });
});

describe("buildHttpRequest - variable substitution", () => {
  // AC-004, TC-002 — behavior
  it("should substitute {{var}} tokens in the url from effective variables", () => {
    const node = request({ id: "r", url: "{{baseUrl}}/get" });

    const wire = buildHttpRequest(
      node,
      effectiveOf({ variables: { baseUrl: "https://postman-echo.com" } }),
    );

    expect(wire.url).toBe("https://postman-echo.com/get");
  });

  // AC-004 — behavior
  it("should substitute {{var}} tokens in header values", () => {
    const node = request({ id: "r" });

    const wire = buildHttpRequest(
      node,
      effectiveOf({
        variables: { apiKey: "secret-123" },
        headers: { "X-Api-Key": "{{apiKey}}" },
      }),
    );

    const header = wire.headers.find((h) => h.key === "X-Api-Key");
    expect(header?.value).toBe("secret-123");
  });

  // AC-004 — behavior
  it("should substitute {{var}} tokens in resolved param values before appending them", () => {
    const node = request({
      id: "r",
      url: "https://api.example.com/get",
      params: { path: [], query: queryParams({ stage: "{{env}}" }) },
    });

    const wire = buildHttpRequest(
      node,
      effectiveOf({ variables: { env: "prod" } }),
    );

    expect(wire.url).toBe("https://api.example.com/get?stage=prod");
  });
});

describe("buildHttpRequest - query param merge", () => {
  // AC-004, TC-002 — behavior
  it("should append resolved params to a url that has no existing query", () => {
    const node = request({
      id: "r",
      url: "https://postman-echo.com/get",
      params: { path: [], query: queryParams({ foo: "bar" }) },
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.url).toBe("https://postman-echo.com/get?foo=bar");
  });

  // AC-004 — behavior
  it("should preserve an existing ?query in the url and merge resolved params into it", () => {
    const node = request({
      id: "r",
      url: "https://api.example.com/get?keep=1",
      params: { path: [], query: queryParams({ foo: "bar" }) },
    });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.url).toContain("keep=1");
    expect(wire.url).toContain("foo=bar");
    expect(wire.url.startsWith("https://api.example.com/get?")).toBe(true);
  });

  // AC-004 — behavior
  it("should leave the url unchanged if there are no resolved params", () => {
    const node = request({ id: "r", url: "https://api.example.com/get" });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(wire.url).toBe("https://api.example.com/get");
  });
});

describe("buildHttpRequest - auth mapping", () => {
  // AC-003 — behavior
  it("should map bearer auth to an Authorization: Bearer header", () => {
    const node = request({ id: "r" });

    const wire = buildHttpRequest(
      node,
      effectiveOf({ auth: authOf({ active: "bearer", token: "tok-abc" }) }),
    );

    const header = wire.headers.find(
      (h) => h.key.toLowerCase() === "authorization",
    );
    expect(header?.value).toBe("Bearer tok-abc");
  });

  // AC-003 — behavior
  it("should map basic auth to an Authorization: Basic base64(user:pass) header", () => {
    const node = request({ id: "r" });

    const wire = buildHttpRequest(
      node,
      effectiveOf({
        auth: authOf({ active: "basic", username: "alice", password: "s3cret" }),
      }),
    );

    const header = wire.headers.find(
      (h) => h.key.toLowerCase() === "authorization",
    );
    const expected = `Basic ${btoa("alice:s3cret")}`;
    expect(header?.value).toBe(expected);
  });

  // AC-003 — behavior
  it("should add no Authorization header when auth is none", () => {
    const node = request({ id: "r" });

    const wire = buildHttpRequest(
      node,
      effectiveOf({ auth: authOf({ active: "none" }) }),
    );

    const header = wire.headers.find(
      (h) => h.key.toLowerCase() === "authorization",
    );
    expect(header).toBeUndefined();
  });
});

describe("buildHttpRequest - body per method", () => {
  const bodyCarryingMethods: HttpMethod[] = ["POST", "PUT", "PATCH"];
  const bodylessMethods: HttpMethod[] = ["GET", "DELETE"];

  bodyCarryingMethods.forEach((method) => {
    // AC-003, spec §6 — behavior
    it(`should carry the node body for ${method}`, () => {
      const node = request({
        id: "r",
        method,
        body: { active: "json", types: { json: '{"a":1}', form: [], multipart: [], graphql: { query: "", variables: "" } } },
      });

      const wire = buildHttpRequest(node, effectiveOf({}));

      expect(wire.body).toBe('{"a":1}');
    });
  });

  bodylessMethods.forEach((method) => {
    // AC-003, spec §6 — behavior: GET/DELETE drop the body
    it(`should set body to null for ${method} even if the node has a body`, () => {
      const node = request({
        id: "r",
        method,
        body: { active: "json", types: { json: '{"a":1}', form: [], multipart: [], graphql: { query: "", variables: "" } } },
      });

      const wire = buildHttpRequest(node, effectiveOf({}));

      expect(wire.body).toBeNull();
    });
  });
});

describe("buildHttpRequest - requestId correlation", () => {
  // TC-008, AC-007 - behavior: the wire request carries a non-empty requestId.
  it("should attach a non-empty requestId to the built wire request", () => {
    const node = request({ id: "r" });

    const wire = buildHttpRequest(node, effectiveOf({}));

    expect(typeof wire.requestId).toBe("string");
    expect(wire.requestId.length).toBeGreaterThan(0);
  });

  // TC-008, AC-007 - behavior: a fresh id per send invocation (not the node id).
  it("should generate a distinct requestId for each build invocation", () => {
    const node = request({ id: "r" });

    const first = buildHttpRequest(node, effectiveOf({}));
    const second = buildHttpRequest(node, effectiveOf({}));

    expect(first.requestId).not.toBe(second.requestId);
  });
});

describe("buildHttpRequest - integration with resolveConfig", () => {
  // AC-004, TC-002 — behavior: real EffectiveConfig from the tree resolves and merges.
  it("should build the final url from a real resolved tree (var + params)", () => {
    const node = request({
      id: "req-1",
      method: "GET",
      url: "{{baseUrl}}/get",
      params: { path: [], query: queryParams({ foo: "bar" }) },
    });
    const tree: TreeNode[] = [
      {
        kind: "folder",
        id: "root",
        name: "Root",
        config: {
          variables: [{ key: "baseUrl", value: "https://postman-echo.com" }],
        },
        children: [node],
      },
    ];

    const wire = buildHttpRequest(node, resolveConfig(tree, "req-1"));

    expect(wire.url).toBe("https://postman-echo.com/get?foo=bar");
  });
});
