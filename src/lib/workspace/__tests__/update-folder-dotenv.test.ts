import { describe, it, expect } from "vitest";

// Imported even though it does not exist yet: the test must fail on the missing
// feature (the pure helper), not a typo. updateFolderDotenv mirrors
// updateNodeConfig - it replaces a single folder's dotenv and leaves the rest
// of the tree value-equal and structurally intact.
import { updateFolderDotenv } from "@/lib/workspace/update-folder-dotenv";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

const request = (id: string): RequestNode => ({
  kind: "request",
  id,
  name: id,
  method: "GET",
  url: `https://example.test/${id}`,
  body: "",
  config: {},
});

const folder = (
  id: string,
  children: TreeNode[],
  dotenv?: string,
): FolderNode => ({
  kind: "folder",
  id,
  name: id,
  config: {},
  children,
  ...(dotenv !== undefined ? { dotenv } : {}),
});

const findFolder = (nodes: TreeNode[], id: string): FolderNode => {
  for (const node of nodes) {
    if (node.kind === "folder") {
      if (node.id === id) {
        return node;
      }
      try {
        return findFolder(node.children, id);
      } catch {
        // keep searching siblings
      }
    }
  }
  throw new Error(`folder ${id} not found`);
};

describe("updateFolderDotenv replaces the target folder dotenv", () => {
  // behavior: only the target folder's dotenv changes.
  it("should replace only the target folder's dotenv if the id matches", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("c1")], "A=1"),
      folder("f2", [], "B=2"),
    ];

    const result = updateFolderDotenv(tree, "f1", "A=99");

    expect(findFolder(result, "f1").dotenv).toBe("A=99");
    expect(findFolder(result, "f2").dotenv).toBe("B=2");
  });

  // behavior: works for a deeply-nested folder.
  it("should replace a nested folder's dotenv if it is several folders deep", () => {
    const tree: TreeNode[] = [
      folder("root", [folder("mid", [request("deep")], "OLD=1")]),
    ];

    const result = updateFolderDotenv(tree, "mid", "NEW=2");

    expect(findFolder(result, "mid").dotenv).toBe("NEW=2");
  });

  // behavior: a folder's children structure and other fields survive.
  it("should keep the folder's children intact if its dotenv is replaced", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("c1"), folder("nested", [request("c2")])]),
    ];

    const result = updateFolderDotenv(tree, "f1", "X=1");

    const f1 = findFolder(result, "f1");
    expect(f1.children.map((n) => n.id)).toEqual(["c1", "nested"]);
    expect(f1.name).toBe("f1");
  });
});

describe("updateFolderDotenv leaves the rest intact", () => {
  // behavior: an unknown id returns a tree value-equal to the input.
  it("should return a tree equal to the input if the id is unknown", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1")], "A=1")];

    const result = updateFolderDotenv(tree, "missing", "Z=9");

    expect(result).toEqual(tree);
  });

  // side-effect-contract: the input tree is not mutated.
  it("should not mutate the input tree if a dotenv is replaced", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1")], "A=1")];
    const snapshot = structuredClone(tree);

    updateFolderDotenv(tree, "f1", "A=2");

    expect(tree).toEqual(snapshot);
  });
});
