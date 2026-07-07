import { describe, it, expect } from "vitest";

import { serialize, deserialize } from "@/lib/workspace/disk-format";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import type {
  BodyMode,
  KeyValue,
  RequestBody,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";

const request = (
  overrides: Partial<RequestNode> & { name: string },
): RequestNode => ({
  kind: "request",
  id: `pending-${overrides.name}`,
  method: "POST",
  url: `https://example.test/${overrides.name}`,
  body: emptyBody(),
  params: emptyParams(),
  config: {},
  ...overrides,
});

const bodyOf = (
  active: BodyMode,
  slots: Partial<RequestBody["types"]> = {},
): RequestBody => ({
  active,
  types: { json: "", form: [], multipart: [], ...slots },
});

const expectOk = (result: ReturnType<typeof deserialize>) => {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error}`);
  }
  return result;
};

const firstRequest = (tree: TreeNode[]): RequestNode => {
  const node = tree[0];
  if (node.kind !== "request") {
    throw new Error("expected a request node at the root");
  }
  return node;
};

const reqFileJson = (tree: TreeNode[]): Record<string, unknown> => {
  const map = serialize(tree);
  const entry = Object.entries(map).find(([path]) =>
    path.endsWith(".req.json"),
  );
  if (!entry) {
    throw new Error("expected a .req.json file in the serialized map");
  }
  return JSON.parse(entry[1]) as Record<string, unknown>;
};

describe("disk-format body modes round-trip", () => {
  // AC-009, TC-007 - behavior: a form request round-trips its active mode + form rows.
  it("should round-trip the active mode and form rows if the request is a form request", () => {
    const rows: KeyValue[] = [
      { key: "a", value: "1" },
      { key: "b", value: "2", enabled: false },
    ];
    const tree: TreeNode[] = [
      request({ name: "Form Req", body: bodyOf("form", { form: rows }) }),
    ];

    const result = expectOk(deserialize(serialize(tree)));
    const loaded = firstRequest(result.tree);

    expect(loaded.body.active).toBe("form");
    expect(loaded.body.types.form).toEqual(rows);
  });

  // AC-009 - behavior: multipart mode + rows survive the round-trip too.
  it("should round-trip the multipart mode and its rows", () => {
    const tree: TreeNode[] = [
      request({
        name: "Multi Req",
        body: bodyOf("multipart", { multipart: [{ key: "x", value: "y" }] }),
      }),
    ];

    const result = expectOk(deserialize(serialize(tree)));
    const loaded = firstRequest(result.tree);

    expect(loaded.body.active).toBe("multipart");
    expect(loaded.body.types.multipart).toEqual([{ key: "x", value: "y" }]);
  });

  // AC-009 - behavior: a none request persists its mode.
  it("should round-trip the none mode", () => {
    const tree: TreeNode[] = [
      request({ name: "None Req", body: bodyOf("none") }),
    ];

    const result = expectOk(deserialize(serialize(tree)));
    const loaded = firstRequest(result.tree);

    expect(loaded.body.active).toBe("none");
  });
});

describe("disk-format body modes defaults omitted", () => {
  // AC-009, TC-007 - behavior: a plain json request writes only the json slot,
  // never empty form/multipart metadata (minimal diffs).
  it("should omit the form and multipart slots if the request is a plain json request", () => {
    const tree: TreeNode[] = [
      request({ name: "Plain", body: bodyOf("json", { json: '{"a":1}' }) }),
    ];

    const parsed = reqFileJson(tree) as {
      body: { active: string; types: Record<string, unknown> };
    };

    expect(parsed.body.active).toBe("json");
    expect("form" in parsed.body.types).toBe(false);
    expect("multipart" in parsed.body.types).toBe(false);
  });

  // AC-009 - behavior: an empty json body (the default) is not written at all.
  it("should omit body if mode is json with no payload", () => {
    const tree: TreeNode[] = [request({ name: "Plain2", body: emptyBody() })];

    const parsed = reqFileJson(tree);

    expect("body" in parsed).toBe(false);
  });

  // AC-009 - behavior: a non-default mode IS written to disk.
  it("should write body if the mode is not json", () => {
    const tree: TreeNode[] = [
      request({
        name: "Form2",
        body: bodyOf("form", { form: [{ key: "a", value: "1" }] }),
      }),
    ];

    const parsed = reqFileJson(tree) as {
      body: { active: string; types: { form: unknown } };
    };

    expect(parsed.body.active).toBe("form");
    expect(parsed.body.types.form).toEqual([{ key: "a", value: "1" }]);
  });
});
