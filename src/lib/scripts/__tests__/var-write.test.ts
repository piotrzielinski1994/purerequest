import { describe, expect, it } from "vitest";

// Imported even though these modules don't exist yet: the suite must fail on the
// missing feature (module), not on a typo. Once var-write.ts ships these pin
// findVarWriteTarget's nearest-defining-scope walk + setNodeVar's immutable write
// (TC-002 / AC-002).
import {
  findVarWriteTarget,
  processEnvRefKey,
  resolveVarWriteTarget,
  setNodeVar,
} from "@/lib/scripts/var-write";
import type {
  ConfigScope,
  FolderNode,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

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

describe("findVarWriteTarget", () => {
  // TC-002 / AC-002 - behavior: a var defined on a parent folder returns that
  // folder's id (write where it logically lives).
  it("should return the parent folder id if the var is defined on the folder only", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("r1")], {
        variables: [{ key: "token", value: "old" }],
      }),
    ];

    expect(findVarWriteTarget(tree, "r1", "token")).toBe("f1");
  });

  // TC-002 / AC-002 - behavior: a var defined nowhere falls back to the request's
  // own id (create it on the request).
  it("should return the request id if the var is defined nowhere", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("r1")], {
        variables: [{ key: "other", value: "x" }],
      }),
    ];

    expect(findVarWriteTarget(tree, "r1", "token")).toBe("r1");
  });

  // TC-002 / AC-002 - behavior: defined on both folder and request -> nearest
  // (the request) wins.
  it("should return the request id if the var is defined on both the folder and the request", () => {
    const tree: TreeNode[] = [
      folder(
        "f1",
        [request("r1", { variables: [{ key: "token", value: "req" }] })],
        { variables: [{ key: "token", value: "folder" }] },
      ),
    ];

    expect(findVarWriteTarget(tree, "r1", "token")).toBe("r1");
  });

  // TC-002 / AC-002 - behavior: nearest-ancestor wins across two ancestor folders.
  it("should return the nearer ancestor folder id if two ancestors both define the var", () => {
    const tree: TreeNode[] = [
      folder(
        "outer",
        [
          folder("inner", [request("r1")], {
            variables: [{ key: "token", value: "inner" }],
          }),
        ],
        { variables: [{ key: "token", value: "outer" }] },
      ),
    ];

    expect(findVarWriteTarget(tree, "r1", "token")).toBe("inner");
  });
});

describe("processEnvRefKey", () => {
  // AC-001 - behavior: a pure single {{process.env.KEY}} token yields KEY.
  it("should return the key if the value is a pure process.env reference", () => {
    expect(processEnvRefKey("{{process.env.BEARER_TOKEN}}")).toBe(
      "BEARER_TOKEN",
    );
  });

  // AC-001 - behavior: surrounding whitespace (outer and inside the braces) is
  // tolerated and stripped.
  it("should tolerate surrounding and inner whitespace", () => {
    expect(processEnvRefKey("  {{  process.env.TOKEN  }}  ")).toBe("TOKEN");
  });

  // AC-004 - behavior: an embedded reference (literal text around the token) is
  // NOT pure -> null.
  it("should return null if the reference is embedded in other text", () => {
    expect(processEnvRefKey("Bearer {{process.env.TOKEN}}")).toBeNull();
  });

  // AC-004 - behavior: two tokens is not a single pure reference -> null.
  it("should return null if the value holds more than one token", () => {
    expect(processEnvRefKey("{{process.env.A}}{{process.env.B}}")).toBeNull();
  });

  // AC-004 - behavior: a non-process.env token (a plain var pointer) -> null.
  it("should return null if the token is a plain variable, not process.env", () => {
    expect(processEnvRefKey("{{otherVar}}")).toBeNull();
  });

  // AC-004 - behavior: a plain literal is not a reference -> null.
  it("should return null if the value is a plain literal", () => {
    expect(processEnvRefKey("old")).toBeNull();
  });

  // edge: an empty key after the prefix is not a valid reference -> null.
  it("should return null if the process.env key is empty", () => {
    expect(processEnvRefKey("{{process.env.}}")).toBeNull();
  });
});

describe("resolveVarWriteTarget", () => {
  // AC-001 - behavior: the nearest defining row is a pure process.env ref -> the
  // write is routed to the .env key, not the config row.
  it("should route to the dotenv key if the nearest defining row is a pure process.env ref", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("r1")], {
        variables: [
          { key: "BEARER_TOKEN", value: "{{process.env.BEARER_TOKEN}}" },
        ],
      }),
    ];

    expect(resolveVarWriteTarget(tree, "r1", "BEARER_TOKEN")).toEqual({
      kind: "dotenv",
      key: "BEARER_TOKEN",
    });
  });

  // AC-004 - behavior: a plain-literal row keeps the config target (the defining
  // scope's node id).
  it("should route to the config node if the nearest defining row is a literal", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("r1")], {
        variables: [{ key: "token", value: "old" }],
      }),
    ];

    expect(resolveVarWriteTarget(tree, "r1", "token")).toEqual({
      kind: "config",
      nodeId: "f1",
    });
  });

  // AC-004 - behavior: an embedded ref is not pure -> config target.
  it("should route to the config node if the defining row embeds the ref in other text", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("r1")], {
        variables: [{ key: "auth", value: "Bearer {{process.env.TOKEN}}" }],
      }),
    ];

    expect(resolveVarWriteTarget(tree, "r1", "auth")).toEqual({
      kind: "config",
      nodeId: "f1",
    });
  });

  // AC-004 - behavior: a var defined nowhere falls back to the request's own
  // config node (create it there), same as findVarWriteTarget.
  it("should route to the request config node if the var is defined nowhere", () => {
    const tree: TreeNode[] = [folder("f1", [request("r1")], {})];

    expect(resolveVarWriteTarget(tree, "r1", "token")).toEqual({
      kind: "config",
      nodeId: "r1",
    });
  });

  // AC-001 - behavior: the pure ref is matched at the NEAREST defining scope; a
  // nearer literal row shadows a farther pure-ref row -> config, not dotenv.
  it("should use the nearest defining row if a nearer literal shadows a farther pure ref", () => {
    const tree: TreeNode[] = [
      folder(
        "outer",
        [
          folder("inner", [request("r1")], {
            variables: [{ key: "token", value: "literal" }],
          }),
        ],
        { variables: [{ key: "token", value: "{{process.env.token}}" }] },
      ),
    ];

    expect(resolveVarWriteTarget(tree, "r1", "token")).toEqual({
      kind: "config",
      nodeId: "inner",
    });
  });
});

describe("setNodeVar", () => {
  // TC-002 / AC-002 - behavior: writes config.variables[name] on the target node.
  it("should set config.variables[name] on the target node", () => {
    const tree: TreeNode[] = [
      request("r1", { variables: [{ key: "a", value: "1" }] }),
    ];

    const result = setNodeVar(tree, "r1", "token", "abc");

    expect((findNode(result, "r1") as RequestNode).config.variables).toEqual([
      { key: "a", value: "1" },
      { key: "token", value: "abc" },
    ]);
  });

  // TC-002 / AC-002 - behavior: overwrites an existing value on the target node.
  it("should overwrite an existing config.variables value if the name is already defined", () => {
    const tree: TreeNode[] = [
      folder("f1", [request("r1")], {
        variables: [{ key: "token", value: "old" }],
      }),
    ];

    const result = setNodeVar(tree, "f1", "token", "new");

    expect((findNode(result, "f1") as FolderNode).config.variables).toEqual([
      { key: "token", value: "new" },
    ]);
  });

  // side-effect-contract: the input tree is not mutated.
  it("should not mutate the input tree if a var is written", () => {
    const tree: TreeNode[] = [
      request("r1", { variables: [{ key: "a", value: "1" }] }),
    ];
    const snapshot = structuredClone(tree);

    setNodeVar(tree, "r1", "token", "abc");

    expect(tree).toEqual(snapshot);
  });

  // side-effect-contract: returns a NEW tree array reference.
  it("should return a new tree array if a var is written", () => {
    const tree: TreeNode[] = [request("r1")];

    const result = setNodeVar(tree, "r1", "token", "abc");

    expect(result).not.toBe(tree);
  });
});
