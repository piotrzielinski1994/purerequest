import { describe, expect, it } from "vitest";

import { buildHttpRequest } from "@/lib/http/build-request";
import type { RequestNode } from "@/lib/workspace/model";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";
import type { EffectiveConfig } from "@/lib/workspace/resolve";

const request = (
  overrides: Partial<RequestNode> & { httpVersion?: "auto" | "h3" },
): RequestNode =>
  ({
    kind: "request",
    id: "r",
    name: "r",
    method: "GET",
    url: "https://example.test/path",
    body: emptyBody(),
    params: emptyParams(),
    config: {},
    ...overrides,
  }) as RequestNode;

const effective: EffectiveConfig = (() => {
  const from = { scopeId: "test", scopeName: "test" };
  return {
    variables: {},
    headers: {},
    auth: { value: authOf({ active: "none" }), from },
    scripts: { pre: { value: "", from }, post: { value: "", from } },
    timeoutMs: { value: 30000, from },
  };
})();

describe("buildHttpRequest - httpVersion", () => {
  // Task 3 - behavior: an h3 node threads httpVersion "h3" onto the bodyless
  // (GET) wire request.
  it("should set httpVersion h3 on the wire request for a bodyless method", () => {
    const node = request({ method: "GET", httpVersion: "h3" });

    const wire = buildHttpRequest(node, effective);

    expect(wire.httpVersion).toBe("h3");
  });

  // Task 3 - behavior: an h3 node threads httpVersion "h3" onto the bodied (POST)
  // wire request.
  it("should set httpVersion h3 on the wire request for a bodied method", () => {
    const node = request({ method: "POST", httpVersion: "h3" });

    const wire = buildHttpRequest(node, effective);

    expect(wire.httpVersion).toBe("h3");
  });

  // Task 3 - behavior: a node with no version defaults to auto on the bodyless
  // wire request.
  it("should default httpVersion to auto on the wire request for a bodyless method", () => {
    const node = request({ method: "GET" });

    const wire = buildHttpRequest(node, effective);

    expect(wire.httpVersion).toBe("auto");
  });

  // Task 3 - behavior: a node with no version defaults to auto on the bodied wire
  // request.
  it("should default httpVersion to auto on the wire request for a bodied method", () => {
    const node = request({ method: "POST" });

    const wire = buildHttpRequest(node, effective);

    expect(wire.httpVersion).toBe("auto");
  });
});
