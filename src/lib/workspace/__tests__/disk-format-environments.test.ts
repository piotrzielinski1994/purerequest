import { describe, it, expect } from "vitest";

import { serialize, deserialize } from "@/lib/workspace/disk-format";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

const request = (
  name: string,
  config: RequestNode["config"] = {},
): RequestNode => ({
  kind: "request",
  id: `pending-${name}`,
  name,
  method: "GET",
  url: `https://example.test/${name}`,
  body: emptyBody(),
  params: emptyParams(),
  config,
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

const expectOk = (result: ReturnType<typeof deserialize>) => {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error}`);
  }
  return result;
};

describe("disk-format environments round-trip", () => {
  // AC-001 - behavior: a folder config's environments array survives serialize/deserialize
  it("should round-trip a folder config environments array intact", () => {
    const environments = [
      { name: "local", variables: [{ key: "baseUrl", value: "http://localhost:3000" }] },
      {
        name: "prod",
        variables: [
          { key: "baseUrl", value: "https://api.example.com" },
          { key: "apiKey", value: "k1" },
        ],
      },
    ];
    const tree: TreeNode[] = [
      folder(
        "Api",
        { variables: [{ key: "baseUrl", value: "https://default" }], environments },
        [request("Get")],
      ),
    ];

    const result = expectOk(deserialize(serialize(tree)));
    const loaded = result.tree.find(
      (node): node is FolderNode =>
        node.kind === "folder" && node.name === "Api",
    );

    expect(loaded?.config.environments).toEqual(environments);
  });

  // behavior: a folder's env border color folds into the matching environments
  // entry on disk (one array, no separate environmentColors field) and splits back
  // out into the in-memory environmentColors on load.
  it("should fold an env border color into its disk entry and split it back on load", () => {
    const environments = [
      { name: "prod", variables: [{ key: "baseUrl", value: "https://api" }] },
    ];
    const tree: TreeNode[] = [
      {
        ...folder("Api", { environments }, [request("Get")]),
        environmentColors: { prod: "#dc262680" },
      },
    ];

    const map = serialize(tree);
    const doc = JSON.parse(map["api/folder.json"]) as {
      environments: unknown;
      environmentColors?: unknown;
    };
    // on disk: color rides inside the entry, no separate field.
    expect(doc.environments).toEqual([
      {
        name: "prod",
        color: "#dc262680",
        variables: [{ key: "baseUrl", value: "https://api" }],
      },
    ]);
    expect(doc.environmentColors).toBeUndefined();

    // on load: split back into config.environments + the environmentColors field.
    const loaded = expectOk(deserialize(map)).tree.find(
      (node): node is FolderNode =>
        node.kind === "folder" && node.name === "Api",
    );
    expect(loaded?.config.environments).toEqual(environments);
    expect(loaded?.environmentColors).toEqual({ prod: "#dc262680" });
  });

  // behavior: an env COLORED but not declared in config.environments still persists
  // (as an entry with empty variables) and reloads its color.
  it("should persist a colored-but-undeclared env as an empty entry and restore its color", () => {
    const tree: TreeNode[] = [
      { ...folder("Api", {}, [request("Get")]), environmentColors: { prod: "#16a34a80" } },
    ];

    const loaded = expectOk(deserialize(serialize(tree))).tree.find(
      (node): node is FolderNode =>
        node.kind === "folder" && node.name === "Api",
    );

    expect(loaded?.environmentColors).toEqual({ prod: "#16a34a80" });
  });

  // AC-001 - behavior: a request-level environments array also round-trips
  it("should round-trip a request config environments array intact", () => {
    const environments = [
      { name: "prod", variables: [{ key: "token", value: "{{process.env.JWT}}" }] },
    ];
    const tree: TreeNode[] = [request("Token", { environments })];

    const result = expectOk(deserialize(serialize(tree)));
    const loaded = result.tree.find(
      (node): node is RequestNode =>
        node.kind === "request" && node.name === "Token",
    );

    expect(loaded?.config.environments).toEqual(environments);
  });

  // behavior: a hand-written folder.json with the CURRENT array environments shape
  // deserializes into the Environment[] model.
  it("should parse an environments array from a hand-built folder.json", () => {
    const files = serialize([]);
    files["api/folder.json"] = JSON.stringify({
      name: "Api",
      environments: [
        { name: "local", variables: [{ key: "baseUrl", value: "http://localhost:3000" }] },
        { name: "prod", variables: [{ key: "baseUrl", value: "https://api.example.com" }] },
      ],
    });
    files["api/get.req.json"] = JSON.stringify({
      name: "Get",
      method: "GET",
      url: "{{baseUrl}}/get",
      body: "",
      config: {},
    });

    const result = expectOk(deserialize(files));
    const api = result.tree.find(
      (node): node is FolderNode =>
        node.kind === "folder" && node.name === "Api",
    );

    expect(api?.config.environments).toEqual([
      { name: "local", variables: [{ key: "baseUrl", value: "http://localhost:3000" }] },
      { name: "prod", variables: [{ key: "baseUrl", value: "https://api.example.com" }] },
    ]);
  });

  // behavior: a LEGACY hand-written folder.json (nested config + record-shaped
  // environments + separate environmentColors) still migrates to the array model
  // and the folder's environmentColors field.
  it("should migrate a legacy record environments block + environmentColors field", () => {
    const files = serialize([]);
    files["api/folder.json"] = JSON.stringify({
      name: "Api",
      config: {
        environments: {
          local: { baseUrl: "http://localhost:3000" },
          prod: { baseUrl: "https://api.example.com" },
        },
      },
      environmentColors: { prod: "#dc262680" },
    });

    const api = expectOk(deserialize(files)).tree.find(
      (node): node is FolderNode =>
        node.kind === "folder" && node.name === "Api",
    );

    expect(api?.config.environments).toEqual([
      { name: "local", variables: [{ key: "baseUrl", value: "http://localhost:3000" }] },
      { name: "prod", variables: [{ key: "baseUrl", value: "https://api.example.com" }] },
    ]);
    expect(api?.environmentColors).toEqual({ prod: "#dc262680" });
  });
});
