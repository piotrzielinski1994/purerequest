import { describe, it, expect } from "vitest";

// Imported even though it does not exist yet: the test must fail on the missing
// feature (module), not on a typo. Once update-config.ts ships, these assertions
// pin updateNodeConfig's purity + targeted replacement (AC-016).
import { updateNodeConfig } from "@/lib/workspace/update-config";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";
import type {
  ConfigScope,
  FolderNode,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";

const request = (id: string, config: ConfigScope = {}): RequestNode => ({
  kind: "request",
  id,
  name: id,
  method: "GET",
  url: `https://example.test/${id}`,
  body: emptyBody(),
  params: emptyParams(),
  config,
});

const folder = (
  id: string,
  children: TreeNode[],
  config: ConfigScope = {},
): FolderNode => ({
  kind: "folder",
  id,
  name: id,
  config,
  children,
});

const findNode = (nodes: TreeNode[], id: string): TreeNode => {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    if (node.kind === "folder") {
      try {
        return findNode(node.children, id);
      } catch {
        // keep searching siblings
      }
    }
  }
  throw new Error(`node ${id} not found`);
};

describe("updateNodeConfig replaces the target node config", () => {
  // AC-016 - behavior: a request node's config is replaced by the given one.
  it("should replace only the target request's config if the id matches a request", () => {
    const tree: TreeNode[] = [
      request("r1", { variables: [{ key: "a", value: "1" }] }),
      request("r2", { variables: [{ key: "b", value: "2" }] }),
    ];
    const next: ConfigScope = {
      variables: [{ key: "a", value: "99" }],
      timeoutMs: 5000,
    };

    const result = updateNodeConfig(tree, "r1", next);

    expect(findNode(result, "r1").config).toEqual(next);
    // sibling untouched
    expect(findNode(result, "r2").config).toEqual({
      variables: [{ key: "b", value: "2" }],
    });
  });

  // AC-016 - behavior: works on a folder node too (one editor handles both).
  it("should replace only the target folder's config if the id matches a folder", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("c1")], { variables: [{ key: "x", value: "old" }] }),
      folder("f2", [], { variables: [{ key: "y", value: "keep" }] }),
    ];
    const next: ConfigScope = {
      environments: [
        { name: "prod", variables: [{ key: "baseUrl", value: "https://api" }] },
      ],
    };

    const result = updateNodeConfig(tree, "f1", next);

    expect(findNode(result, "f1").config).toEqual(next);
    expect(findNode(result, "f2").config).toEqual({
      variables: [{ key: "y", value: "keep" }],
    });
  });

  // AC-016 - behavior: a deeply-nested node's config is replaced.
  it("should replace a nested node's config if it is several folders deep", () => {
    const tree: TreeNode[] = [
      folder("root", [
        folder("mid", [request("deep", { variables: [{ key: "d", value: "old" }] })], {
          variables: [{ key: "m", value: "1" }],
        }),
      ]),
    ];
    const next: ConfigScope = {
      auth: authOf({ active: "bearer", token: "{{tok}}" }),
    };

    const result = updateNodeConfig(tree, "deep", next);

    expect(findNode(result, "deep").config).toEqual(next);
  });
});

describe("updateNodeConfig leaves the rest of the tree intact", () => {
  // AC-016 - behavior: every node's id survives unchanged.
  it("should keep all node ids unchanged if a config is updated", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("c1"), request("c2")]),
      request("r1"),
    ];

    const result = updateNodeConfig(tree, "c1", { timeoutMs: 1 });

    const collectIds = (nodes: TreeNode[]): string[] =>
      nodes.flatMap((node) =>
        node.kind === "folder"
          ? [node.id, ...collectIds(node.children)]
          : [node.id],
      );
    expect(collectIds(result)).toEqual(["f1", "c1", "c2", "r1"]);
  });

  // AC-016 - behavior: a folder's children structure is preserved.
  it("should keep a folder's children structure intact if a nested config is updated", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("c1"), folder("nested", [request("c2")])]),
    ];

    const result = updateNodeConfig(tree, "c2", {
      variables: [{ key: "z", value: "z" }],
    });

    const f1 = findNode(result, "f1") as FolderNode;
    expect(f1.children.map((node) => node.id)).toEqual(["c1", "nested"]);
    const nested = f1.children[1] as FolderNode;
    expect(nested.children.map((node) => node.id)).toEqual(["c2"]);
  });

  // AC-016 - behavior: non-config fields of the target node are preserved.
  it("should preserve the target node's non-config fields if its config is replaced", () => {
    const tree: TreeNode[] = [
      request("r1", { variables: [{ key: "a", value: "1" }] }),
    ];

    const result = updateNodeConfig(tree, "r1", { timeoutMs: 9 });

    const r1 = findNode(result, "r1") as RequestNode;
    expect(r1.kind).toBe("request");
    expect(r1.name).toBe("r1");
    expect(r1.method).toBe("GET");
    expect(r1.url).toBe("https://example.test/r1");
  });
});

describe("updateNodeConfig unknown id", () => {
  // AC-016 - behavior: an unknown id leaves the tree value-equal to the input.
  it("should return a tree equal to the input if the id is unknown", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1")]), request("r1")];

    const result = updateNodeConfig(tree, "does-not-exist", { timeoutMs: 1 });

    expect(result).toEqual(tree);
  });
});

describe("updateNodeConfig purity", () => {
  // side-effect-contract: the input tree is not mutated.
  it("should not mutate the input tree if a config is replaced", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("c1", { variables: [{ key: "a", value: "1" }] })]),
    ];
    const snapshot = structuredClone(tree);

    updateNodeConfig(tree, "c1", { variables: [{ key: "a", value: "2" }] });

    expect(tree).toEqual(snapshot);
  });

  // side-effect-contract: returns a NEW tree (not the same array reference).
  it("should return a new tree array if a config is replaced", () => {
    const tree: TreeNode[] = [
      request("r1", { variables: [{ key: "a", value: "1" }] }),
    ];

    const result = updateNodeConfig(tree, "r1", {
      variables: [{ key: "a", value: "2" }],
    });

    expect(result).not.toBe(tree);
  });
});
