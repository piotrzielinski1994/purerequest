import { describe, it, expect } from "vitest";

import {
  brunoToTree,
  collectDotenv,
  type BrunoFileMap,
} from "@/lib/bruno/bruno-to-tree";
import { parseDotenv } from "@/lib/workspace/environment";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

function asFolder(node: TreeNode | undefined): FolderNode {
  if (!node || node.kind !== "folder") {
    throw new Error("expected a folder node");
  }
  return node;
}

function findByName(nodes: TreeNode[], name: string): TreeNode | undefined {
  return nodes.find((node) => node.name === name);
}

describe("brunoToTree - directories -> folders, .bru -> requests (AC-007)", () => {
  // AC-007, TC-006 - behavior: a single root folder wraps the whole collection.
  it("should wrap the collection in a single root folder", () => {
    const files: BrunoFileMap = {
      "bruno.json": '{ "name": "My API", "version": "1", "type": "collection" }',
      "get-root.bru": "get {\n  url: https://x.test\n}",
    };

    const tree = brunoToTree(files, "fallback");

    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe("folder");
  });

  // AC-007, TC-006 - behavior: a nested dir becomes a child folder containing the
  // request parsed from its .bru file.
  it("should build a nested folder containing the request from a nested .bru", () => {
    const files: BrunoFileMap = {
      "bruno.json": '{ "name": "My API" }',
      "users/folder.bru": "meta {\n  name: Users\n}",
      "users/get-user.bru":
        "meta {\n  name: Get User\n}\nget {\n  url: https://x.test/users/1\n}",
    };

    const root = asFolder(brunoToTree(files, "fallback")[0]);
    const usersFolder = asFolder(findByName(root.children, "Users"));

    expect(usersFolder.kind).toBe("folder");
    const request = usersFolder.children.find(
      (node) => node.kind === "request",
    ) as RequestNode | undefined;
    expect(request).toBeDefined();
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("https://x.test/users/1");
  });

  // AC-007 - behavior: a folder is named from its folder.bru meta.name, not the
  // raw directory name.
  it("should name a folder from its folder.bru meta.name", () => {
    const files: BrunoFileMap = {
      "bruno.json": '{ "name": "My API" }',
      "users/folder.bru": "meta {\n  name: People\n}",
      "users/get-user.bru": "get {\n  url: https://x.test\n}",
    };

    const root = asFolder(brunoToTree(files, "fallback")[0]);

    expect(findByName(root.children, "People")).toBeDefined();
  });

  // AC-007 - behavior: a request .bru (not folder.bru/collection.bru) becomes a
  // request node at the root level.
  it("should turn a top-level request .bru into a request node under the root", () => {
    const files: BrunoFileMap = {
      "bruno.json": '{ "name": "My API" }',
      "create.bru":
        "meta {\n  name: Create\n}\npost {\n  url: https://x.test/create\n}",
    };

    const root = asFolder(brunoToTree(files, "fallback")[0]);
    const request = root.children.find(
      (node) => node.kind === "request",
    ) as RequestNode | undefined;

    expect(request).toBeDefined();
    expect(request?.name).toBe("Create");
    expect(request?.method).toBe("POST");
  });
});

describe("brunoToTree - collection name + environments (AC-008)", () => {
  // AC-008, TC-007 - behavior: bruno.json `name` names the root folder.
  it("should name the root folder from bruno.json name", () => {
    const files: BrunoFileMap = {
      "bruno.json": '{ "name": "Payments API", "version": "1" }',
      "ping.bru": "get {\n  url: https://x.test\n}",
    };

    const root = asFolder(brunoToTree(files, "fallback-name")[0]);

    expect(root.name).toBe("Payments API");
  });

  // AC-008 - behavior: with no bruno.json name, the root falls back to the
  // provided fallback name.
  it("should fall back to the provided name if bruno.json has no name", () => {
    const files: BrunoFileMap = {
      "ping.bru": "get {\n  url: https://x.test\n}",
    };

    const root = asFolder(brunoToTree(files, "my-collection")[0]);

    expect(root.name).toBe("my-collection");
  });

  // AC-008, TC-007 - side-effect-contract: environments/<env>.bru vars map onto
  // the root folder's config.environments.<env>.
  it("should fold environments/<env>.bru vars into the root folder's config.environments", () => {
    const files: BrunoFileMap = {
      "bruno.json": '{ "name": "My API" }',
      "ping.bru": "get {\n  url: https://x.test\n}",
      "environments/local.bru":
        "vars {\n  baseUrl: https://api.example.com\n}",
    };

    const root = asFolder(brunoToTree(files, "fallback")[0]);

    expect(root.config.environments?.local).toEqual({
      baseUrl: "https://api.example.com",
    });
  });

  // AC-008 - behavior: an environments/*.bru file is NOT itself turned into a
  // request node.
  it("should not create a request node for an environments file", () => {
    const files: BrunoFileMap = {
      "bruno.json": '{ "name": "My API" }',
      "environments/local.bru": "vars {\n  baseUrl: https://api.example.com\n}",
    };

    const root = asFolder(brunoToTree(files, "fallback")[0]);

    expect(
      root.children.some((node) => node.kind === "request"),
    ).toBe(false);
  });
});

describe("brunoToTree - OpenCollection YAML dispatch (AC-012)", () => {
  // AC-012 - behavior: a .yml request file is parsed via parseOpenCollection and
  // becomes a request node; the root is named from opencollection.yml info.name.
  it("should build a request node from a .yml file and name the root from opencollection.yml", () => {
    const files: BrunoFileMap = {
      "opencollection.yml": "opencollection: 1.0.0\ninfo:\n  name: as24",
      "asd.yml":
        "info:\n  name: asd\n  type: http\nhttp:\n  method: GET\n  url: https://x.test/asd\n  auth: inherit",
    };

    const root = asFolder(brunoToTree(files, "fallback")[0]);

    expect(root.name).toBe("as24");
    const request = root.children.find(
      (node) => node.kind === "request",
    ) as RequestNode | undefined;
    expect(request).toBeDefined();
    expect(request?.name).toBe("asd");
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("https://x.test/asd");
  });

  // AC-012 - behavior: a nested dir with a folder.yml builds a named child folder
  // containing the request, and request.variables land in the folder config.
  it("should build a nested folder from folder.yml with request.variables in its config", () => {
    const files: BrunoFileMap = {
      "opencollection.yml": "info:\n  name: as24",
      "lts/folder.yml":
        "info:\n  name: lts\n  type: folder\nrequest:\n  variables:\n    - name: LTS_URL\n      value: https://lts.test",
      "lts/makes.yml":
        "info:\n  name: makes\nhttp:\n  method: GET\n  url: https://lts.test/makes\n  auth:\n    type: bearer\n    token: t",
    };

    const root = asFolder(brunoToTree(files, "fallback")[0]);
    const lts = asFolder(findByName(root.children, "lts"));

    expect(lts.config.variables).toEqual({ LTS_URL: "https://lts.test" });
    const request = lts.children.find(
      (node) => node.kind === "request",
    ) as RequestNode | undefined;
    expect(request?.method).toBe("GET");
    expect(request?.config.auth).toEqual({ type: "bearer", token: "t" });
  });

  // AC-012 - behavior: a YAML environment file folds into root config.environments
  // and is not itself a request node.
  it("should fold a YAML environments/<env>.yml into root config.environments", () => {
    const files: BrunoFileMap = {
      "opencollection.yml": "info:\n  name: as24",
      "ping.yml": "info:\n  name: ping\nhttp:\n  method: GET\n  url: https://x.test",
      "environments/local.yml":
        "name: local\ncolor: green\nvariables:\n  - name: BASE_URL\n    value: http://localhost:8080",
    };

    const root = asFolder(brunoToTree(files, "fallback")[0]);

    expect(root.config.environments?.local).toEqual({
      BASE_URL: "http://localhost:8080",
    });
    expect(root.children.some((node) => node.kind === "request")).toBe(true);
    expect(root.children.some((node) => node.name === "local")).toBe(false);
  });

  // AC-012 - behavior: a nested opencollection.yml (Postman-converted sub-collections)
  // is a folder config carrier, not a request node.
  it("should treat a nested opencollection.yml as a folder config carrier, not a request", () => {
    const files: BrunoFileMap = {
      "opencollection.yml": "info:\n  name: Postman repo",
      "ppp-api/opencollection.yml": "info:\n  name: ppp-api",
      "ppp-api/packets.yml":
        "info:\n  name: packets\nhttp:\n  method: GET\n  url: https://x.test/packets",
    };

    const root = asFolder(brunoToTree(files, "fallback")[0]);
    const pppApi = asFolder(findByName(root.children, "ppp-api"));

    expect(
      pppApi.children.filter((node) => node.kind === "request"),
    ).toHaveLength(1);
  });
});

describe("collectDotenv - merge collection .env(s)", () => {
  // a single collection: its root .env is returned.
  it("should return a root .env verbatim-keyed", () => {
    const files: BrunoFileMap = {
      "bruno.json": '{ "name": "C" }',
      ".env": "CULTURE=en-CA\nTOKEN=abc",
    };

    expect(parseDotenv(collectDotenv(files))).toEqual({
      CULTURE: "en-CA",
      TOKEN: "abc",
    });
  });

  // picking a PARENT of several collections: each nested <col>/.env is merged
  // (this is the real case - the user picked `collections/`, not `collections/as24`).
  it("should merge nested per-collection .env files", () => {
    const files: BrunoFileMap = {
      "as24/opencollection.yml": "info:\n  name: as24",
      "as24/.env": "CULTURE=en-CA",
      "mbu/opencollection.yml": "info:\n  name: mbu",
      "mbu/.env": "BASE_URL=http://localhost",
    };

    expect(parseDotenv(collectDotenv(files))).toEqual({
      CULTURE: "en-CA",
      BASE_URL: "http://localhost",
    });
  });

  // no .env anywhere -> empty string.
  it("should return empty when there is no .env", () => {
    expect(collectDotenv({ "bruno.json": "{}" })).toBe("");
  });
});

describe("brunoToTree - empty collection (edge, spec §8)", () => {
  // edge (spec §8) - behavior: an empty file map still returns one root folder
  // (no children) without throwing.
  it("should return a single empty root folder for an empty file map", () => {
    const root = asFolder(brunoToTree({}, "empty")[0]);

    expect(root.kind).toBe("folder");
    expect(root.children).toEqual([]);
  });

  // edge (spec §8) - behavior: a collection with only bruno.json (no requests,
  // no child folders) yields an empty root folder.
  it("should return an empty root folder if only bruno.json is present", () => {
    const files: BrunoFileMap = {
      "bruno.json": '{ "name": "Only Meta" }',
    };

    const root = asFolder(brunoToTree(files, "fallback")[0]);

    expect(root.name).toBe("Only Meta");
    expect(root.children).toEqual([]);
  });
});
