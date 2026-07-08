import { describe, it, expect } from "vitest";

import {
  locateNode,
  findNode,
  dropTarget,
  rawDropTarget,
  projectDropPosition,
  emptyZoneId,
  parseEmptyZoneId,
  ROOT_ZONE_ID,
} from "@/lib/workspace/tree-locate";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

const request = (id: string): RequestNode => ({
  kind: "request",
  id,
  name: id,
  method: "GET",
  url: `https://x/${id}`,
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

const tree: TreeNode[] = [
  folder("f1", [request("c1"), request("c2")]),
  request("r1"),
];

describe("locateNode", () => {
  // behavior
  it("should return root parent null and the index if the node is at root", () => {
    expect(locateNode(tree, "r1")).toEqual({ parentId: null, index: 1 });
  });

  // behavior
  it("should return the folder id and child index if the node is nested", () => {
    expect(locateNode(tree, "c2")).toEqual({ parentId: "f1", index: 1 });
  });

  // behavior
  it("should return null if the node is not in the tree", () => {
    expect(locateNode(tree, "missing")).toBeNull();
  });
});

describe("findNode", () => {
  // behavior
  it("should find a nested node by id", () => {
    expect(findNode(tree, "c1")?.id).toBe("c1");
  });

  // behavior
  it("should return null for an unknown id", () => {
    expect(findNode(tree, "nope")).toBeNull();
  });
});

describe("dropTarget", () => {
  // behavior: inside a folder appends to its children
  it("should target the end of a folder's children if position is inside", () => {
    expect(dropTarget(tree, "r1", "f1", "inside")).toEqual({
      parentId: "f1",
      index: 2,
    });
  });

  // behavior: inside a request is illegal
  it("should return null if position is inside a request", () => {
    expect(dropTarget(tree, "f1", "r1", "inside")).toBeNull();
  });

  // behavior: before a node (dragged from another parent) targets its index
  it("should target the node's index if position is before from another parent", () => {
    expect(dropTarget(tree, "r1", "c2", "before")).toEqual({
      parentId: "f1",
      index: 1,
    });
  });

  // behavior: after a node (dragged from another parent) targets index + 1
  it("should target index plus one if position is after from another parent", () => {
    expect(dropTarget(tree, "r1", "c1", "after")).toEqual({
      parentId: "f1",
      index: 1,
    });
  });

  // behavior: same-parent down-drag compensates for the post-removal shift
  it("should drop one slot lower if dragging a node down past a later sibling", () => {
    // Drag c1 (index 0) to AFTER c2 (index 1) within f1. Pre-removal "after c2"
    // = index 2, but after removing c1 the siblings are [c2], so the post-
    // removal index must be 1 to land c1 at the end: [c2, c1].
    expect(dropTarget(tree, "c1", "c2", "after")).toEqual({
      parentId: "f1",
      index: 1,
    });
  });

  // behavior: same-parent up-drag keeps the raw index
  it("should keep the raw index if dragging a node up before an earlier sibling", () => {
    // Drag c2 (index 1) to BEFORE c1 (index 0) -> index 0, no shift (dragged
    // node sat after the drop point).
    expect(dropTarget(tree, "c2", "c1", "before")).toEqual({
      parentId: "f1",
      index: 0,
    });
  });

  // behavior
  it("should return null if the over node is unknown", () => {
    expect(dropTarget(tree, "r1", "ghost", "before")).toBeNull();
  });
});

describe("empty-zone id", () => {
  // behavior: round-trips a folder id through the empty-zone id encoding
  it("should round-trip a folder id through emptyZoneId/parseEmptyZoneId", () => {
    const id = emptyZoneId("folder-x");
    expect(id).not.toBe("folder-x");
    expect(parseEmptyZoneId(id)).toBe("folder-x");
  });

  // behavior: a plain node id is not an empty-zone id
  it("should return null if the id is not an empty-zone id", () => {
    expect(parseEmptyZoneId("folder-x")).toBeNull();
  });
});

describe("dropTarget empty-zone", () => {
  const emptyTree: TreeNode[] = [folder("empty", []), request("r1")];

  // behavior: dropping on an empty folder's zone targets inside that folder
  it("should target inside the folder if the over id is its empty-zone id", () => {
    expect(dropTarget(emptyTree, "r1", emptyZoneId("empty"), "inside")).toEqual(
      {
        parentId: "empty",
        index: 0,
      },
    );
  });

  // behavior: an empty-zone id for a non-folder / missing id is rejected
  it("should return null if the empty-zone id does not map to a folder", () => {
    expect(dropTarget(emptyTree, "r1", emptyZoneId("r1"), "inside")).toBeNull();
    expect(
      dropTarget(emptyTree, "r1", emptyZoneId("ghost"), "inside"),
    ).toBeNull();
  });
});

describe("root-zone drop", () => {
  // behavior: dropping on the root zone appends to the end of the workspace root.
  it("should target the end of the root if the over id is the root zone", () => {
    expect(rawDropTarget(tree, ROOT_ZONE_ID, "inside")).toEqual({
      parentId: null,
      index: 2,
    });
  });

  // behavior: root-zone target is independent of the reported position.
  it("should target the root end for the root zone regardless of position", () => {
    expect(dropTarget(tree, "c1", ROOT_ZONE_ID, "before")).toEqual({
      parentId: null,
      index: 2,
    });
  });
});

describe("projectDropPosition", () => {
  const overFolder = (pointerY: number) =>
    projectDropPosition({
      pointerY,
      rectTop: 100,
      rectHeight: 20,
      isOverFolder: true,
    });
  const overRequest = (pointerY: number) =>
    projectDropPosition({
      pointerY,
      rectTop: 100,
      rectHeight: 20,
      isOverFolder: false,
    });

  // behavior: a folder's middle 50% reparents (drop inside) - the wide,
  // reliable target that fixes the "can't drop into a folder" bug.
  it("should drop inside if the pointer is in a folder's middle band", () => {
    expect(overFolder(110)).toBe("inside"); // dead center
    expect(overFolder(106)).toBe("inside"); // ~30% down
    expect(overFolder(114)).toBe("inside"); // ~70% down
  });

  // behavior: top/bottom quarters of a folder reorder around it
  it("should reorder around a folder if the pointer is near its top or bottom edge", () => {
    expect(overFolder(102)).toBe("before"); // top 10%
    expect(overFolder(118)).toBe("after"); // bottom 10%
  });

  // behavior: an empty/collapsed folder still gets the full inside band
  it("should drop inside an empty folder if the pointer is in its middle", () => {
    // No child rows exist, but the folder row's own middle band is the target.
    expect(overFolder(111)).toBe("inside");
  });

  // behavior: a request never accepts inside - just 50/50 before/after
  it("should split a request row before/after at its midpoint", () => {
    expect(overRequest(104)).toBe("before");
    expect(overRequest(116)).toBe("after");
    expect(overRequest(111)).toBe("after");
  });

  // behavior: a zero-height rect degrades gracefully
  it("should fall back to before if the row has no height", () => {
    expect(
      projectDropPosition({
        pointerY: 50,
        rectTop: 50,
        rectHeight: 0,
        isOverFolder: true,
      }),
    ).toBe("before");
  });

  const overExpandedFolder = (pointerY: number) =>
    projectDropPosition({
      pointerY,
      rectTop: 100,
      rectHeight: 20,
      isOverFolder: true,
      isExpandedFolder: true,
    });

  // behavior: an EXPANDED folder (with children) reparents across almost its
  // whole row - "after an open folder" visually is its children area = inside.
  // This is the "can drop into oauth but not auth" fix.
  it("should drop inside an expanded folder across most of its row", () => {
    expect(overExpandedFolder(110)).toBe("inside"); // center
    expect(overExpandedFolder(118)).toBe("inside"); // bottom 10% - was "after"
    expect(overExpandedFolder(108)).toBe("inside"); // ~40% down
  });

  // behavior: only a thin top strip of an expanded folder reorders above it
  it("should reorder above an expanded folder only near its top edge", () => {
    expect(overExpandedFolder(102)).toBe("before"); // top 10%
    expect(overExpandedFolder(116)).not.toBe("after"); // bottom is inside now
  });
});
