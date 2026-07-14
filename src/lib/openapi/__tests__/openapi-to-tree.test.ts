import { describe, it, expect } from "vitest";

import { openapiToTree } from "@/lib/openapi/openapi-to-tree";
import { authOf } from "@/lib/workspace/model";
import type {
  FolderNode,
  KeyValue,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";

function collectNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) =>
    node.kind === "folder" ? [node, ...collectNodes(node.children)] : [node],
  );
}

function collectRequests(nodes: TreeNode[]): RequestNode[] {
  return collectNodes(nodes).filter(
    (node): node is RequestNode => node.kind === "request",
  );
}

function treeRoot(doc: Record<string, unknown>, fallback = "fallback"): FolderNode {
  const tree = openapiToTree(JSON.stringify(doc), fallback);
  const root = tree[0];
  if (tree.length !== 1 || !root || root.kind !== "folder") {
    throw new Error("expected a single root folder node");
  }
  return root;
}

function rowValue(rows: KeyValue[] | undefined, key: string): string | undefined {
  return rows?.find((row) => row.key === key)?.value;
}

// A doc with sensible 3.0 defaults; `paths`/`servers`/`security`/`components`/`info`
// are supplied by each test via the overrides.
function doc(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: { title: "My API", version: "1.0.0" },
    paths: {},
    ...overrides,
  };
}

describe("openapiToTree - operation -> request (AC-002)", () => {
  // AC-002, TC-002 - behavior: a path with get + post yields two request nodes
  // with the upper-cased methods.
  it("should build one request per (path, method) with upper-cased methods", () => {
    const root = treeRoot(
      doc({
        paths: {
          "/x": {
            get: { summary: "Get X" },
            post: { summary: "Post X" },
          },
        },
      }),
    );
    const requests = collectRequests(root.children);

    expect(requests.map((r) => r.method).sort()).toEqual(["GET", "POST"]);
  });

  // AC-002, TC-002 - behavior: only get/post/put/patch/delete are imported;
  // head/options/trace keys are skipped.
  it("should skip head/options/trace method keys", () => {
    const root = treeRoot(
      doc({
        paths: {
          "/x": {
            get: { summary: "Get X" },
            head: { summary: "Head X" },
            options: { summary: "Options X" },
            trace: { summary: "Trace X" },
          },
        },
      }),
    );
    const requests = collectRequests(root.children);

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
  });

  // AC-002, TC-002 - behavior: name uses summary when present.
  it("should name the request from summary when present", () => {
    const root = treeRoot(
      doc({ paths: { "/x": { get: { summary: "Get X", operationId: "getX" } } } }),
    );

    expect(collectRequests(root.children)[0].name).toBe("Get X");
  });

  // AC-002, TC-002 - behavior: name falls back to operationId when no summary.
  it("should fall back to operationId when there is no summary", () => {
    const root = treeRoot(
      doc({ paths: { "/x": { get: { operationId: "getX" } } } }),
    );

    expect(collectRequests(root.children)[0].name).toBe("getX");
  });

  // AC-002, TC-002 - behavior: name falls back to "METHOD path" when neither
  // summary nor operationId is present.
  it("should fall back to 'METHOD path' when there is no summary or operationId", () => {
    const root = treeRoot(doc({ paths: { "/x": { get: {} } } }));

    expect(collectRequests(root.children)[0].name).toBe("GET /x");
  });
});

describe("openapiToTree - url (AC-003)", () => {
  // AC-003, TC-003 - behavior: with a server, url = {{baseUrl}} + path and the
  // OpenAPI {name} template is rewritten to ReqUI :name.
  it("should build {{baseUrl}} + path with {name} rewritten to :name", () => {
    const root = treeRoot(
      doc({
        servers: [{ url: "https://api.example.com/v1" }],
        paths: { "/users/{id}": { get: {} } },
      }),
    );

    expect(collectRequests(root.children)[0].url).toBe("{{baseUrl}}/users/:id");
  });

  // AC-003, TC-003 - behavior: with no servers the url is the bare path (no
  // {{baseUrl}} prefix).
  it("should use the bare path when there are no servers", () => {
    const root = treeRoot(doc({ paths: { "/users/{id}": { get: {} } } }));

    expect(collectRequests(root.children)[0].url).toBe("/users/:id");
  });
});

describe("openapiToTree - parameters (AC-004)", () => {
  // AC-004, TC-004 - behavior: parameters split by `in` into params.path /
  // params.query / config.headers.
  it("should split parameters by `in` into the path/query/header grids", () => {
    const root = treeRoot(
      doc({
        paths: {
          "/users/{id}": {
            get: {
              parameters: [
                { name: "id", in: "path", schema: { type: "string" }, example: "42" },
                { name: "verbose", in: "query", schema: { type: "boolean" }, example: "true" },
                { name: "X-Trace", in: "header", schema: { type: "string" }, example: "abc" },
              ],
            },
          },
        },
      }),
    );
    const request = collectRequests(root.children)[0];

    expect(rowValue(request.params.path, "id")).toBe("42");
    expect(rowValue(request.params.query, "verbose")).toBe("true");
    expect(rowValue(request.config.headers, "X-Trace")).toBe("abc");
  });

  // AC-004, TC-004 - behavior: the value is seeded from `example`, else from
  // `schema.default`.
  it("should seed the value from example, else from schema.default", () => {
    const root = treeRoot(
      doc({
        paths: {
          "/x": {
            get: {
              parameters: [
                { name: "withExample", in: "query", schema: { default: "sd" }, example: "ex" },
                { name: "withDefault", in: "query", schema: { default: "sd" } },
              ],
            },
          },
        },
      }),
    );
    const request = collectRequests(root.children)[0];

    expect(rowValue(request.params.query, "withExample")).toBe("ex");
    expect(rowValue(request.params.query, "withDefault")).toBe("sd");
  });

  // AC-004 - behavior: with no `example` the parameter value falls back to the
  // schema's `example` before its `default`.
  it("should seed the value from schema.example before schema.default", () => {
    const root = treeRoot(
      doc({
        paths: {
          "/x": {
            get: {
              parameters: [
                { name: "q", in: "query", schema: { example: "se", default: "sd" } },
              ],
            },
          },
        },
      }),
    );

    expect(rowValue(collectRequests(root.children)[0].params.query, "q")).toBe("se");
  });

  // AC-004, TC-004 - behavior: a path-item-level shared parameter merges with the
  // operation's parameters; the operation wins on a same name+in clash.
  it("should merge a path-level shared parameter with the operation, op winning on clash", () => {
    const root = treeRoot(
      doc({
        paths: {
          "/users/{id}": {
            parameters: [
              { name: "id", in: "path", schema: { default: "shared" } },
              { name: "shared-q", in: "query", schema: { default: "from-path" } },
            ],
            get: {
              parameters: [
                { name: "id", in: "path", schema: { default: "op-wins" } },
                { name: "op-q", in: "query", schema: { default: "from-op" } },
              ],
            },
          },
        },
      }),
    );
    const request = collectRequests(root.children)[0];

    expect(rowValue(request.params.path, "id")).toBe("op-wins");
    expect(rowValue(request.params.query, "shared-q")).toBe("from-path");
    expect(rowValue(request.params.query, "op-q")).toBe("from-op");
  });
});

describe("openapiToTree - request body (AC-005)", () => {
  // AC-005, TC-005 - behavior: an application/json `example` -> json body,
  // stringified (the parsed-back value equals the example).
  it("should seed a json body from an application/json example", () => {
    const example = { name: "Ada", age: 36 };
    const root = treeRoot(
      doc({
        paths: {
          "/users": {
            put: {
              requestBody: { content: { "application/json": { example } } },
            },
          },
        },
      }),
    );
    const request = collectRequests(root.children)[0];

    expect(request.body.active).toBe("json");
    expect(JSON.parse(request.body.types.json)).toEqual(example);
  });

  // AC-005, TC-005 - behavior: with no `example` the first `examples[*].value` is
  // used.
  it("should seed a json body from the first examples[*].value when there is no example", () => {
    const value = { id: 1 };
    const root = treeRoot(
      doc({
        paths: {
          "/users": {
            put: {
              requestBody: {
                content: {
                  "application/json": {
                    examples: { first: { value }, second: { value: { id: 2 } } },
                  },
                },
              },
            },
          },
        },
      }),
    );
    const request = collectRequests(root.children)[0];

    expect(request.body.active).toBe("json");
    expect(JSON.parse(request.body.types.json)).toEqual(value);
  });

  // AC-005, TC-005 - behavior: with neither example nor examples the media-type
  // schema.example is used.
  it("should seed a json body from the media-type schema.example", () => {
    const schemaExample = { fromSchema: true };
    const root = treeRoot(
      doc({
        paths: {
          "/users": {
            put: {
              requestBody: {
                content: {
                  "application/json": { schema: { example: schemaExample } },
                },
              },
            },
          },
        },
      }),
    );
    const request = collectRequests(root.children)[0];

    expect(request.body.active).toBe("json");
    expect(JSON.parse(request.body.types.json)).toEqual(schemaExample);
  });

  // AC-005, TC-005 - behavior: a non-json request body -> no body (none).
  it("should map a non-json request body to none", () => {
    const root = treeRoot(
      doc({
        paths: {
          "/upload": {
            post: {
              requestBody: {
                content: { "multipart/form-data": { example: { file: "x" } } },
              },
            },
          },
        },
      }),
    );

    expect(collectRequests(root.children)[0].body.active).toBe("none");
  });

  // AC-005, TC-005 - behavior: a json content with no example -> no body (none).
  it("should map a json body with no example to none", () => {
    const root = treeRoot(
      doc({
        paths: {
          "/users": {
            put: {
              requestBody: {
                content: { "application/json": { schema: { type: "object" } } },
              },
            },
          },
        },
      }),
    );

    expect(collectRequests(root.children)[0].body.active).toBe("none");
  });

  // AC-005, TC-005 - behavior: no requestBody -> no body (none).
  it("should map an absent requestBody to none", () => {
    const root = treeRoot(doc({ paths: { "/users": { get: {} } } }));

    expect(collectRequests(root.children)[0].body.active).toBe("none");
  });
});

describe("openapiToTree - servers (AC-006)", () => {
  // AC-006, TC-006 - behavior: one server -> a baseUrl variable (trailing slash
  // stripped) and no environments.
  it("should map one server to a baseUrl variable and no environments", () => {
    const root = treeRoot(
      doc({
        servers: [{ url: "https://api.example.com/v1/" }],
        paths: { "/x": { get: {} } },
      }),
    );

    expect(rowValue(root.config.variables, "baseUrl")).toBe(
      "https://api.example.com/v1",
    );
    expect(root.config.environments ?? []).toEqual([]);
  });

  // AC-006, TC-006 - behavior: two servers -> the baseUrl variable (first) plus
  // one environment per server (name from description, else "Server N"), each
  // carrying its own baseUrl.
  it("should map two servers to the first-server baseUrl var plus one environment each", () => {
    const root = treeRoot(
      doc({
        servers: [
          { url: "https://api.example.com/v1", description: "Production" },
          { url: "https://staging.example.com/v1" },
        ],
        paths: { "/x": { get: {} } },
      }),
    );

    expect(rowValue(root.config.variables, "baseUrl")).toBe(
      "https://api.example.com/v1",
    );

    const environments = root.config.environments ?? [];
    expect(environments.map((env) => env.name)).toEqual(["Production", "Server 2"]);
    expect(rowValue(environments[0].variables, "baseUrl")).toBe(
      "https://api.example.com/v1",
    );
    expect(rowValue(environments[1].variables, "baseUrl")).toBe(
      "https://staging.example.com/v1",
    );
  });

  // AC-006, edge - behavior: an invalid server entry (no url) in a multi-server
  // list is skipped without mislabeling the remaining environments.
  it("should skip an invalid server entry without mislabeling the rest", () => {
    const root = treeRoot(
      doc({
        servers: [
          { url: "https://a.com", description: "Prod" },
          { description: "Staging" },
          { url: "https://b.com", description: "Dev" },
        ],
        paths: { "/x": { get: {} } },
      }),
    );

    expect(rowValue(root.config.variables, "baseUrl")).toBe("https://a.com");
    const environments = root.config.environments ?? [];
    expect(environments.map((env) => env.name)).toEqual(["Prod", "Dev"]);
    expect(rowValue(environments[0].variables, "baseUrl")).toBe("https://a.com");
    expect(rowValue(environments[1].variables, "baseUrl")).toBe("https://b.com");
  });

  // AC-006, TC-006, edge §7 - behavior: a server-variable template {host} is
  // filled from variables.host.default.
  it("should fill a server-variable template from variables.<x>.default", () => {
    const root = treeRoot(
      doc({
        servers: [
          {
            url: "https://{host}/v1",
            variables: { host: { default: "staging.example.com" } },
          },
        ],
        paths: { "/x": { get: {} } },
      }),
    );

    expect(rowValue(root.config.variables, "baseUrl")).toBe(
      "https://staging.example.com/v1",
    );
  });
});

describe("openapiToTree - tag grouping (AC-007)", () => {
  // AC-007, TC-007 - behavior: two operations tagged `users` land in one shared
  // `users` child folder.
  it("should group operations sharing a tag under one child folder", () => {
    const root = treeRoot(
      doc({
        tags: [{ name: "users" }],
        paths: {
          "/a": { get: { tags: ["users"], summary: "A" } },
          "/b": { get: { tags: ["users"], summary: "B" } },
        },
      }),
    );
    const usersFolders = root.children.filter(
      (node): node is FolderNode =>
        node.kind === "folder" && node.name === "users",
    );

    expect(usersFolders).toHaveLength(1);
    expect(collectRequests(usersFolders[0].children)).toHaveLength(2);
  });

  // AC-007, TC-007 - behavior: an untagged operation is a request directly under
  // the root folder (not wrapped in a tag folder).
  it("should place an untagged operation directly under the root folder", () => {
    const root = treeRoot(
      doc({
        paths: { "/loose": { get: { summary: "Loose" } } },
      }),
    );
    const looseRequest = root.children.find(
      (node): node is RequestNode =>
        node.kind === "request" && node.name === "Loose",
    );

    expect(looseRequest).toBeDefined();
  });

  // AC-007, edge §7 - behavior: an operation with multiple tags is placed under
  // its first tag only (not duplicated).
  it("should place a multi-tagged operation under its first tag only", () => {
    const root = treeRoot(
      doc({
        paths: {
          "/x": { get: { tags: ["first", "second"], summary: "X" } },
        },
      }),
    );

    expect(collectRequests(root.children)).toHaveLength(1);
    const folderNames = root.children
      .filter((node): node is FolderNode => node.kind === "folder")
      .map((node) => node.name);
    expect(folderNames).toContain("first");
    expect(folderNames).not.toContain("second");
  });
});

describe("openapiToTree - $ref resolution (AC-008)", () => {
  // AC-008, TC-008 - behavior: a local parameter $ref resolves to the target
  // parameter (the query row appears).
  it("should resolve a local parameter $ref", () => {
    const root = treeRoot(
      doc({
        paths: {
          "/x": {
            get: {
              parameters: [{ $ref: "#/components/parameters/limit" }],
            },
          },
        },
        components: {
          parameters: {
            limit: { name: "limit", in: "query", schema: { default: "10" } },
          },
        },
      }),
    );
    const request = collectRequests(root.children)[0];

    expect(rowValue(request.params.query, "limit")).toBe("10");
  });

  // AC-008, TC-008 - behavior: a local requestBody $ref resolves (the body is
  // populated from the referenced example).
  it("should resolve a local requestBody $ref", () => {
    const example = { name: "Ada" };
    const root = treeRoot(
      doc({
        paths: {
          "/users": {
            put: { requestBody: { $ref: "#/components/requestBodies/UserBody" } },
          },
        },
        components: {
          requestBodies: {
            UserBody: { content: { "application/json": { example } } },
          },
        },
      }),
    );
    const request = collectRequests(root.children)[0];

    expect(request.body.active).toBe("json");
    expect(JSON.parse(request.body.types.json)).toEqual(example);
  });

  // AC-008 - behavior: a path-item-level $ref resolves so its operations import.
  it("should resolve a path-item-level $ref", () => {
    const root = treeRoot(
      doc({
        paths: { "/x": { $ref: "#/components/pathItems/shared" } },
        components: {
          pathItems: { shared: { get: { summary: "Shared" } } },
        },
      }),
    );

    expect(collectRequests(root.children)[0].name).toBe("Shared");
  });

  // AC-008, edge §7 - behavior: a cyclic $ref stops at the depth guard (treated as
  // absent) instead of infinite-looping.
  it("should treat a cyclic $ref as absent without hanging", () => {
    const root = treeRoot(
      doc({
        paths: {
          "/x": { get: { parameters: [{ $ref: "#/components/parameters/loop" }] } },
        },
        components: {
          parameters: { loop: { $ref: "#/components/parameters/loop" } },
        },
      }),
    );

    expect(collectRequests(root.children)[0].params.query).toEqual([]);
  });

  // AC-008, TC-008, edge §7 - behavior: an external $ref (not starting `#/`) is
  // treated as absent - no throw, the parameter simply does not appear.
  it("should treat an external $ref as absent without throwing", () => {
    const root = treeRoot(
      doc({
        paths: {
          "/x": {
            get: {
              parameters: [
                { $ref: "other.yaml#/x" },
                { name: "kept", in: "query", schema: { default: "y" } },
              ],
            },
          },
        },
      }),
    );
    const request = collectRequests(root.children)[0];

    expect(rowValue(request.params.query, "kept")).toBe("y");
    expect(request.params.query).toHaveLength(1);
  });
});

describe("openapiToTree - auth seed (AC-009)", () => {
  // AC-009, TC-009 - behavior: a global security requirement referencing an
  // http+bearer scheme seeds root auth to bearer with an empty token.
  it("should seed root auth to bearer from an http+bearer scheme", () => {
    const root = treeRoot(
      doc({
        paths: { "/x": { get: {} } },
        security: [{ bearerAuth: [] }],
        components: {
          securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
        },
      }),
    );

    expect(root.config.auth).toEqual(authOf({ active: "bearer", token: "" }));
  });

  // AC-009, TC-009 - behavior: an http+basic scheme seeds root auth to basic.
  it("should seed root auth to basic from an http+basic scheme", () => {
    const root = treeRoot(
      doc({
        paths: { "/x": { get: {} } },
        security: [{ basicAuth: [] }],
        components: {
          securitySchemes: { basicAuth: { type: "http", scheme: "basic" } },
        },
      }),
    );

    expect(root.config.auth).toEqual(
      authOf({ active: "basic", username: "", password: "" }),
    );
  });

  // AC-009 - behavior: a securityScheme referenced by $ref resolves before mapping.
  it("should resolve a $ref'd security scheme", () => {
    const root = treeRoot(
      doc({
        paths: { "/x": { get: {} } },
        security: [{ bearerAuth: [] }],
        components: {
          securitySchemes: {
            bearerAuth: { $ref: "#/components/securitySchemes/httpBearer" },
            httpBearer: { type: "http", scheme: "bearer" },
          },
        },
      }),
    );

    expect(root.config.auth).toEqual(authOf({ active: "bearer", token: "" }));
  });

  // AC-009, TC-009 - behavior: an apiKey scheme seeds no auth (the folder/request
  // inherits from an ancestor scope).
  it("should set no auth for an apiKey scheme", () => {
    const root = treeRoot(
      doc({
        paths: { "/x": { get: {} } },
        security: [{ apiKeyAuth: [] }],
        components: {
          securitySchemes: {
            apiKeyAuth: { type: "apiKey", in: "header", name: "X-Api-Key" },
          },
        },
      }),
    );

    expect(root.config.auth).toBeUndefined();
  });
});

describe("openapiToTree - root wrap + fallback + empty (AC-011)", () => {
  // AC-011, TC-010 - behavior: a valid doc wraps in one root folder named from
  // info.title.
  it("should wrap the result in one root folder named from info.title", () => {
    const root = treeRoot(doc({ paths: { "/x": { get: {} } } }));

    expect(root.name).toBe("My API");
  });

  // AC-011, TC-010 - behavior: the root name falls back to the provided fallback
  // when info.title is absent.
  it("should fall back to the provided name when info.title is absent", () => {
    const root = treeRoot(
      { openapi: "3.0.3", info: {}, paths: { "/x": { get: {} } } },
      "picked-file",
    );

    expect(root.name).toBe("picked-file");
  });

  // AC-011, TC-010, edge §7 - behavior: a doc with no operations (paths {}) -> [].
  it("should return an empty array for a doc with no operations", () => {
    expect(openapiToTree(JSON.stringify(doc({ paths: {} })), "fallback")).toEqual(
      [],
    );
  });

  // AC-010/AC-011 - behavior: an unparseable / unversioned doc -> [].
  it("should return an empty array for an invalid document", () => {
    expect(openapiToTree("not a document {{{", "fallback")).toEqual([]);
    expect(
      openapiToTree(JSON.stringify({ info: { title: "x" }, paths: {} }), "fallback"),
    ).toEqual([]);
  });

  // A swagger 2.0 doc is now ACCEPTED (normalized to 3.x), so an empty result means
  // "no operations", not "rejected" - an operationless 2.0 doc still yields [].
  it("should return an empty array for a swagger 2.0 doc with no operations", () => {
    expect(
      openapiToTree(JSON.stringify({ swagger: "2.0", paths: {} }), "fallback"),
    ).toEqual([]);
  });

  // AC-011, edge §7 - behavior: a path with only unsupported method keys yields
  // no operations -> [].
  it("should return an empty array when only unsupported method keys are present", () => {
    expect(
      openapiToTree(
        JSON.stringify(doc({ paths: { "/x": { head: {}, options: {} } } })),
        "fallback",
      ),
    ).toEqual([]);
  });

  // AC-010, edge §7 - behavior: a structurally malformed 3.x doc (wrong-typed
  // top-level fields) never throws; it yields [] (no operations reachable).
  it("should not throw on a structurally malformed 3.x document", () => {
    const malformed = {
      openapi: "3.0.3",
      info: "not-an-object",
      servers: ["https://a.com", null],
      paths: [],
      components: 42,
      security: "nope",
    };

    expect(() =>
      openapiToTree(JSON.stringify(malformed), "fallback"),
    ).not.toThrow();
    expect(openapiToTree(JSON.stringify(malformed), "fallback")).toEqual([]);
  });
});
