import { describe, expect, it } from "vitest";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import { moveNode } from "@/lib/workspace/move";

const request = (id: string, name = id): RequestNode => ({
  kind: "request",
  id,
  name,
  method: "GET",
  url: `https://example.test/${name}`,
  body: emptyBody(),
  params: emptyParams(),
  config: {},
});

const folder = (id: string, children: TreeNode[], name = id): FolderNode => ({
  kind: "folder",
  id,
  name,
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

describe("moveNode reparenting", () => {
  // AC-005 - behavior
  it("should move a request into a folder at the given index if reparented", () => {
    const tree: TreeNode[] = [
      request("r1"),
      folder("f1", [request("c1"), request("c2")]),
    ];

    const result = moveNode(tree, "r1", { parentId: "f1", index: 1 });

    expect(ids(result)).toEqual(["f1"]);
    const f1 = findFolder(result, "f1");
    expect(ids(f1.children)).toEqual(["c1", "r1", "c2"]);
  });

  // AC-006 - behavior
  it("should move a folder with its whole subtree intact if reparented into another folder", () => {
    const subtree = folder("src", [
      request("inner-req"),
      folder("nested", [request("deep")]),
    ]);
    const tree: TreeNode[] = [subtree, folder("dst", [request("d1")])];

    const result = moveNode(tree, "src", { parentId: "dst", index: 0 });

    expect(ids(result)).toEqual(["dst"]);
    const dst = findFolder(result, "dst");
    expect(ids(dst.children)).toEqual(["src", "d1"]);
    const moved = dst.children[0] as FolderNode;
    expect(moved.kind).toBe("folder");
    expect(ids(moved.children)).toEqual(["inner-req", "nested"]);
    const nested = moved.children[1] as FolderNode;
    expect(ids(nested.children)).toEqual(["deep"]);
  });

  // AC-005 - behavior
  it("should remove the node from its old parent if reparented", () => {
    const tree: TreeNode[] = [
      folder("from", [request("x"), request("y")]),
      folder("to", []),
    ];

    const result = moveNode(tree, "x", { parentId: "to", index: 0 });

    const from = findFolder(result, "from");
    expect(ids(from.children)).toEqual(["y"]);
    const to = findFolder(result, "to");
    expect(ids(to.children)).toEqual(["x"]);
  });
});

describe("moveNode reordering siblings", () => {
  // AC-007 - behavior
  it("should put the second child first if moved to index 0 within the same parent", () => {
    const tree: TreeNode[] = [request("a"), request("b"), request("c")];

    const result = moveNode(tree, "b", { parentId: null, index: 0 });

    expect(ids(result)).toEqual(["b", "a", "c"]);
  });

  // AC-007 - behavior
  it("should evaluate the index after removal of the dragged node if moved within the same parent", () => {
    const tree: TreeNode[] = [request("a"), request("b"), request("c")];

    // After removing "a", siblings are [b, c]; index 1 places "a" between them.
    const result = moveNode(tree, "a", { parentId: null, index: 1 });

    expect(ids(result)).toEqual(["b", "a", "c"]);
  });

  // AC-007 - behavior
  it("should clamp an out-of-range index to the end of the target siblings", () => {
    const tree: TreeNode[] = [request("a"), request("b"), request("c")];

    const result = moveNode(tree, "a", { parentId: null, index: 99 });

    expect(ids(result)).toEqual(["b", "c", "a"]);
  });
});

describe("moveNode illegal moves", () => {
  // AC-008 - behavior
  it("should return the original tree unchanged if a folder is dropped into itself", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1")]), request("r1")];

    const result = moveNode(tree, "f1", { parentId: "f1", index: 0 });

    expect(result).toEqual(tree);
  });

  // AC-008 - behavior
  it("should return the original tree unchanged if a folder is dropped into its own descendant", () => {
    const tree: TreeNode[] = [
      folder("parent", [folder("child", [folder("grandchild", [])])]),
    ];

    const result = moveNode(tree, "parent", {
      parentId: "grandchild",
      index: 0,
    });

    expect(result).toEqual(tree);
  });

  // behavior
  it("should return the original tree unchanged if the dragId is unknown", () => {
    const tree: TreeNode[] = [request("a"), folder("f1", [request("c1")])];

    const result = moveNode(tree, "does-not-exist", {
      parentId: "f1",
      index: 0,
    });

    expect(result).toEqual(tree);
  });

  // behavior - requests cannot be parents
  it("should return the original tree unchanged if the target parentId points at a request", () => {
    const tree: TreeNode[] = [request("a"), request("b")];

    const result = moveNode(tree, "a", { parentId: "b", index: 0 });

    expect(result).toEqual(tree);
  });
});

describe("moveNode purity", () => {
  // side-effect-contract - input is not mutated
  it("should not mutate the input tree if a legal move is performed", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("c1"), request("c2")]),
      request("r1"),
    ];
    const snapshot = structuredClone(tree);

    moveNode(tree, "r1", { parentId: "f1", index: 0 });

    expect(tree).toEqual(snapshot);
  });

  // side-effect-contract - moved subtree objects are not mutated
  it("should not mutate the input tree if a folder subtree is reparented", () => {
    const tree: TreeNode[] = [
      folder("src", [request("inner"), folder("nested", [request("deep")])]),
      folder("dst", []),
    ];
    const snapshot = structuredClone(tree);

    moveNode(tree, "src", { parentId: "dst", index: 0 });

    expect(tree).toEqual(snapshot);
  });
});
