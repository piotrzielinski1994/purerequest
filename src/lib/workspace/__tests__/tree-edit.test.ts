import { describe, it, expect } from "vitest";

// Imported even though it does not exist yet: the test must fail on the missing
// feature (module), not on a typo. Once tree-edit.ts ships, these assertions pin
// the pure tree ops (rename / duplicate / collect / count / insert / remove /
// findNode / containsId) for tree-crud (AC-004, AC-005, AC-006, AC-007).
// Mirrors update-request.test.ts / move.test.ts (pure-layer style).
import {
  insertNode,
  removeNode,
  renameNode,
  duplicateRequest,
  collectRequestIds,
  countDescendants,
  containsId,
} from "@/lib/workspace/tree-edit";
import { findNode } from "@/lib/workspace/tree-locate";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import type {
  ConfigScope,
  FolderNode,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";

const request = (
  id: string,
  name = id,
  config: ConfigScope = {},
): RequestNode => ({
  kind: "request",
  id,
  name,
  method: "GET",
  url: `https://example.test/${name}`,
  body: emptyBody(),
  params: emptyParams(),
  config,
});

const folder = (
  id: string,
  children: TreeNode[],
  name = id,
  config: ConfigScope = {},
): FolderNode => ({
  kind: "folder",
  id,
  name,
  config,
  children,
});

const ids = (nodes: TreeNode[]): string[] => nodes.map((node) => node.id);

const find = (nodes: TreeNode[], id: string): TreeNode => {
  const found = findNode(nodes, id);
  if (!found) {
    throw new Error(`node ${id} not found`);
  }
  return found;
};

const findFolder = (nodes: TreeNode[], id: string): FolderNode => {
  const node = find(nodes, id);
  if (node.kind !== "folder") {
    throw new Error(`node ${id} is not a folder`);
  }
  return node;
};

describe("renameNode", () => {
  // AC-004 - behavior: a request node's name is patched by the new name.
  it("should rename a request if the id matches a request", () => {
    const tree: TreeNode[] = [request("r1", "old"), request("r2", "kept")];

    const result = renameNode(tree, "r1", "new-name");

    expect((find(result, "r1") as RequestNode).name).toBe("new-name");
    // sibling untouched.
    expect((find(result, "r2") as RequestNode).name).toBe("kept");
  });

  // AC-004 - behavior: a folder node's name is patched too.
  it("should rename a folder if the id matches a folder", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1")], "Old Folder")];

    const result = renameNode(tree, "f1", "New Folder");

    expect(findFolder(result, "f1").name).toBe("New Folder");
    // its children are untouched.
    expect(ids(findFolder(result, "f1").children)).toEqual(["c1"]);
  });

  // AC-004 - behavior: a deeply nested node is renamed (recurses folders).
  it("should rename a node nested several folders deep", () => {
    const tree: TreeNode[] = [
      folder("root", [folder("mid", [request("deep", "deep")])]),
    ];

    const result = renameNode(tree, "deep", "renamed-deep");

    expect((find(result, "deep") as RequestNode).name).toBe("renamed-deep");
  });

  // AC-004, edge - behavior: a blank/whitespace-only name keeps the old name.
  it("should keep the old name if the new name is blank", () => {
    const tree: TreeNode[] = [request("r1", "keep-me")];

    const result = renameNode(tree, "r1", "");

    expect((find(result, "r1") as RequestNode).name).toBe("keep-me");
  });

  it("should keep the old name if the new name is whitespace only", () => {
    const tree: TreeNode[] = [request("r1", "keep-me")];

    const result = renameNode(tree, "r1", "   ");

    expect((find(result, "r1") as RequestNode).name).toBe("keep-me");
  });

  // AC-004, spec §5 - behavior: an unknown id leaves the tree value-equal.
  it("should return a tree equal to the input if the id is unknown", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1")]), request("r1")];

    const result = renameNode(tree, "does-not-exist", "whatever");

    expect(result).toEqual(tree);
  });

  // side-effect-contract: the input tree is not mutated.
  it("should not mutate the input tree if a node is renamed", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1", "old")])];
    const snapshot = structuredClone(tree);

    renameNode(tree, "c1", "new");

    expect(tree).toEqual(snapshot);
  });
});

describe("duplicateRequest", () => {
  // AC-007, TC-011 - behavior: the copy is inserted right AFTER the original.
  it("should insert a deep copy right after the original at root", () => {
    const tree: TreeNode[] = [request("r1", "alpha"), request("r2", "beta")];

    const result = duplicateRequest(tree, "r1", "new-1");

    // copy sits immediately after r1, before r2.
    expect(ids(result)).toEqual(["r1", "new-1", "r2"]);
  });

  // AC-007 - behavior: the copy is inserted after the original inside a folder.
  it("should insert the copy after the original inside its folder", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("c1", "one"), request("c2", "two")]),
    ];

    const result = duplicateRequest(tree, "c1", "new-1");

    expect(ids(findFolder(result, "f1").children)).toEqual([
      "c1",
      "new-1",
      "c2",
    ]);
  });

  // AC-007 - behavior: the copy carries the fresh id and the "<name> copy" name.
  it("should give the copy the new id and a '<name> copy' name", () => {
    const tree: TreeNode[] = [request("r1", "profile")];

    const result = duplicateRequest(tree, "r1", "new-1");

    const copy = find(result, "new-1") as RequestNode;
    expect(copy.id).toBe("new-1");
    expect(copy.name).toBe("profile copy");
    // the original keeps its name + id.
    expect((find(result, "r1") as RequestNode).name).toBe("profile");
  });

  // AC-007 - behavior: the copy is a deep clone of every other field.
  it("should deep-copy the original's method/url/body/config", () => {
    const original = request("r1", "profile", {
      variables: [{ key: "token", value: "abc" }],
      headers: [{ key: "X", value: "1" }],
    });
    original.method = "POST";
    original.url = "https://api.test/profile";
    original.body = {
      active: "json",
      types: {
        json: '{"a":1}',
        form: [],
        multipart: [],
        graphql: { query: "", variables: "" },
      },
    };
    const tree: TreeNode[] = [original];

    const result = duplicateRequest(tree, "r1", "new-1");

    const copy = find(result, "new-1") as RequestNode;
    expect(copy.method).toBe("POST");
    expect(copy.url).toBe("https://api.test/profile");
    expect(copy.body).toEqual({
      active: "json",
      types: {
        json: '{"a":1}',
        form: [],
        multipart: [],
        graphql: { query: "", variables: "" },
      },
    });
    expect(copy.config).toEqual({
      variables: [{ key: "token", value: "abc" }],
      headers: [{ key: "X", value: "1" }],
    });
  });

  // AC-007 - side-effect-contract: mutating the copy's config never touches the
  // original (proves a deep, not shallow, copy of config).
  it("should deep-copy config so mutating the copy leaves the original intact", () => {
    const tree: TreeNode[] = [
      request("r1", "profile", { variables: [{ key: "token", value: "abc" }] }),
    ];

    const result = duplicateRequest(tree, "r1", "new-1");

    const copy = find(result, "new-1") as RequestNode;
    // mutate the copy's nested config object.
    copy.config.variables!.find((r) => r.key === "token")!.value = "MUTATED";

    const original = find(result, "r1") as RequestNode;
    expect(
      original.config.variables!.find((r) => r.key === "token")?.value,
    ).toBe("abc");
  });

  // AC-007 - behavior: a folder id is a no-op (duplicate request only).
  it("should return a tree equal to the input if the id is a folder", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1")])];

    const result = duplicateRequest(tree, "f1", "new-1");

    expect(result).toEqual(tree);
  });

  // AC-007 - behavior: an unknown id is a no-op.
  it("should return a tree equal to the input if the id is unknown", () => {
    const tree: TreeNode[] = [request("r1")];

    const result = duplicateRequest(tree, "missing", "new-1");

    expect(result).toEqual(tree);
  });

  // side-effect-contract: the input tree is not mutated.
  it("should not mutate the input tree if a request is duplicated", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1", "one")])];
    const snapshot = structuredClone(tree);

    duplicateRequest(tree, "c1", "new-1");

    expect(tree).toEqual(snapshot);
  });
});

describe("collectRequestIds", () => {
  // AC-006 - behavior: every request id in a subtree is collected (for closing
  // tabs on a folder delete).
  it("should return every request id in a folder subtree", () => {
    const node = folder("root", [
      request("a"),
      folder("mid", [request("b"), folder("deep", [request("c")])]),
    ]);

    expect(collectRequestIds(node).sort()).toEqual(["a", "b", "c"]);
  });

  // behavior: a lone request returns just its own id.
  it("should return only its own id if the node is a request", () => {
    expect(collectRequestIds(request("solo"))).toEqual(["solo"]);
  });

  // behavior: an empty folder collects nothing.
  it("should return an empty list if the folder has no requests", () => {
    expect(collectRequestIds(folder("empty", []))).toEqual([]);
  });
});

describe("countDescendants", () => {
  // AC-006 - behavior: the descendant count drives the confirm message.
  it("should count every descendant node (requests + folders) in a subtree", () => {
    const node = folder("root", [
      request("a"),
      folder("mid", [request("b"), request("c")]),
    ]);

    // a + mid + b + c = 4 descendants.
    expect(countDescendants(node)).toBe(4);
  });

  // behavior: a request has no descendants.
  it("should return 0 for a request node", () => {
    expect(countDescendants(request("solo"))).toBe(0);
  });

  // behavior: an empty folder has no descendants.
  it("should return 0 for an empty folder", () => {
    expect(countDescendants(folder("empty", []))).toBe(0);
  });
});

describe("findNode / containsId", () => {
  // behavior: findNode reaches a deeply nested node.
  it("should return a nested node if found", () => {
    const tree: TreeNode[] = [
      folder("root", [folder("mid", [request("deep")])]),
    ];

    expect(findNode(tree, "deep")?.id).toBe("deep");
  });

  // behavior: findNode returns null for a missing id.
  it("should return null if the id is missing", () => {
    expect(findNode([request("r1")], "missing")).toBeNull();
  });

  // behavior: containsId is true for the node itself and its descendants.
  it("should report a node as containing its own id and a descendant id", () => {
    const node = folder("root", [folder("mid", [request("deep")])]);

    expect(containsId(node, "root")).toBe(true);
    expect(containsId(node, "deep")).toBe(true);
    expect(containsId(node, "absent")).toBe(false);
  });
});

describe("insertNode / removeNode parity", () => {
  // behavior: insertNode at root places the node at the given index.
  it("should insert a node at the given root index", () => {
    const tree: TreeNode[] = [request("a"), request("b")];

    const result = insertNode(tree, null, 1, request("x"));

    expect(ids(result)).toEqual(["a", "x", "b"]);
  });

  // behavior: insertNode into a folder appends at the given child index.
  it("should insert a node into a folder at the given child index", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1")])];

    const result = insertNode(tree, "f1", 1, request("x"));

    expect(ids(findFolder(result, "f1").children)).toEqual(["c1", "x"]);
  });

  // behavior: insertNode clamps an out-of-range index to the end.
  it("should clamp an out-of-range index to the end", () => {
    const tree: TreeNode[] = [request("a")];

    const result = insertNode(tree, null, 99, request("x"));

    expect(ids(result)).toEqual(["a", "x"]);
  });

  // behavior: removeNode drops the matching node, recursing folders.
  it("should remove a nested node from its parent", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1"), request("c2")])];

    const result = removeNode(tree, "c1");

    expect(ids(findFolder(result, "f1").children)).toEqual(["c2"]);
  });

  // behavior: insert-then-remove returns a value-equal tree (round-trip parity).
  it("should round-trip insert then remove back to the original", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1")]), request("r1")];

    const inserted = insertNode(tree, "f1", 0, request("x"));
    const removed = removeNode(inserted, "x");

    expect(removed).toEqual(tree);
  });

  // side-effect-contract: insertNode does not mutate the input tree.
  it("should not mutate the input tree if a node is inserted", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1")])];
    const snapshot = structuredClone(tree);

    insertNode(tree, "f1", 0, request("x"));

    expect(tree).toEqual(snapshot);
  });

  // side-effect-contract: removeNode does not mutate the input tree.
  it("should not mutate the input tree if a node is removed", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1"), request("c2")])];
    const snapshot = structuredClone(tree);

    removeNode(tree, "c1");

    expect(tree).toEqual(snapshot);
  });
});
