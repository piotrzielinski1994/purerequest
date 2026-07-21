import { describe, expect, it } from "vitest";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import { moveNodes } from "@/lib/workspace/move";

const request = (id: string): RequestNode => ({
  kind: "request",
  id,
  name: id,
  method: "GET",
  url: `https://example.test/${id}`,
  body: emptyBody(),
  params: emptyParams(),
  config: {},
});

const folder = (id: string, children: TreeNode[]): FolderNode => ({
  kind: "folder",
  id,
  name: id,
  config: {},
  children,
});

const ids = (nodes: TreeNode[]): string[] => nodes.map((node) => node.id);

const findFolder = (nodes: TreeNode[], id: string): FolderNode => {
  const found = nodes.find(
    (node): node is FolderNode => node.kind === "folder" && node.id === id,
  );
  if (!found) {
    throw new Error(`folder ${id} not found at this level`);
  }
  return found;
};

describe("moveNodes reparenting a set", () => {
  // AC-005 - behavior: two root nodes both reparent into a folder.
  it("should move every dragged node into the target folder", () => {
    const tree: TreeNode[] = [request("r1"), request("r2"), folder("dst", [])];

    const result = moveNodes(tree, ["r1", "r2"], { parentId: "dst", index: 0 });

    expect(ids(result)).toEqual(["dst"]);
    expect(ids(findFolder(result, "dst").children)).toEqual(["r1", "r2"]);
  });

  // AC-005 - behavior: the moved nodes keep their document order regardless of the
  // dragIds order passed in.
  it("should preserve document order of the moved nodes", () => {
    const tree: TreeNode[] = [
      request("a"),
      request("b"),
      request("c"),
      folder("dst", []),
    ];

    const result = moveNodes(tree, ["c", "a"], { parentId: "dst", index: 0 });

    expect(ids(findFolder(result, "dst").children)).toEqual(["a", "c"]);
  });
});

describe("moveNodes reordering within a parent", () => {
  // AC-005 - behavior: the RAW target index compensates for dragged siblings
  // removed before the insertion point.
  it("should insert at the raw index after compensating for earlier removed siblings", () => {
    const tree: TreeNode[] = [
      request("a"),
      request("b"),
      request("c"),
      request("d"),
    ];

    // Move {a, b} to raw slot 3 (before "d"); after removing a & b the target
    // parent is [c, d], so they land before "d": [c, a, b, d].
    const result = moveNodes(tree, ["a", "b"], { parentId: null, index: 3 });

    expect(ids(result)).toEqual(["c", "a", "b", "d"]);
  });
});

describe("moveNodes guards", () => {
  // AC-007 - behavior: a descendant of a dragged folder rides inside it, not moved twice.
  it("should drop a dragged descendant of another dragged node", () => {
    const tree: TreeNode[] = [
      folder("src", [request("child")]),
      folder("dst", []),
    ];

    const result = moveNodes(tree, ["src", "child"], {
      parentId: "dst",
      index: 0,
    });

    const dst = findFolder(result, "dst");
    // Only "src" moved; "child" is still inside it (not duplicated at dst root).
    expect(ids(dst.children)).toEqual(["src"]);
    expect(ids(findFolder(dst.children, "src").children)).toEqual(["child"]);
  });

  // AC-007 - behavior: dropping the selection into one of its own dragged folders is a cycle.
  it("should return the original tree unchanged if dropped into a dragged folder", () => {
    const tree: TreeNode[] = [request("r1"), folder("f1", [request("c1")])];

    const result = moveNodes(tree, ["r1", "f1"], { parentId: "f1", index: 0 });

    expect(result).toEqual(tree);
  });

  // behavior: an empty set leaves the tree unchanged.
  it("should return the original tree unchanged if no dragged node is known", () => {
    const tree: TreeNode[] = [request("r1")];

    const result = moveNodes(tree, ["nope"], { parentId: null, index: 0 });

    expect(result).toEqual(tree);
  });

  // behavior - requests cannot be parents.
  it("should return the original tree unchanged if the target parent is a request", () => {
    const tree: TreeNode[] = [request("a"), request("b")];

    const result = moveNodes(tree, ["a"], { parentId: "b", index: 0 });

    expect(result).toEqual(tree);
  });
});

describe("moveNodes purity", () => {
  // side-effect-contract - input is not mutated.
  it("should not mutate the input tree", () => {
    const tree: TreeNode[] = [request("r1"), request("r2"), folder("dst", [])];
    const snapshot = structuredClone(tree);

    moveNodes(tree, ["r1", "r2"], { parentId: "dst", index: 0 });

    expect(tree).toEqual(snapshot);
  });
});
