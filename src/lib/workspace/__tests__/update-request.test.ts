import { describe, it, expect } from "vitest";

// Imported even though it does not exist yet: the test must fail on the missing
// feature (module), not on a typo. Once update-request.ts ships, these
// assertions pin updateRequest's purity + targeted url/method/body patch
// (AC-001). Mirrors update-config.test.ts.
import { updateRequest } from "@/lib/workspace/update-request";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
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

const jsonBody = (json: string): RequestNode["body"] => ({
  active: "json",
  types: { json, form: [], multipart: [], graphql: { query: "", variables: "" } },
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

describe("updateRequest patches the target request fields", () => {
  // AC-001 - behavior: a request node's url/method/body are patched by the given patch.
  it("should patch only the target request's url/method/body if the id matches a request", () => {
    const tree: TreeNode[] = [request("r1"), request("r2")];

    const result = updateRequest(tree, "r1", {
      url: "https://changed.test/r1",
      method: "POST",
      body: jsonBody('{"a":1}'),
    });

    const r1 = findNode(result, "r1") as RequestNode;
    expect(r1.url).toBe("https://changed.test/r1");
    expect(r1.method).toBe("POST");
    expect(r1.body).toEqual(jsonBody('{"a":1}'));
    // sibling untouched
    const r2 = findNode(result, "r2") as RequestNode;
    expect(r2.url).toBe("https://example.test/r2");
    expect(r2.method).toBe("GET");
    expect(r2.body).toEqual(emptyBody());
  });

  // AC-001 - behavior: a partial patch only touches the supplied fields.
  it("should patch only the supplied fields if the patch is partial", () => {
    const tree: TreeNode[] = [request("r1")];

    const result = updateRequest(tree, "r1", { method: "DELETE" });

    const r1 = findNode(result, "r1") as RequestNode;
    expect(r1.method).toBe("DELETE");
    // url + body keep their original values
    expect(r1.url).toBe("https://example.test/r1");
    expect(r1.body).toEqual(emptyBody());
  });

  // full-request Settings - behavior: name and config are patchable too.
  it("should patch the request name and config if supplied", () => {
    const tree: TreeNode[] = [request("r1", { timeoutMs: 1 })];

    const result = updateRequest(tree, "r1", {
      name: "Renamed",
      config: { variables: [{ key: "token", value: "x" }] },
    });

    const r1 = findNode(result, "r1") as RequestNode;
    expect(r1.name).toBe("Renamed");
    expect(r1.config).toEqual({ variables: [{ key: "token", value: "x" }] });
    // unsupplied fields untouched
    expect(r1.url).toBe("https://example.test/r1");
  });

  // AC-001 - behavior: a deeply-nested request is patched (recurses folders).
  it("should patch a nested request's fields if it is several folders deep", () => {
    const tree: TreeNode[] = [
      folder("root", [folder("mid", [request("deep")])]),
    ];

    const result = updateRequest(tree, "deep", {
      url: "https://deep.test/x",
      body: jsonBody("DEEP-BODY"),
    });

    const deep = findNode(result, "deep") as RequestNode;
    expect(deep.url).toBe("https://deep.test/x");
    expect(deep.body).toEqual(jsonBody("DEEP-BODY"));
  });

  // AC-001 - behavior: the target request's config and name are preserved.
  it("should preserve the target request's config and name if its fields are patched", () => {
    const tree: TreeNode[] = [request("r1", { timeoutMs: 9 })];

    const result = updateRequest(tree, "r1", { url: "https://kept.test" });

    const r1 = findNode(result, "r1") as RequestNode;
    expect(r1.name).toBe("r1");
    expect(r1.config).toEqual({ timeoutMs: 9 });
  });
});

describe("updateRequest no-ops", () => {
  // AC-001, spec §5 - behavior: an unknown id leaves the tree value-equal to the input.
  it("should return a tree equal to the input if the id is unknown", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1")]), request("r1")];

    const result = updateRequest(tree, "does-not-exist", { url: "x" });

    expect(result).toEqual(tree);
  });

  // AC-001, spec §5 - behavior: a folder id is never patched (request-only).
  it("should leave a folder untouched if the id matches a folder", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1")])];

    const result = updateRequest(tree, "f1", {
      url: "should-not-apply",
      method: "POST",
    });

    const f1 = findNode(result, "f1") as FolderNode;
    expect(f1.kind).toBe("folder");
    // a folder has no url/method/body to patch
    expect(f1).toEqual(folder("f1", [request("c1")]));
  });
});

describe("updateRequest leaves the rest of the tree intact", () => {
  // AC-001 - behavior: every node's id survives unchanged.
  it("should keep all node ids unchanged if a request is patched", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("c1"), request("c2")]),
      request("r1"),
    ];

    const result = updateRequest(tree, "c1", { method: "PUT" });

    const collectIds = (nodes: TreeNode[]): string[] =>
      nodes.flatMap((node) =>
        node.kind === "folder"
          ? [node.id, ...collectIds(node.children)]
          : [node.id],
      );
    expect(collectIds(result)).toEqual(["f1", "c1", "c2", "r1"]);
  });
});

describe("updateRequest purity", () => {
  // side-effect-contract: the input tree is not mutated.
  it("should not mutate the input tree if a request is patched", () => {
    const tree: TreeNode[] = [folder("f1", [request("c1")])];
    const snapshot = structuredClone(tree);

    updateRequest(tree, "c1", { url: "https://mutated.test", method: "POST" });

    expect(tree).toEqual(snapshot);
  });

  // side-effect-contract: returns a NEW tree (not the same array reference).
  it("should return a new tree array if a request is patched", () => {
    const tree: TreeNode[] = [request("r1")];

    const result = updateRequest(tree, "r1", { url: "https://new.test" });

    expect(result).not.toBe(tree);
  });
});
