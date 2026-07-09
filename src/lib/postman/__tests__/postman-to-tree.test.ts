import { describe, it, expect } from "vitest";

import {
  postmanToTree,
  type PostmanFileMap,
} from "@/lib/postman/postman-to-tree";
import { collectDotenv } from "@/lib/bruno/bruno-to-tree";
import { parseDotenv } from "@/lib/workspace/environment";
import { authOf } from "@/lib/workspace/model";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

const SCHEMA =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

function asFolder(node: TreeNode | undefined): FolderNode {
  if (!node || node.kind !== "folder") {
    throw new Error("expected a folder node");
  }
  return node;
}

function findByName(nodes: TreeNode[], name: string): TreeNode | undefined {
  return nodes.find((node) => node.name === name);
}

function collectionJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    info: { name: "My API", schema: SCHEMA },
    item: [
      {
        name: "Users",
        item: [
          {
            name: "Get User",
            request: { method: "GET", url: { raw: "https://x.test/users/1" } },
          },
        ],
      },
    ],
    ...overrides,
  });
}

describe("postmanToTree - collection pick + nested tree (AC-008)", () => {
  // AC-008, TC-007 - behavior: a single root folder wraps the whole collection.
  it("should wrap the collection in a single root folder named from info.name", () => {
    const files: PostmanFileMap = {
      "My API.postman_collection.json": collectionJson(),
    };

    const tree = postmanToTree(files, "fallback");

    expect(tree).toHaveLength(1);
    const root = asFolder(tree[0]);
    expect(root.name).toBe("My API");
  });

  // AC-008, TC-007 - behavior: a folder item (nested item array) becomes a named
  // child folder holding the request item.
  it("should build a nested folder containing the request from a nested item", () => {
    const files: PostmanFileMap = {
      "My API.postman_collection.json": collectionJson(),
    };

    const root = asFolder(postmanToTree(files, "fallback")[0]);
    const usersFolder = asFolder(findByName(root.children, "Users"));
    const request = usersFolder.children.find(
      (node): node is RequestNode => node.kind === "request",
    );

    expect(request).toBeDefined();
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("https://x.test/users/1");
  });

  // AC-008 - behavior: collection-level variable/auth land on the root config.
  it("should put collection variable and auth on the root folder config", () => {
    const files: PostmanFileMap = {
      "My API.postman_collection.json": collectionJson({
        variable: [{ key: "baseUrl", value: "https://api.example.com" }],
        auth: { type: "bearer", bearer: [{ key: "token", value: "t" }] },
      }),
    };

    const root = asFolder(postmanToTree(files, "fallback")[0]);

    expect(root.config.variables).toEqual([
      { key: "baseUrl", value: "https://api.example.com" },
    ]);
    expect(root.config.auth).toEqual(authOf({ active: "bearer", token: "t" }));
  });

  // AC-008 - behavior: the root falls back to the provided name if info has none.
  it("should fall back to the provided name if info has no name", () => {
    const files: PostmanFileMap = {
      "col.postman_collection.json": JSON.stringify({
        info: { schema: SCHEMA },
        item: [
          {
            name: "R",
            request: { method: "GET", url: { raw: "https://x.test" } },
          },
        ],
      }),
    };

    const root = asFolder(postmanToTree(files, "picked-dir")[0]);

    expect(root.name).toBe("picked-dir");
  });

  // edge (spec §8) - behavior: when several collection files exist, the first
  // path-sorted one wins.
  it("should pick the first path-sorted collection when several are present", () => {
    const files: PostmanFileMap = {
      "b.postman_collection.json": collectionJson({
        info: { name: "Second", schema: SCHEMA },
      }),
      "a.postman_collection.json": collectionJson({
        info: { name: "First", schema: SCHEMA },
      }),
    };

    const root = asFolder(postmanToTree(files, "fallback")[0]);

    expect(root.name).toBe("First");
  });
});

describe("postmanToTree - environments + dotenv (AC-009)", () => {
  // AC-009, TC-008 - side-effect-contract: a *.postman_environment.json folds
  // into the root folder's config.environments.<name> (values -> rows,
  // enabled:false kept).
  it("should fold a postman_environment.json into the root config.environments", () => {
    const files: PostmanFileMap = {
      "My API.postman_collection.json": collectionJson(),
      "Local.postman_environment.json": JSON.stringify({
        name: "Local",
        values: [
          { key: "baseUrl", value: "https://local.test", enabled: true },
          { key: "secret", value: "s", enabled: false },
        ],
      }),
    };

    const root = asFolder(postmanToTree(files, "fallback")[0]);

    expect(
      root.config.environments?.find((e) => e.name === "Local")?.variables,
    ).toEqual([
      { key: "baseUrl", value: "https://local.test" },
      { key: "secret", value: "s", enabled: false },
    ]);
  });

  // AC-009 - behavior: an environment file is not itself turned into a request
  // or a folder node.
  it("should not create a node for an environment file", () => {
    const files: PostmanFileMap = {
      "My API.postman_collection.json": collectionJson(),
      "Local.postman_environment.json": JSON.stringify({
        name: "Local",
        values: [],
      }),
    };

    const root = asFolder(postmanToTree(files, "fallback")[0]);

    expect(findByName(root.children, "Local")).toBeUndefined();
  });

  // AC-009, TC-008 - side-effect-contract: a .env in the file map is captured by
  // collectDotenv for the workspace merge.
  it("should let collectDotenv capture the collection .env", () => {
    const files: PostmanFileMap = {
      "My API.postman_collection.json": collectionJson(),
      ".env": "CULTURE=en-CA\nTOKEN=abc",
    };

    expect(parseDotenv(collectDotenv(files))).toEqual({
      CULTURE: "en-CA",
      TOKEN: "abc",
    });
  });
});

describe("postmanToTree - no collection / empty (edge, spec §8)", () => {
  // edge (spec §8) - behavior: a file map with no collection file -> [].
  it("should return an empty array if there is no collection file", () => {
    const files: PostmanFileMap = {
      ".env": "CULTURE=en-CA",
      "notes.txt": "hello",
    };

    expect(postmanToTree(files, "fallback")).toEqual([]);
  });

  // edge (spec §8) - behavior: an empty file map -> [].
  it("should return an empty array for an empty file map", () => {
    expect(postmanToTree({}, "fallback")).toEqual([]);
  });

  // edge (spec §8) - behavior: an empty collection (info + empty item) still
  // returns one root folder with no children.
  it("should return a single empty root folder for an empty collection", () => {
    const files: PostmanFileMap = {
      "Empty.postman_collection.json": JSON.stringify({
        info: { name: "Empty API", schema: SCHEMA },
        item: [],
      }),
    };

    const tree = postmanToTree(files, "fallback");
    const root = asFolder(tree[0]);

    expect(tree).toHaveLength(1);
    expect(root.name).toBe("Empty API");
    expect(root.children).toEqual([]);
  });
});
