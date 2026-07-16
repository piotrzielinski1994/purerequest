import { describe, it, expect } from "vitest";

import { brunoToTree } from "@/lib/bruno/bruno-to-tree";
import { parseBru } from "@/lib/bruno/parse-bru";
import { treeToBrunoFiles, type BrunoExportRoot } from "@/lib/bruno/tree-to-bruno";
import {
  authOf,
  emptyAuth,
  emptyBody,
  emptyParams,
} from "@/lib/workspace/model";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

// ---- fixture builders (realistic nodes via model helpers + overrides) --------

function req(overrides: Partial<RequestNode>): RequestNode {
  return {
    kind: "request",
    id: "x1",
    name: "Req",
    method: "GET",
    url: "https://x.test",
    body: emptyBody(),
    params: emptyParams(),
    config: {},
    ...overrides,
  };
}

function folder(overrides: Partial<FolderNode>): FolderNode {
  return {
    kind: "folder",
    id: "x1",
    name: "Folder",
    config: {},
    children: [],
    ...overrides,
  };
}

function asFolder(node: TreeNode | undefined): FolderNode {
  if (!node || node.kind !== "folder") {
    throw new Error("expected a folder node");
  }
  return node;
}

// The only .bru files that are requests (not collection/folder config).
function requestBruKeys(files: Record<string, string>): string[] {
  return Object.keys(files).filter(
    (path) =>
      path.endsWith(".bru") &&
      !path.endsWith("folder.bru") &&
      !path.startsWith("environments/") &&
      !path.includes("/environments/"),
  );
}

describe("treeToBrunoFiles - bruno.json + a single request (AC-001, AC-002)", () => {
  // TC-001 - behavior: a collection root with one GET request emits a
  // bruno.json (version/name/type collection) and a slugged request .bru whose
  // text carries the get block, the url and a headers block.
  it("should emit bruno.json and a request .bru with the get block, url and headers if the root has one GET request", () => {
    const root: BrunoExportRoot = {
      name: "My API",
      config: {},
      children: [
        req({
          name: "Get Users",
          method: "GET",
          url: "https://api.example.com/users",
          config: {
            headers: [{ key: "Accept", value: "application/json", enabled: true }],
          },
        }),
      ],
    };

    const files = treeToBrunoFiles(root);

    expect(files["bruno.json"]).toBeDefined();
    expect(JSON.parse(files["bruno.json"])).toEqual({
      version: "1",
      name: "My API",
      type: "collection",
    });

    const bru = files["get-users.bru"];
    expect(bru).toBeDefined();
    expect(bru).toContain("get {");
    expect(bru).toContain("https://api.example.com/users");
    expect(bru).toContain("headers {");

    const parsed = parseBru(bru);
    expect(parsed.method).toBe("GET");
    expect(parsed.url).toBe("https://api.example.com/users");
    expect(parsed.headers).toEqual([
      { key: "Accept", value: "application/json", enabled: true },
    ]);
  });
});

describe("treeToBrunoFiles - QUERY method block (AC-012)", () => {
  // TC-011, AC-012 - behavior: a QUERY request emits a lowercased `query {` method
  // block (the method string is interpolated into the block name), and re-parsing
  // it yields method QUERY.
  it("should emit a query { block for a QUERY request and round-trip its method", () => {
    const root: BrunoExportRoot = {
      name: "C",
      config: {},
      children: [
        req({ name: "Search", method: "QUERY", url: "https://example.org" }),
      ],
    };

    const bru = treeToBrunoFiles(root)["search.bru"];

    expect(bru).toContain("query {");
    expect(parseBru(bru).method).toBe("QUERY");
  });
});

describe("treeToBrunoFiles - disabled row prefix (AC-003)", () => {
  // TC-002 - behavior: a disabled header row emits with a leading `~` on its
  // key; an enabled row emits plain (no `~`).
  it("should prefix a disabled header row with `~` and leave an enabled row plain", () => {
    const root: BrunoExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Ping",
          config: {
            headers: [
              { key: "Accept", value: "application/json", enabled: true },
              { key: "X-Debug", value: "1", enabled: false },
            ],
          },
        }),
      ],
    };

    const bru = treeToBrunoFiles(root)["ping.bru"];

    expect(bru).toContain("~X-Debug: 1");
    expect(bru).toContain("Accept: application/json");
    expect(bru).not.toContain("~Accept");
  });
});

describe("treeToBrunoFiles - body types + selectors (AC-004)", () => {
  // TC-003 - behavior: json / form / multipart / graphql bodies each emit the
  // matching `body:` selector in the method block and the matching body block;
  // a graphql body with non-empty variables also emits body:graphql:vars.
  it("should emit the correct body selector and body block for each body type (and graphql vars)", () => {
    const root: BrunoExportRoot = {
      name: "Bodies",
      config: {},
      children: [
        req({
          name: "Json Req",
          method: "POST",
          body: { ...emptyBody(), active: "json", types: { ...emptyBody().types, json: '{"id":1}' } },
        }),
        req({
          name: "Form Req",
          method: "POST",
          body: {
            ...emptyBody(),
            active: "form",
            types: {
              ...emptyBody().types,
              form: [{ key: "a", value: "b", enabled: true }],
            },
          },
        }),
        req({
          name: "Multipart Req",
          method: "POST",
          body: {
            ...emptyBody(),
            active: "multipart",
            types: {
              ...emptyBody().types,
              multipart: [{ key: "file", value: "x", enabled: true }],
            },
          },
        }),
        req({
          name: "Graphql Req",
          method: "POST",
          body: {
            ...emptyBody(),
            active: "graphql",
            types: {
              ...emptyBody().types,
              graphql: { query: "query { me { id } }", variables: '{ "x": 1 }' },
            },
          },
        }),
      ],
    };

    const files = treeToBrunoFiles(root);

    const json = files["json-req.bru"];
    expect(json).toContain("body: json");
    expect(json).toContain("body:json {");

    const form = files["form-req.bru"];
    expect(form).toContain("body: form-urlencoded");
    expect(form).toContain("body:form-urlencoded {");
    expect(parseBru(form).bodyMode).toBe("form");

    const multipart = files["multipart-req.bru"];
    expect(multipart).toContain("body: multipart-form");
    expect(multipart).toContain("body:multipart-form {");
    expect(parseBru(multipart).bodyMode).toBe("multipart");

    const graphql = files["graphql-req.bru"];
    expect(graphql).toContain("body: graphql");
    expect(graphql).toContain("body:graphql {");
    expect(graphql).toContain("body:graphql:vars {");
    expect(parseBru(graphql).bodyMode).toBe("graphql");
    expect(parseBru(graphql).body).toContain("query { me { id } }");
    expect(parseBru(graphql).graphqlVariables).toContain('"x": 1');
  });
});

describe("treeToBrunoFiles - none body / inherit auth omit blocks (AC-004, AC-005)", () => {
  // TC-004 - behavior: a request with body.active "none" and auth.active
  // "inherit" emits no body block and no auth:bearer/auth:basic block.
  it("should emit no body block and no auth block if body is none and auth is inherit", () => {
    const root: BrunoExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Bare",
          method: "GET",
          body: { ...emptyBody(), active: "none" },
          config: { auth: emptyAuth() },
        }),
      ],
    };

    const bru = treeToBrunoFiles(root)["bare.bru"];

    expect(bru).not.toContain("body:json");
    expect(bru).not.toContain("body:form-urlencoded");
    expect(bru).not.toContain("body:multipart-form");
    expect(bru).not.toContain("body:graphql");
    expect(bru).not.toContain("auth:bearer");
    expect(bru).not.toContain("auth:basic");
  });
});

describe("treeToBrunoFiles - bearer auth block (AC-005)", () => {
  // TC-005 - behavior: a bearer auth with token "{{tok}}" emits the method-block
  // selector `auth: bearer`, an auth:bearer block with `token: {{tok}}`, and the
  // {{tok}} token survives verbatim (structure-preserving, not resolved).
  it("should emit an auth: bearer selector and auth:bearer block with the {{tok}} token verbatim", () => {
    const root: BrunoExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Secured",
          method: "GET",
          config: { auth: authOf({ active: "bearer", token: "{{tok}}" }) },
        }),
      ],
    };

    const bru = treeToBrunoFiles(root)["secured.bru"];

    expect(bru).toContain("auth: bearer");
    expect(bru).toContain("auth:bearer {");
    expect(bru).toContain("token: {{tok}}");
    expect(parseBru(bru).auth).toEqual(
      authOf({ active: "bearer", token: "{{tok}}" }),
    );
  });
});

describe("treeToBrunoFiles - nested folder + folder.bru (AC-006)", () => {
  // TC-006 - behavior: a nested folder with its own header emits a
  // <slug>/folder.bru carrying that header, and its request emits at the same
  // folder path.
  it("should emit a/folder.bru with the folder header and a/<slug>.bru for its request", () => {
    const root: BrunoExportRoot = {
      name: "C",
      config: {},
      children: [
        folder({
          name: "A",
          config: {
            headers: [{ key: "X-Trace", value: "1", enabled: true }],
          },
          children: [
            req({ name: "Ping", method: "GET", url: "https://x.test/ping" }),
          ],
        }),
      ],
    };

    const files = treeToBrunoFiles(root);

    expect(files["a/folder.bru"]).toBeDefined();
    expect(files["a/folder.bru"]).toContain("X-Trace: 1");
    expect(parseBru(files["a/folder.bru"]).headers).toEqual([
      { key: "X-Trace", value: "1", enabled: true },
    ]);

    expect(files["a/ping.bru"]).toBeDefined();
    expect(parseBru(files["a/ping.bru"]).method).toBe("GET");
  });
});

describe("treeToBrunoFiles - environments + dotenv (AC-007)", () => {
  // TC-007 - behavior: a collection-root environment emits environments/<slug>.bru
  // with a vars block of its rows, and the root folder's dotenv emits a .env file.
  it("should emit environments/dev.bru with a vars block and a .env from the root dotenv", () => {
    const root: BrunoExportRoot = {
      name: "C",
      config: {
        environments: [{ name: "dev", variables: [{ key: "K", value: "1" }] }],
      },
      dotenv: "K=V",
      children: [],
    };

    const files = treeToBrunoFiles(root);

    expect(files["environments/dev.bru"]).toBeDefined();
    expect(files["environments/dev.bru"]).toContain("vars {");
    expect(files["environments/dev.bru"]).toContain("K: 1");
    expect(parseBru(files["environments/dev.bru"]).variables).toEqual({ K: "1" });

    expect(files[".env"]).toBe("K=V");
  });
});

describe("treeToBrunoFiles - sibling slug collision (AC-008)", () => {
  // TC-008 - behavior: two siblings that slugify to the same base are
  // disambiguated with a numeric suffix, so neither request file overwrites the
  // other.
  it("should emit get.bru and get-2.bru for two sibling requests both named Get", () => {
    const root: BrunoExportRoot = {
      name: "C",
      config: {},
      children: [
        req({ name: "Get", method: "GET", url: "https://x.test/1" }),
        req({ name: "Get", method: "GET", url: "https://x.test/2" }),
      ],
    };

    const files = treeToBrunoFiles(root);

    expect(files["get.bru"]).toBeDefined();
    expect(files["get-2.bru"]).toBeDefined();
    expect(requestBruKeys(files)).toHaveLength(2);
  });
});

describe("treeToBrunoFiles - root collection config + auth none (AC-005, AC-006)", () => {
  // AC-006 - behavior: root-level config (headers/auth/scripts) emits a
  // collection.bru, and it round-trips onto the rebuilt root folder's config.
  it("should emit collection.bru for root config and round-trip its header + bearer auth", () => {
    const root: BrunoExportRoot = {
      name: "Root Cfg",
      config: {
        headers: [{ key: "X-Root", value: "1", enabled: true }],
        auth: authOf({ active: "bearer", token: "{{t}}" }),
        scripts: { pre: "root();" },
      },
      children: [req({ name: "Ping", method: "GET" })],
    };

    const files = treeToBrunoFiles(root);
    expect(files["collection.bru"]).toBeDefined();
    expect(files["collection.bru"]).toContain("X-Root: 1");

    const rebuilt = brunoToTree(files, root.name);
    const rebuiltRoot = asFolder(rebuilt[0]);
    expect(rebuiltRoot.config.headers).toEqual([
      { key: "X-Root", value: "1", enabled: true },
    ]);
    expect(rebuiltRoot.config.auth).toEqual(
      authOf({ active: "bearer", token: "{{t}}" }),
    );
    expect(rebuiltRoot.config.scripts?.pre).toContain("root();");
  });

  // AC-005 - behavior: an explicit auth.active "none" emits the `auth: none`
  // selector on the method block (and no auth:bearer/basic block).
  it("should emit the auth: none selector for an explicit none auth", () => {
    const root: BrunoExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Open",
          method: "GET",
          config: { auth: authOf({ active: "none" }) },
        }),
      ],
    };

    const bru = treeToBrunoFiles(root)["open.bru"];
    expect(bru).toContain("auth: none");
    expect(bru).not.toContain("auth:bearer");
    expect(bru).not.toContain("auth:basic");
  });
});

describe("treeToBrunoFiles - round-trip via brunoToTree (AC-009)", () => {
  // Project a node to only the round-trip-preserved shape: ids are minted fresh
  // by the importer, and Bruno cannot represent timeoutMs / environmentColors /
  // request-level environments / params.path, so those are excluded. Children are
  // name-sorted because the importer emits folders-before-requests (order differs
  // from the source array).
  function project(node: TreeNode): Record<string, unknown> {
    if (node.kind === "request") {
      return {
        kind: "request",
        name: node.name,
        method: node.method,
        url: node.url,
        headers: node.config.headers ?? [],
        query: node.params.query,
        variables: node.config.variables ?? [],
        auth: node.config.auth,
        scripts: node.config.scripts,
        body: node.body,
      };
    }
    return {
      kind: "folder",
      name: node.name,
      headers: node.config.headers ?? [],
      variables: node.config.variables ?? [],
      auth: node.config.auth,
      scripts: node.config.scripts,
      children: projectChildren(node.children),
    };
  }

  function projectChildren(children: TreeNode[]): Record<string, unknown>[] {
    return [...children]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(project);
  }

  const bearer = authOf({ active: "bearer", token: "{{tok}}" });

  // TC-009 (load-bearing) - behavior: a multi-level tree (nested folders;
  // json/form/multipart/graphql+vars bodies; headers with a disabled row; query
  // params; vars; bearer auth; pre + post scripts; one environment) survives a
  // brunoToTree(treeToBrunoFiles(root)) round-trip - folder nesting and every
  // request's name/method/url/enabled-headers/query/vars/auth/scripts/body equal
  // the originals, modulo node ids and Bruno-unrepresentable fields.
  it("should reconstruct the tree shape after emitting then re-importing", () => {
    const root: BrunoExportRoot = {
      name: "My API",
      config: {
        environments: [{ name: "dev", variables: [{ key: "K", value: "1" }] }],
      },
      dotenv: "K=V",
      children: [
        req({
          name: "Create User",
          method: "POST",
          url: "https://api.example.com/users",
          body: {
            ...emptyBody(),
            active: "json",
            types: { ...emptyBody().types, json: '{"id":1}' },
          },
          params: {
            path: [],
            query: [{ key: "page", value: "2", enabled: true }],
          },
          config: {
            headers: [
              { key: "Accept", value: "application/json", enabled: true },
              { key: "X-Debug", value: "1", enabled: false },
            ],
            variables: [{ key: "baseUrl", value: "https://api.example.com" }],
            auth: bearer,
            scripts: { pre: "pre();", post: "post();" },
          },
        }),
        folder({
          name: "Orders",
          config: {
            headers: [{ key: "X-Org", value: "acme", enabled: true }],
            auth: bearer,
          },
          children: [
            req({
              name: "Create Order",
              method: "POST",
              url: "https://api.example.com/orders",
              body: {
                ...emptyBody(),
                active: "form",
                types: {
                  ...emptyBody().types,
                  form: [{ key: "a", value: "b", enabled: true }],
                },
              },
              config: { auth: bearer },
            }),
            req({
              name: "Upload File",
              method: "POST",
              url: "https://api.example.com/upload",
              body: {
                ...emptyBody(),
                active: "multipart",
                types: {
                  ...emptyBody().types,
                  multipart: [{ key: "file", value: "x", enabled: true }],
                },
              },
              config: { auth: bearer },
            }),
            folder({
              name: "GraphQL",
              config: { auth: bearer },
              children: [
                req({
                  name: "Run Query",
                  method: "POST",
                  url: "https://api.example.com/graphql",
                  body: {
                    ...emptyBody(),
                    active: "graphql",
                    types: {
                      ...emptyBody().types,
                      graphql: {
                        query: "query { me { id } }",
                        variables: '{ "x": 1 }',
                      },
                    },
                  },
                  config: { auth: bearer },
                }),
              ],
            }),
          ],
        }),
      ],
    };

    const rebuilt = brunoToTree(treeToBrunoFiles(root), root.name);

    expect(rebuilt).toHaveLength(1);
    const rebuiltRoot = asFolder(rebuilt[0]);
    expect(rebuiltRoot.name).toBe("My API");
    expect(rebuiltRoot.dotenv).toBe("K=V");
    expect(rebuiltRoot.config.environments).toEqual([
      { name: "dev", variables: [{ key: "K", value: "1" }] },
    ]);
    expect(projectChildren(rebuiltRoot.children)).toEqual(
      projectChildren(root.children),
    );
  });
});
