import { describe, it, expect } from "vitest";

import { flattenSelectable, rangeBetween } from "@/lib/workspace/tree-select";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

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
