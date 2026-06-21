import { describe, it, expect } from "vitest";

import { serialize, deserialize } from "@/lib/workspace/disk-format";
import type { FileMap } from "@/lib/workspace/disk-format";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

const request = (name: string): RequestNode => ({
  kind: "request",
  id: `pending-${name}`,
  name,
  method: "GET",
  url: `https://example.test/${name}`,
  body: "",
  config: {},
});

const folder = (name: string, children: TreeNode[]): FolderNode => ({
  kind: "folder",
  id: `pending-${name}`,
  name,
  config: {},
  children,
});

const stripIds = (nodes: TreeNode[]): unknown =>
  nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        kind: node.kind,
        name: node.name,
        config: node.config,
        children: stripIds(node.children),
      };
    }
    return {
      kind: node.kind,
      name: node.name,
      method: node.method,
      url: node.url,
      body: node.body,
      config: node.config,
    };
  });

const expectOk = (result: ReturnType<typeof deserialize>) => {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error}`);
  }
  return result;
};

const names = (nodes: TreeNode[]): string[] => nodes.map((node) => node.name);

describe("disk-format serialize order field", () => {
  // AC-011 - behavior
  it("should write a numeric order into folder.json matching the sibling index", () => {
    const tree: TreeNode[] = [
      request("First Request"),
      folder("Second Folder", []),
    ];

    const map = serialize(tree);

    const folderEntry = Object.entries(map).find(([path]) =>
      path.endsWith("/folder.json"),
    );
    expect(folderEntry).toBeDefined();
    const parsed = JSON.parse(folderEntry![1]) as { order?: unknown };
    expect(parsed.order).toBe(1);
  });

  // AC-011 - behavior
  it("should write a numeric order into req.json matching the sibling index", () => {
    const tree: TreeNode[] = [
      request("First Request"),
      folder("Second Folder", []),
    ];

    const map = serialize(tree);

    const reqEntry = Object.entries(map).find(([path]) =>
      path.endsWith(".req.json"),
    );
    expect(reqEntry).toBeDefined();
    const parsed = JSON.parse(reqEntry![1]) as { order?: unknown };
    expect(parsed.order).toBe(0);
  });

  // AC-010, AC-011 - behavior: serialize must preserve caller order, not alpha-sort
  it("should write order fields reflecting the caller array order rather than alpha order", () => {
    // Deliberately request-before-folder and reverse-alpha requests.
    const tree: TreeNode[] = [
      request("Zebra"),
      request("Apple"),
      folder("Group", []),
    ];

    const map = serialize(tree);

    const orderOf = (suffix: string): number => {
      const entry = Object.entries(map).find(([path]) =>
        path.endsWith(suffix),
      );
      if (!entry) {
        throw new Error(`no file ending with ${suffix}`);
      }
      return (JSON.parse(entry[1]) as { order: number }).order;
    };

    expect(orderOf("zebra.req.json")).toBe(0);
    expect(orderOf("apple.req.json")).toBe(1);
    expect(orderOf("group/folder.json")).toBe(2);
  });
});

describe("disk-format order round-trip", () => {
  // AC-010, AC-011 - behavior: a non-alphabetical / non-folders-first order survives
  it("should preserve a deliberately non-alphabetical sibling order through serialize then deserialize", () => {
    const tree: TreeNode[] = [
      request("Zebra"),
      folder("Mango", []),
      request("Apple"),
    ];

    const result = expectOk(deserialize(serialize(tree)));

    expect(names(result.tree)).toEqual(["Zebra", "Mango", "Apple"]);
    expect(stripIds(result.tree)).toEqual(stripIds(tree));
  });

  // AC-011 - behavior: nested children order also survives
  it("should preserve nested children order through a round-trip", () => {
    const tree: TreeNode[] = [
      folder("Group", [
        request("Charlie"),
        request("Bravo"),
        request("Alpha"),
      ]),
    ];

    const result = expectOk(deserialize(serialize(tree)));
    const group = result.tree[0] as FolderNode;

    expect(names(group.children)).toEqual(["Charlie", "Bravo", "Alpha"]);
  });
});

describe("disk-format deserialize order field", () => {
  // AC-011 - behavior: deserialize sorts siblings by order ascending
  it("should sort siblings by ascending order if order fields are present", () => {
    const files: FileMap = {
      "requi.workspace.json": JSON.stringify({ schemaVersion: 2, name: "W" }),
      "a.req.json": JSON.stringify({
        name: "A",
        method: "GET",
        url: "https://x/a",
        body: "",
        config: {},
        order: 2,
      }),
      "b.req.json": JSON.stringify({
        name: "B",
        method: "GET",
        url: "https://x/b",
        body: "",
        config: {},
        order: 0,
      }),
      "c.req.json": JSON.stringify({
        name: "C",
        method: "GET",
        url: "https://x/c",
        body: "",
        config: {},
        order: 1,
      }),
    };

    const result = expectOk(deserialize(files));

    expect(names(result.tree)).toEqual(["B", "C", "A"]);
  });

  // AC-011 - behavior: legacy v1 files without order fall back to folders-first-then-name
  it("should fall back to folders-first-then-name if order fields are missing", () => {
    const files: FileMap = {
      "requi.workspace.json": JSON.stringify({ schemaVersion: 1, name: "W" }),
      "zoo/folder.json": JSON.stringify({ name: "Zoo", config: {} }),
      "alpha/folder.json": JSON.stringify({ name: "Alpha", config: {} }),
      "yak.req.json": JSON.stringify({
        name: "Yak",
        method: "GET",
        url: "https://x/yak",
        body: "",
        config: {},
      }),
      "bear.req.json": JSON.stringify({
        name: "Bear",
        method: "GET",
        url: "https://x/bear",
        body: "",
        config: {},
      }),
    };

    const result = expectOk(deserialize(files));

    // Folders first (alpha-sorted), then requests (alpha-sorted).
    expect(names(result.tree)).toEqual(["Alpha", "Zoo", "Bear", "Yak"]);
  });

  // AC-011 - behavior: ordered nodes sort before order-missing nodes
  it("should place order-missing nodes after ordered ones if order is mixed", () => {
    const files: FileMap = {
      "requi.workspace.json": JSON.stringify({ schemaVersion: 2, name: "W" }),
      "ordered.req.json": JSON.stringify({
        name: "Ordered",
        method: "GET",
        url: "https://x/o",
        body: "",
        config: {},
        order: 0,
      }),
      "legacy.req.json": JSON.stringify({
        name: "Legacy",
        method: "GET",
        url: "https://x/l",
        body: "",
        config: {},
      }),
    };

    const result = expectOk(deserialize(files));

    expect(names(result.tree)).toEqual(["Ordered", "Legacy"]);
  });
});

describe("disk-format manifest schemaVersion 3", () => {
  // AC-011 - behavior
  it("should emit a manifest with schemaVersion 3", () => {
    const map = serialize([], "My API");

    const manifestRaw = map["requi.workspace.json"];
    expect(manifestRaw).toBeDefined();
    expect(JSON.parse(manifestRaw)).toMatchObject({
      schemaVersion: 3,
      name: "My API",
    });
  });
});
