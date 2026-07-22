import { describe, expect, it } from "vitest";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import {
  allFolderIds,
  flattenSelectable,
  rangeBetween,
  resolveFolderTarget,
} from "@/lib/workspace/tree-select";

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

describe("flattenSelectable", () => {
  // behavior: folders and requests listed in DFS display order.
  it("should list folders and requests in display order", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("r1"), request("r2")]),
      request("r3"),
    ];

    expect(flattenSelectable(tree, new Set(["f1"]))).toEqual([
      "f1",
      "r1",
      "r2",
      "r3",
    ]);
  });

  // behavior: a collapsed folder's children are not visible, so they are skipped.
  it("should skip the children of a collapsed folder", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("r1"), request("r2")]),
      request("r3"),
    ];

    expect(flattenSelectable(tree, new Set())).toEqual(["f1", "r3"]);
  });

  // behavior: nested expanded folders contribute their selectable descendants.
  it("should descend nested expanded folders", () => {
    const tree: TreeNode[] = [
      folder("f1", [folder("f2", [request("r1")]), request("r2")]),
    ];

    expect(flattenSelectable(tree, new Set(["f1", "f2"]))).toEqual([
      "f1",
      "f2",
      "r1",
      "r2",
    ]);
  });
});

describe("allFolderIds", () => {
  // behavior: every folder id at any depth, requests excluded, regardless of
  // expand state (drives expand-all).
  it("should return every folder id at any depth", () => {
    const tree: TreeNode[] = [
      folder("f1", [folder("f2", [request("r1")]), request("r2")]),
      request("r3"),
      folder("f3", []),
    ];

    expect(allFolderIds(tree).sort()).toEqual(["f1", "f2", "f3"]);
  });

  // behavior: a tree with no folders yields no ids.
  it("should return an empty array if there are no folders", () => {
    expect(allFolderIds([request("r1"), request("r2")])).toEqual([]);
  });

  // behavior: an empty tree yields no ids.
  it("should return an empty array for an empty tree", () => {
    expect(allFolderIds([])).toEqual([]);
  });
});

describe("resolveFolderTarget", () => {
  const tree: TreeNode[] = [
    folder("f1", [folder("f2", [request("r-nested")]), request("r-in-f1")]),
    request("r-root"),
  ];

  // TC-003 - behavior: a selected folder resolves to its own id.
  it("should return the folder id if a folder is selected", () => {
    expect(resolveFolderTarget(tree, "f1")).toBe("f1");
  });

  // TC-003 - behavior: a nested folder resolves to itself, not an ancestor.
  it("should return the nested folder's own id if a nested folder is selected", () => {
    expect(resolveFolderTarget(tree, "f2")).toBe("f2");
  });

  // TC-004 - behavior: a selected request resolves to its parent folder id.
  it("should return the parent folder id if a request inside a folder is selected", () => {
    expect(resolveFolderTarget(tree, "r-in-f1")).toBe("f1");
  });

  // TC-004 - behavior: a request nested two folders deep resolves to its
  // immediate parent folder, not the root of the chain.
  it("should return the immediate parent folder id if a deeply nested request is selected", () => {
    expect(resolveFolderTarget(tree, "r-nested")).toBe("f2");
  });

  // TC-005 - behavior: a top-level request (parent is the root) resolves to null.
  it("should return null if a top-level request whose parent is the root is selected", () => {
    expect(resolveFolderTarget(tree, "r-root")).toBeNull();
  });

  // TC-005 - behavior: a null selection resolves to null.
  it("should return null if nothing is selected", () => {
    expect(resolveFolderTarget(tree, null)).toBeNull();
  });

  // TC-005 - behavior: an id that is not in the tree resolves to null.
  it("should return null if the selected id is not in the tree", () => {
    expect(resolveFolderTarget(tree, "does-not-exist")).toBeNull();
  });
});

describe("rangeBetween", () => {
  const ordered = ["a", "b", "c", "d", "e"];

  // behavior: an inclusive forward range between two ids.
  it("should return the inclusive range if the anchor precedes the target", () => {
    expect(rangeBetween(ordered, "b", "d")).toEqual(["b", "c", "d"]);
  });

  // behavior: the range is direction-independent (anchor after target).
  it("should return the inclusive range if the anchor follows the target", () => {
    expect(rangeBetween(ordered, "d", "b")).toEqual(["b", "c", "d"]);
  });

  // behavior: a single id if anchor and target are the same.
  it("should return a single id if the anchor equals the target", () => {
    expect(rangeBetween(ordered, "c", "c")).toEqual(["c"]);
  });

  // behavior: only the target if the anchor is not in the visible order.
  it("should fall back to just the target if the anchor is missing", () => {
    expect(rangeBetween(ordered, "missing", "c")).toEqual(["c"]);
  });

  // behavior: only the target if the target is not in the visible order.
  it("should fall back to just the target if the target is missing", () => {
    expect(rangeBetween(ordered, "a", "missing")).toEqual(["missing"]);
  });
});
