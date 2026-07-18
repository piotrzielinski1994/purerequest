import { describe, it, expect } from "vitest";

import { serialize, deserialize } from "@/lib/workspace/disk-format";
import type { FileMap } from "@/lib/workspace/disk-format";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

const request = (
  name: string,
  config: RequestNode["config"] = {},
  overrides: Partial<RequestNode> = {},
): RequestNode => ({
  kind: "request",
  id: `pending-${name}`,
  name,
  method: "GET",
  url: `https://example.test/${name}`,
  body: emptyBody(),
  params: emptyParams(),
  config,
  ...overrides,
});

const jsonBody = (json: string): RequestNode["body"] => ({
  active: "json",
  types: { json, form: [], multipart: [], graphql: { query: "", variables: "" } },
});

const folder = (
  name: string,
  config: FolderNode["config"],
  children: TreeNode[],
): FolderNode => ({
  kind: "folder",
  id: `pending-${name}`,
  name,
  config,
  children,
});

const stripIds = (nodes: TreeNode[]): unknown =>
  nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        kind: node.kind,
        name: node.name,
        config: node.config,
        children: stripIds(node.children),
      };
    }
    return {
      kind: node.kind,
      name: node.name,
      method: node.method,
      url: node.url,
      body: node.body,
      params: node.params,
      config: node.config,
    };
  });

const expectOk = (result: ReturnType<typeof deserialize>) => {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error}`);
  }
  return result;
};

describe("disk-format round-trip", () => {
  // AC-007, AC-012, TC-004, TC-008 - behavior
  it("should deserialize a serialized tree into a structurally equivalent tree", () => {
    const tree: TreeNode[] = [
      folder("Users API", { variables: [{ key: "baseUrl", value: "https://prod" }] }, [
        folder("Admin", { headers: [{ key: "X-Admin", value: "1" }] }, [
          request(
            "Get User",
            { auth: authOf({ active: "bearer", token: "secret" }) },
            { params: { path: [], query: [{ key: "id", value: "42" }] } },
          ),
        ]),
        request("List Users", { variables: [{ key: "page", value: "1" }] }),
      ]),
      request("Health", {}),
    ];

    const result = expectOk(deserialize(serialize(tree)));

    expect(stripIds(result.tree)).toEqual(stripIds(tree));
  });

  // body-codec - behavior: a JSON body round-trips through the stored {type:"json"} shape.
  it("should round-trip a JSON request body through the stored form", () => {
    const bodyText = '{\n  "grant_type": "client_credentials"\n}';
    const tree: TreeNode[] = [
      request("Token", {}, { method: "POST", body: jsonBody(bodyText) }),
    ];

    const result = expectOk(deserialize(serialize(tree)));

    expect((result.tree[0] as RequestNode).body.types.json).toBe(bodyText);
  });

  // body-codec - behavior: a JSON body is stored as its natural parsed value (real
  // nested JSON, NOT an escaped string) in the on-disk *.req.json.
  it("should store a JSON body as real nested JSON on disk", () => {
    const tree: TreeNode[] = [
      request("Token", {}, { method: "POST", body: jsonBody('{"a":1}') }),
    ];

    const map = serialize(tree);
    const reqFile = Object.entries(map).find(([path]) =>
      path.endsWith(".req.json"),
    );
    expect(reqFile).toBeDefined();
    const parsed = JSON.parse(reqFile![1]) as {
      body: { active: string; types: { json: unknown } };
    };
    expect(parsed.body.active).toBe("json");
    expect(parsed.body.types.json).toEqual({ a: 1 });
  });

  // body-codec - behavior: a legacy (v2) bare-string body still deserializes.
  it("should deserialize a legacy bare-string body (pre-v3 workspace)", () => {
    const legacy: FileMap = {
      "purerequest.workspace.json": JSON.stringify({ schemaVersion: 2, name: "W" }),
      "token.req.json": JSON.stringify({
        name: "Token",
        method: "POST",
        url: "u",
        body: '{\n  "a": 1\n}',
        config: {},
        order: 0,
      }),
    };

    const result = expectOk(deserialize(legacy));

    expect((result.tree[0] as RequestNode).body.types.json).toBe(
      '{\n  "a": 1\n}',
    );
  });

  // AC-007, TC-004 - behavior
  it("should not persist the response field on a deserialized request", () => {
    const tree: TreeNode[] = [
      request(
        "With Response",
        {},
        {
          response: {
            status: 200,
            timeMs: 12,
            sizeBytes: 34,
            body: "{}",
            headers: [],
          },
        },
      ),
    ];

    const result = expectOk(deserialize(serialize(tree)));
    const loaded = result.tree[0];

    expect(loaded.kind).toBe("request");
    expect((loaded as RequestNode).response).toBeUndefined();
  });

  // AC-012, TC-004 - behavior
  it("should produce identical file map keys if a tree is serialized twice through a reload", () => {
    const tree: TreeNode[] = [
      folder("Group", {}, [request("Child A"), request("Child B")]),
    ];

    const firstMap = serialize(tree);
    const reloaded = expectOk(deserialize(firstMap));
    const secondMap = serialize(reloaded.tree);

    expect(Object.keys(secondMap).sort()).toEqual(Object.keys(firstMap).sort());
  });

  // AC-007, AC-012, TC-004 - behavior
  it("should assign identical stable ids if a workspace is loaded twice", () => {
    const tree: TreeNode[] = [
      folder("Group", {}, [request("Child A"), request("Child B")]),
    ];
    const map = serialize(tree);

    const firstLoad = expectOk(deserialize(map));
    const secondLoad = expectOk(deserialize(map));

    expect(stripIds(firstLoad.tree)).toEqual(stripIds(secondLoad.tree));
    const ids = (nodes: TreeNode[]): string[] =>
      nodes.flatMap((node) =>
        node.kind === "folder" ? [node.id, ...ids(node.children)] : [node.id],
      );
    expect(ids(firstLoad.tree)).toEqual(ids(secondLoad.tree));
  });
});

describe("disk-format serialize", () => {
  // AC-012 - behavior
  it("should emit a purerequest.workspace.json manifest with schemaVersion 6 and the workspace name", () => {
    const map = serialize([], "My API");

    const manifestRaw = map["purerequest.workspace.json"];
    expect(manifestRaw).toBeDefined();
    expect(JSON.parse(manifestRaw)).toMatchObject({
      schemaVersion: 6,
      name: "My API",
    });
  });

  // E-8 - behavior
  it("should produce distinct file paths if two children slug to the same string", () => {
    const tree: TreeNode[] = [
      request("Get User"),
      request("get user"),
      request("GET USER"),
    ];

    const map = serialize(tree);

    const reqPaths = Object.keys(map).filter((path) =>
      path.endsWith(".req.json"),
    );
    expect(reqPaths).toHaveLength(3);
    expect(new Set(reqPaths).size).toBe(3);
  });
});

describe("disk-format folder dotenv (AC-001, TC-003)", () => {
  // AC-001, TC-003 - behavior: a folder with non-empty dotenv emits <dir>/.env
  // with KEY=value lines.
  it("should emit a <dir>/.env file if a folder has a non-empty dotenv", () => {
    const tree: TreeNode[] = [
      folder("Api", {}, [request("Get")]),
    ];
    (tree[0] as FolderNode).dotenv = "A=1\nB=2";

    const map = serialize(tree);

    const envEntry = Object.entries(map).find(([path]) =>
      path.endsWith("/.env"),
    );
    expect(envEntry).toBeDefined();
    expect(envEntry![1]).toBe("A=1\nB=2");
  });

  // AC-001, TC-003 - behavior: the folder .env round-trips back into dotenv.
  it("should deserialize a folder .env back into the folder node dotenv", () => {
    const tree: TreeNode[] = [folder("Api", {}, [request("Get")])];
    (tree[0] as FolderNode).dotenv = "A=1\nB=2";

    const result = expectOk(deserialize(serialize(tree)));

    const apiFolder = result.tree.find(
      (node): node is FolderNode =>
        node.kind === "folder" && node.name === "Api",
    );
    expect(apiFolder?.dotenv).toBe("A=1\nB=2");
  });

  // AC-001, TC-003 - behavior: re-serializing a round-tripped tree is byte-identical.
  it("should re-serialize a folder .env byte-identically through a reload", () => {
    const tree: TreeNode[] = [folder("Api", {}, [request("Get")])];
    (tree[0] as FolderNode).dotenv = "A=1\nB=2";

    const firstMap = serialize(tree);
    const reloaded = expectOk(deserialize(firstMap));
    const secondMap = serialize(reloaded.tree);

    const envKey = Object.keys(firstMap).find((path) => path.endsWith("/.env"));
    expect(envKey).toBeDefined();
    expect(secondMap[envKey!]).toBe(firstMap[envKey!]);
  });

  // AC-001, TC-003 - behavior: an absent/empty dotenv writes no .env file.
  it("should write no .env file if a folder dotenv is empty", () => {
    const empty: TreeNode[] = [folder("Api", {}, [request("Get")])];
    (empty[0] as FolderNode).dotenv = "";
    const absent: TreeNode[] = [folder("Web", {}, [request("Get2")])];

    const emptyMap = serialize(empty);
    const absentMap = serialize(absent);

    expect(
      Object.keys(emptyMap).some((path) => path.endsWith("/.env")),
    ).toBe(false);
    expect(
      Object.keys(absentMap).some((path) => path.endsWith("/.env")),
    ).toBe(false);
  });

  // AC-002 - behavior: a folder .env at any depth deserializes into its node.
  it("should collect a nested folder .env into the deep folder node", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({ schemaVersion: 3, name: "W" }),
      "api/folder.json": JSON.stringify({ name: "Api", config: {}, order: 0 }),
      "api/v2/folder.json": JSON.stringify({
        name: "V2",
        config: {},
        order: 0,
      }),
      "api/v2/.env": "DEEP=yes",
      "api/v2/get.req.json": JSON.stringify({
        name: "Get",
        method: "GET",
        url: "u",
        body: "",
        config: {},
        order: 0,
      }),
    };

    const result = expectOk(deserialize(files));

    const api = result.tree.find(
      (n): n is FolderNode => n.kind === "folder" && n.name === "Api",
    );
    const v2 = api?.children.find(
      (n): n is FolderNode => n.kind === "folder" && n.name === "V2",
    );
    expect(v2?.dotenv).toBe("DEEP=yes");
  });
});

describe("disk-format deserialize", () => {
  // AC-008, TC-005 - behavior
  it("should build a tree from a hand-built workspace file map", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({
        schemaVersion: 1,
        name: "Hand Built",
      }),
      "users/folder.json": JSON.stringify({
        name: "Users",
        config: {
          variables: { baseUrl: "https://api" },
          headers: [{ key: "Accept", value: "application/json" }],
        },
      }),
      "users/get-user.req.json": JSON.stringify({
        name: "Get User",
        method: "GET",
        url: "https://api/users/1",
        body: "",
        config: {},
      }),
    };

    const result = expectOk(deserialize(files));

    expect(result.skipped).toEqual([]);
    const usersFolder = result.tree.find(
      (node): node is FolderNode =>
        node.kind === "folder" && node.name === "Users",
    );
    expect(usersFolder).toBeDefined();
    expect(usersFolder?.config.variables).toEqual([
      { key: "baseUrl", value: "https://api" },
    ]);
    expect(usersFolder?.config.headers).toEqual([
      { key: "Accept", value: "application/json" },
    ]);
    const child = usersFolder?.children[0];
    expect(child?.kind).toBe("request");
    expect(child?.name).toBe("Get User");
    expect((child as RequestNode).url).toBe("https://api/users/1");
  });

  // AC-009, E-6, TC-006 - behavior
  it("should return an error result if the file map has no workspace manifest", () => {
    const files: FileMap = {
      "users/get-user.req.json": JSON.stringify({
        name: "Get User",
        method: "GET",
        url: "https://api",
        body: "",
        config: {},
      }),
    };

    const result = deserialize(files);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/workspace/i);
    }
  });

  // AC-009, E-6 - behavior
  it("should not throw if the file map is missing a manifest", () => {
    expect(() => deserialize({})).not.toThrow();
    expect(deserialize({}).ok).toBe(false);
  });

  // AC-009, E-7, TC-006 - behavior
  it("should skip a malformed request file and still load the rest of the tree", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({
        schemaVersion: 1,
        name: "Partial",
      }),
      "good.req.json": JSON.stringify({
        name: "Good",
        method: "GET",
        url: "https://api/good",
        body: "",
        config: {},
      }),
      "broken.req.json": "{ this is not valid json",
    };

    const result = expectOk(deserialize(files));

    expect(result.skipped).toContain("broken.req.json");
    const names = result.tree
      .filter((node): node is RequestNode => node.kind === "request")
      .map((node) => node.name);
    expect(names).toContain("Good");
  });

  // AC-009, E-7 - behavior
  it("should skip a malformed folder.json and still load sibling nodes", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({
        schemaVersion: 1,
        name: "Partial",
      }),
      "broken/folder.json": "not json at all",
      "ok.req.json": JSON.stringify({
        name: "Ok",
        method: "GET",
        url: "https://api/ok",
        body: "",
        config: {},
      }),
    };

    const result = expectOk(deserialize(files));

    expect(result.skipped).toContain("broken/folder.json");
    const names = result.tree
      .filter((node): node is RequestNode => node.kind === "request")
      .map((node) => node.name);
    expect(names).toContain("Ok");
  });

  // E-9 - behavior
  it("should load an empty tree if the workspace only has a manifest", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({
        schemaVersion: 1,
        name: "Empty",
      }),
    };

    const result = expectOk(deserialize(files));

    expect(result.tree).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});
