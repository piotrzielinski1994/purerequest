import { describe, it, expect } from "vitest";

import { serialize, deserialize } from "@/lib/workspace/disk-format";
import type { KeyValue, RequestNode, TreeNode } from "@/lib/workspace/model";

// `bodyMode` / `bodyForm` are the new optional RequestNode fields (spec §2).
// Declared here so the test compiles before model.ts is extended (RED phase).
type BodyMode = "json" | "none" | "form" | "multipart";
type BodyModeExtras = { bodyMode?: BodyMode; bodyForm?: KeyValue[] };

const request = (
  overrides: Partial<RequestNode> & BodyModeExtras & { name: string },
): RequestNode =>
  ({
    kind: "request",
    id: `pending-${overrides.name}`,
    method: "POST",
    url: `https://example.test/${overrides.name}`,
    body: "",
    config: {},
    ...overrides,
  }) as RequestNode;

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
  // AC-009, TC-007 - behavior: a form request round-trips bodyMode + bodyForm.
  it("should round-trip bodyMode and bodyForm if the request is a form request", () => {
    const rows: KeyValue[] = [
      { key: "a", value: "1" },
      { key: "b", value: "2", enabled: false },
    ];
    const tree: TreeNode[] = [
      request({ name: "Form Req", bodyMode: "form", bodyForm: rows }),
    ];

    const result = expectOk(deserialize(serialize(tree)));
    const loaded = firstRequest(result.tree) as RequestNode & BodyModeExtras;

    expect(loaded.bodyMode).toBe("form");
    expect(loaded.bodyForm).toEqual(rows);
  });

  // AC-009 - behavior: multipart mode + rows survive the round-trip too.
  it("should round-trip bodyMode multipart and its rows", () => {
    const tree: TreeNode[] = [
      request({
        name: "Multi Req",
        bodyMode: "multipart",
        bodyForm: [{ key: "x", value: "y" }],
      }),
    ];

    const result = expectOk(deserialize(serialize(tree)));
    const loaded = firstRequest(result.tree) as RequestNode & BodyModeExtras;

    expect(loaded.bodyMode).toBe("multipart");
    expect(loaded.bodyForm).toEqual([{ key: "x", value: "y" }]);
  });

  // AC-009 - behavior: a none request persists its mode.
  it("should round-trip bodyMode none", () => {
    const tree: TreeNode[] = [request({ name: "None Req", bodyMode: "none" })];

    const result = expectOk(deserialize(serialize(tree)));
    const loaded = firstRequest(result.tree) as RequestNode & BodyModeExtras;

    expect(loaded.bodyMode).toBe("none");
  });
});

describe("disk-format body modes defaults omitted", () => {
  // AC-009, TC-007 - behavior: a default json request writes neither bodyMode
  // nor bodyForm to its on-disk *.req.json (minimal diffs).
  it("should omit bodyMode and bodyForm if the request is a default json request", () => {
    const tree: TreeNode[] = [request({ name: "Plain", body: '{"a":1}' })];

    const parsed = reqFileJson(tree);

    expect("bodyMode" in parsed).toBe(false);
    expect("bodyForm" in parsed).toBe(false);
  });

  // AC-009 - behavior: an explicit json mode with empty rows is still at the
  // default, so neither field is written.
  it("should omit bodyMode and bodyForm if mode is json with no rows", () => {
    const tree: TreeNode[] = [
      request({ name: "Plain2", bodyMode: "json", bodyForm: [] }),
    ];

    const parsed = reqFileJson(tree);

    expect("bodyMode" in parsed).toBe(false);
    expect("bodyForm" in parsed).toBe(false);
  });

  // AC-009 - behavior: a non-default mode IS written to disk.
  it("should write bodyMode to disk if the mode is not json", () => {
    const tree: TreeNode[] = [
      request({
        name: "Form2",
        bodyMode: "form",
        bodyForm: [{ key: "a", value: "1" }],
      }),
    ];

    const parsed = reqFileJson(tree);

    expect(parsed.bodyMode).toBe("form");
    expect(parsed.bodyForm).toEqual([{ key: "a", value: "1" }]);
  });
});
