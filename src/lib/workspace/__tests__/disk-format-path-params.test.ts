import { describe, expect, it } from "vitest";
import type { FileMap } from "@/lib/workspace/disk-format";
import { deserialize, serialize } from "@/lib/workspace/disk-format";
import type { KeyValue, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

const request = (
  name: string,
  overrides: Partial<RequestNode> = {},
): RequestNode => ({
  kind: "request",
  id: `pending-${name}`,
  name,
  method: "GET",
  url: `https://example.test/${name}/:id`,
  body: emptyBody(),
  params: emptyParams(),
  config: {},
  ...overrides,
});

const pathRows = (path: Record<string, string>): KeyValue[] =>
  Object.entries(path).map(([key, value]) => ({ key, value }));

const withPath = (name: string, path: Record<string, string>): RequestNode =>
  request(name, { params: { path: pathRows(path), query: [] } });

const expectOk = (result: ReturnType<typeof deserialize>) => {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error}`);
  }
  return result;
};

const loadedRequest = (
  result: ReturnType<typeof expectOk>,
  name: string,
): RequestNode => {
  const node = result.tree.find(
    (n): n is RequestNode => n.kind === "request" && n.name === name,
  );
  if (!node) {
    throw new Error(`request ${name} not found in deserialized tree`);
  }
  return node;
};

const reqJson = (map: FileMap, slugPrefix: string): Record<string, unknown> => {
  const entry = Object.entries(map).find(
    ([path]) => path.startsWith(slugPrefix) && path.endsWith(".req.json"),
  );
  if (!entry) {
    throw new Error(`no ${slugPrefix}*.req.json emitted`);
  }
  return JSON.parse(entry[1]) as Record<string, unknown>;
};

const paramsPathOf = (parsed: Record<string, unknown>): unknown => {
  const params = parsed.params as { path?: unknown } | undefined;
  return params?.path;
};

describe("disk-format request path params round-trip (AC-008, TC-010)", () => {
  // AC-008, TC-010 - behavior: a request's path params map survives serialize then
  // deserialize, value-for-value.
  it("should round-trip a request's path params through serialize then deserialize", () => {
    const tree: TreeNode[] = [
      withPath("Get User", { id: "42", postId: "{{p}}" }),
    ];

    const result = expectOk(deserialize(serialize(tree)));

    expect(loadedRequest(result, "Get User").params.path).toEqual([
      { key: "id", value: "42" },
      { key: "postId", value: "{{p}}" },
    ]);
  });

  // AC-008, TC-010 - behavior: a reloaded tree still carries the path params, AND
  // re-serializing it is byte-identical for the request file (emitted stably). The
  // value assertion guards against a tautological byte-compare of two empty emits.
  it("should re-serialize a request with path params byte-identically through a reload", () => {
    const tree: TreeNode[] = [withPath("Get", { id: "7" })];

    const firstMap = serialize(tree);
    const reloaded = expectOk(deserialize(firstMap));
    const secondMap = serialize(reloaded.tree);

    expect(loadedRequest(reloaded, "Get").params.path).toEqual([
      { key: "id", value: "7" },
    ]);
    const key = Object.keys(firstMap).find((path) =>
      path.endsWith(".req.json"),
    );
    expect(key).toBeDefined();
    expect(firstMap[key!]).toContain("params");
    expect(secondMap[key!]).toBe(firstMap[key!]);
  });
});

describe("disk-format path params emit-only-when-non-empty (AC-008)", () => {
  // AC-008, TC-010 - side-effect-contract: a request with at least one path param
  // writes params.path into its *.req.json.
  it("should write params.path into the req.json if the request has at least one", () => {
    const tree: TreeNode[] = [withPath("Get", { id: "9" })];

    expect(paramsPathOf(reqJson(serialize(tree), "get"))).toEqual([
      { key: "id", value: "9" },
    ]);
  });

  // AC-008, TC-010 - side-effect-contract: an empty path map is NOT emitted, while
  // a non-empty sibling IS (paired so a green run proves only the empty case is
  // omitted, not that the field is never written).
  it("should omit params from the req.json if the path map is empty", () => {
    const tree: TreeNode[] = [
      withPath("Empty", {}),
      withPath("Filled", { id: "9" }),
    ];

    const map = serialize(tree);

    expect(reqJson(map, "empty")).not.toHaveProperty("params");
    expect(paramsPathOf(reqJson(map, "filled"))).toEqual([
      { key: "id", value: "9" },
    ]);
  });

  // AC-008 - behavior: a request with no path params has an empty path map after a
  // round-trip; a sibling WITH path params still carries it (paired, non-tautological).
  it("should leave a request with an empty path map if it never had one", () => {
    const tree: TreeNode[] = [
      request("Plain"),
      withPath("WithParams", { id: "1" }),
    ];

    const result = expectOk(deserialize(serialize(tree)));

    expect(loadedRequest(result, "Plain").params.path).toEqual([]);
    expect(loadedRequest(result, "WithParams").params.path).toEqual([
      { key: "id", value: "1" },
    ]);
  });
});

describe("disk-format path params sanitize (AC-008, E-7)", () => {
  // Each garbage case is paired with a VALID sibling request ("Good", id=42) so a
  // green run proves the field is actually READ + validated - not merely never read
  // (which would make a bare "garbage -> undefined" assertion tautological). These
  // feed a legacy v3 doc (top-level pathParams) to prove the tolerant legacy read.
  const reqJsonWith = (pathParams: unknown): FileMap => ({
    "purerequest.workspace.json": JSON.stringify({
      schemaVersion: 3,
      name: "W",
    }),
    "get.req.json": JSON.stringify({
      name: "Get",
      method: "GET",
      url: "https://api/users/:id",
      body: "",
      config: {},
      order: 0,
      pathParams,
    }),
    "good.req.json": JSON.stringify({
      name: "Good",
      method: "GET",
      url: "https://api/users/:id",
      body: "",
      config: {},
      order: 1,
      pathParams: { id: "42" },
    }),
  });

  const expectGoodSiblingKept = (result: ReturnType<typeof expectOk>) =>
    expect(loadedRequest(result, "Good").params.path).toEqual([
      { key: "id", value: "42" },
    ]);

  // AC-008, E-7 - behavior: a non-string value entry is dropped while a valid
  // sibling entry in the SAME map survives.
  it("should drop a non-string path param entry but keep a valid sibling entry", () => {
    const result = expectOk(deserialize(reqJsonWith({ bad: 123, id: "42" })));

    expect(loadedRequest(result, "Get").params.path).toEqual([
      { key: "id", value: "42" },
    ]);
  });

  // AC-008, E-7 - behavior: a nested-object value entry is dropped, valid sibling kept.
  it("should drop an object-valued path param entry but keep a valid sibling entry", () => {
    const result = expectOk(
      deserialize(reqJsonWith({ bad: { nested: true }, id: "42" })),
    );

    expect(loadedRequest(result, "Get").params.path).toEqual([
      { key: "id", value: "42" },
    ]);
  });

  // AC-008, E-7 - behavior: when NO entry survives, the path map empties; the
  // request otherwise intact + the valid sibling request kept.
  it("should empty the path map if no entry is a string, keeping the rest", () => {
    const result = expectOk(deserialize(reqJsonWith({ a: 1, b: null })));
    const loaded = loadedRequest(result, "Get");

    expect(loaded.params.path).toEqual([]);
    expect(loaded.url).toBe("https://api/users/:id");
    expectGoodSiblingKept(result);
  });

  // AC-008, E-7 - behavior: a non-object pathParams (a string) is dropped, request
  // + valid sibling intact, no crash.
  it("should empty the path map for a non-object pathParams but keep the rest of the request", () => {
    const result = expectOk(deserialize(reqJsonWith("not-an-object")));
    const loaded = loadedRequest(result, "Get");

    expect(loaded.params.path).toEqual([]);
    expect(loaded.url).toBe("https://api/users/:id");
    expectGoodSiblingKept(result);
  });

  // AC-008, E-7 - behavior: a numeric pathParams leaves the request loadable (no
  // crash); a valid sibling still loads (proving the field is read).
  it("should still load the request normally if pathParams is a number", () => {
    const result = expectOk(deserialize(reqJsonWith(42)));
    const loaded = loadedRequest(result, "Get");

    expect(loaded.params.path).toEqual([]);
    expect(loaded.name).toBe("Get");
    expectGoodSiblingKept(result);
  });
});
