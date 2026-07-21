import { describe, expect, it } from "vitest";

import { openapiToTree } from "@/lib/openapi/openapi-to-tree";
import {
  type OpenapiExportRoot,
  treeToOpenapiDoc,
} from "@/lib/openapi/tree-to-openapi";
import type {
  FolderNode,
  KeyValue,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";

// ---- fixture builders (realistic nodes via model helpers + overrides) --------

function req(overrides: Partial<RequestNode>): RequestNode {
  return {
    kind: "request",
    id: "x1",
    name: "Req",
    method: "GET",
    url: "{{baseUrl}}/x",
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
  if (node?.kind !== "folder") {
    throw new Error("expected a folder node");
  }
  return node;
}

// ---- helpers to observe the emitted OpenAPI document -------------------------

type OpenapiParam = {
  name: string;
  in: string;
  required?: boolean;
  schema?: unknown;
  example?: unknown;
};

type OpenapiOperation = {
  summary?: string;
  tags?: string[];
  parameters?: OpenapiParam[];
  requestBody?: { content: Record<string, { example?: unknown }> };
};

type OpenapiDoc = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, OpenapiOperation>>;
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string }>;
  components?: { securitySchemes?: Record<string, Record<string, unknown>> };
  security?: Array<Record<string, unknown>>;
};

function docOf(root: OpenapiExportRoot): OpenapiDoc {
  return treeToOpenapiDoc(root) as unknown as OpenapiDoc;
}

function operationOf(
  doc: OpenapiDoc,
  path: string,
  method: string,
): OpenapiOperation {
  const item = doc.paths[path];
  if (item === undefined) {
    throw new Error(`no path item ${path}`);
  }
  const op = item[method];
  if (op === undefined) {
    throw new Error(`no ${method} operation on ${path}`);
  }
  return op;
}

function paramOf(
  op: OpenapiOperation,
  where: string,
  name: string,
): OpenapiParam {
  const param = (op.parameters ?? []).find(
    (p) => p.in === where && p.name === name,
  );
  if (param === undefined) {
    throw new Error(`no ${where} parameter ${name}`);
  }
  return param;
}

function rowValue(
  rows: KeyValue[] | undefined,
  key: string,
): string | undefined {
  return rows?.find((row) => row.key === key)?.value;
}

describe("treeToOpenapiDoc - document root + single request (AC-001, AC-002, AC-003)", () => {
  // TC-001 - behavior: a root with one GET request emits a 3.0.3 document whose
  // info.title is the root name, a server derived from the config baseUrl, and a
  // path-item operation keyed by the lowercased method with the request's summary.
  it("should emit a 3.0.3 document with info.title, a server, and a get operation if the root has one request", () => {
    const root: OpenapiExportRoot = {
      name: "My API",
      config: {
        variables: [{ key: "baseUrl", value: "https://api.example.com" }],
      },
      children: [
        req({ name: "List Users", method: "GET", url: "{{baseUrl}}/users" }),
      ],
    };

    const doc = docOf(root);

    expect(doc.openapi).toBe("3.0.3");
    expect(doc.info).toEqual({ title: "My API", version: "1.0.0" });
    expect(doc.servers).toEqual([{ url: "https://api.example.com" }]);
    expect(operationOf(doc, "/users", "get").summary).toBe("List Users");
  });
});

describe("treeToOpenapiDoc - merge operations on one path (AC-002)", () => {
  // AC-002 - behavior: two requests sharing one path but different methods merge
  // under a single path-item key, one operation per method.
  it("should merge a GET and a POST on the same path into one path item", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: {},
      children: [
        req({ name: "List", method: "GET", url: "{{baseUrl}}/users" }),
        req({ name: "Create", method: "POST", url: "{{baseUrl}}/users" }),
      ],
    };

    const doc = docOf(root);

    expect(Object.keys(doc.paths)).toEqual(["/users"]);
    expect(Object.keys(doc.paths["/users"]).sort()).toEqual(["get", "post"]);
    expect(operationOf(doc, "/users", "get").summary).toBe("List");
    expect(operationOf(doc, "/users", "post").summary).toBe("Create");
  });
});

describe("treeToOpenapiDoc - path templating + path param (AC-003, AC-004)", () => {
  // TC-002 - behavior: a :seg url segment becomes a {seg} path key and a path row
  // becomes an in:path parameter with required:true, a string schema and the value
  // as its example.
  it("should convert :id to a {id} path and emit a required in:path parameter with the value example", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Get User",
          method: "GET",
          url: "{{baseUrl}}/users/:id",
          params: { query: [], path: [{ key: "id", value: "7" }] },
        }),
      ],
    };

    const op = operationOf(docOf(root), "/users/{id}", "get");

    expect(paramOf(op, "path", "id")).toEqual({
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string" },
      example: "7",
    });
  });
});

describe("treeToOpenapiDoc - query + header params (AC-004)", () => {
  // TC-003 - behavior: a query row emits an in:query parameter and a header row
  // emits an in:header parameter, each with a string schema and its value example.
  it("should emit an in:query parameter for a query row and an in:header parameter for a header row", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Search",
          method: "GET",
          url: "{{baseUrl}}/search",
          params: { query: [{ key: "page", value: "2" }], path: [] },
          config: { headers: [{ key: "X-Api", value: "k" }] },
        }),
      ],
    };

    const op = operationOf(docOf(root), "/search", "get");

    expect(paramOf(op, "query", "page")).toEqual({
      name: "page",
      in: "query",
      schema: { type: "string" },
      example: "2",
    });
    expect(paramOf(op, "header", "X-Api")).toEqual({
      name: "X-Api",
      in: "header",
      schema: { type: "string" },
      example: "k",
    });
  });
});

describe("treeToOpenapiDoc - empty param value omits example (AC-004)", () => {
  // TC-004 - behavior: a query row with an empty value emits a parameter without an
  // example key (only non-empty values seed an example).
  it("should omit the example key for a query row whose value is empty", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Empty",
          method: "GET",
          url: "{{baseUrl}}/e",
          params: { query: [{ key: "q", value: "" }], path: [] },
        }),
      ],
    };

    const param = paramOf(operationOf(docOf(root), "/e", "get"), "query", "q");

    expect("example" in param).toBe(false);
  });
});

describe("treeToOpenapiDoc - json request body (AC-005)", () => {
  // TC-005 - behavior: a json body with valid (indented) JSON text emits an
  // application/json media type whose example is the parsed value.
  it("should emit an application/json example equal to the parsed json body", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Create",
          method: "POST",
          url: "{{baseUrl}}/x",
          body: {
            ...emptyBody(),
            active: "json",
            types: { ...emptyBody().types, json: '{\n  "a": 1\n}' },
          },
        }),
      ],
    };

    const op = operationOf(docOf(root), "/x", "post");

    expect(op.requestBody?.content["application/json"].example).toEqual({
      a: 1,
    });
  });
});

describe("treeToOpenapiDoc - non-json body media types (AC-005)", () => {
  // TC-006 - behavior: form/multipart/graphql bodies emit their best-effort media
  // types (urlencoded, form-data, application/json), and graphql's json example is
  // the {query, variables} object.
  it("should map form/multipart/graphql bodies to their media types with a graphql {query,variables} example", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Form",
          method: "POST",
          url: "{{baseUrl}}/form",
          body: {
            ...emptyBody(),
            active: "form",
            types: { ...emptyBody().types, form: [{ key: "a", value: "b" }] },
          },
        }),
        req({
          name: "Multipart",
          method: "POST",
          url: "{{baseUrl}}/multipart",
          body: {
            ...emptyBody(),
            active: "multipart",
            types: {
              ...emptyBody().types,
              multipart: [{ key: "file", value: "x" }],
            },
          },
        }),
        req({
          name: "Graphql",
          method: "POST",
          url: "{{baseUrl}}/graphql",
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
        }),
      ],
    };

    const doc = docOf(root);

    expect(
      "application/x-www-form-urlencoded" in
        (operationOf(doc, "/form", "post").requestBody?.content ?? {}),
    ).toBe(true);
    expect(
      "multipart/form-data" in
        (operationOf(doc, "/multipart", "post").requestBody?.content ?? {}),
    ).toBe(true);

    const graphql = operationOf(doc, "/graphql", "post");
    expect(graphql.requestBody?.content["application/json"].example).toEqual({
      query: "query { me { id } }",
      variables: '{ "x": 1 }',
    });
  });
});

describe("treeToOpenapiDoc - none body (AC-005)", () => {
  // TC-007 - behavior: a request with body.active "none" emits no requestBody key.
  it("should emit no requestBody key for a none body", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Bare",
          method: "GET",
          url: "{{baseUrl}}/bare",
          body: { ...emptyBody(), active: "none" },
        }),
      ],
    };

    const op = operationOf(docOf(root), "/bare", "get");

    expect("requestBody" in op).toBe(false);
  });
});

describe("treeToOpenapiDoc - tags from immediate parent folder (AC-006)", () => {
  // TC-008 - behavior: a request inside a folder gets tags:[folderName] and that name
  // appears once in the top-level tags; a loose request under the root has no tags.
  it("should tag a foldered request with its parent name and leave a loose request untagged", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: {},
      children: [
        folder({
          name: "Users",
          children: [
            req({ name: "List", method: "GET", url: "{{baseUrl}}/users" }),
          ],
        }),
        req({ name: "Ping", method: "GET", url: "{{baseUrl}}/ping" }),
      ],
    };

    const doc = docOf(root);

    expect(operationOf(doc, "/users", "get").tags).toEqual(["Users"]);
    expect("tags" in operationOf(doc, "/ping", "get")).toBe(false);
    expect(doc.tags).toEqual([{ name: "Users" }]);
  });
});

describe("treeToOpenapiDoc - deep nesting flattened onto direct parent (AC-006)", () => {
  // TC-009 - behavior: root -> A -> B -> request tags the operation with B (the direct
  // parent) only; A contributes no tag, and re-import lands the request in one flat B
  // folder under the root (no A).
  it("should tag with the immediate parent folder B and drop the outer folder A", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: {},
      children: [
        folder({
          name: "A",
          children: [
            folder({
              name: "B",
              children: [
                req({ name: "Deep", method: "GET", url: "{{baseUrl}}/deep" }),
              ],
            }),
          ],
        }),
      ],
    };

    const doc = docOf(root);

    expect(operationOf(doc, "/deep", "get").tags).toEqual(["B"]);
    expect(doc.tags).toEqual([{ name: "B" }]);

    const rebuilt = openapiToTree(JSON.stringify(doc), "C");
    const rebuiltRoot = asFolder(rebuilt[0]);
    const folderNames = rebuiltRoot.children
      .filter((n): n is FolderNode => n.kind === "folder")
      .map((n) => n.name);
    expect(folderNames).toEqual(["B"]);
  });
});

describe("treeToOpenapiDoc - single server from baseUrl (AC-007)", () => {
  // TC-010 - behavior: a lone baseUrl config variable emits a single server; request
  // paths carry no {{baseUrl}} prefix.
  it("should emit one server from the baseUrl variable and strip the {{baseUrl}} prefix from paths", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: {
        variables: [{ key: "baseUrl", value: "https://api.example.com" }],
      },
      children: [
        req({ name: "List", method: "GET", url: "{{baseUrl}}/users" }),
      ],
    };

    const doc = docOf(root);

    expect(doc.servers).toEqual([{ url: "https://api.example.com" }]);
    expect(Object.keys(doc.paths)).toEqual(["/users"]);
  });
});

describe("treeToOpenapiDoc - environments to servers (AC-007)", () => {
  // TC-011 - behavior: with environments present, one server is emitted per
  // environment (url = that env's baseUrl, description = env name). A top-level
  // baseUrl variable (as the importer produces alongside environments on a
  // multi-server doc) does NOT add a duplicate first server - environments win.
  it("should emit exactly one server per environment and no duplicate for the baseUrl variable", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: {
        variables: [{ key: "baseUrl", value: "https://dev.example.com" }],
        environments: [
          {
            name: "dev",
            variables: [{ key: "baseUrl", value: "https://dev.example.com" }],
          },
          {
            name: "prod",
            variables: [{ key: "baseUrl", value: "https://api.example.com" }],
          },
        ],
      },
      children: [
        req({ name: "List", method: "GET", url: "{{baseUrl}}/users" }),
      ],
    };

    const doc = docOf(root);

    expect(doc.servers).toEqual([
      { url: "https://dev.example.com", description: "dev" },
      { url: "https://api.example.com", description: "prod" },
    ]);
  });
});

describe("treeToOpenapiDoc - bearer security (AC-008)", () => {
  // TC-012 - behavior: root bearer auth emits an http+bearer securityScheme plus a
  // top-level security requirement referencing it; the token value never appears.
  it("should emit an http+bearer scheme + security requirement and leak no token", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: {
        auth: authOf({ active: "bearer", token: "supersecret-token" }),
      },
      children: [
        req({ name: "List", method: "GET", url: "{{baseUrl}}/users" }),
      ],
    };

    const doc = docOf(root);
    const schemes = doc.components?.securitySchemes ?? {};
    const names = Object.keys(schemes);

    expect(names).toHaveLength(1);
    expect(schemes[names[0]]).toEqual({ type: "http", scheme: "bearer" });
    expect(Array.isArray(doc.security)).toBe(true);
    expect(doc.security?.[0]).toHaveProperty(names[0]);
    expect(JSON.stringify(doc)).not.toContain("supersecret-token");
  });
});

describe("treeToOpenapiDoc - basic security (AC-008)", () => {
  // TC-013 - behavior: root basic auth emits an http+basic securityScheme + a
  // requirement; the credentials never appear in the document.
  it("should emit an http+basic scheme + security requirement and leak no credentials", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: {
        auth: authOf({
          active: "basic",
          username: "admin-user",
          password: "hunter2pw",
        }),
      },
      children: [
        req({ name: "List", method: "GET", url: "{{baseUrl}}/users" }),
      ],
    };

    const doc = docOf(root);
    const schemes = doc.components?.securitySchemes ?? {};
    const names = Object.keys(schemes);

    expect(names).toHaveLength(1);
    expect(schemes[names[0]]).toEqual({ type: "http", scheme: "basic" });
    expect(doc.security?.[0]).toHaveProperty(names[0]);
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain("admin-user");
    expect(serialized).not.toContain("hunter2pw");
  });
});

describe("treeToOpenapiDoc - no security (AC-008)", () => {
  // TC-014 - behavior: an inherit (or absent) auth emits neither securitySchemes nor
  // a security requirement.
  it("should emit no securitySchemes and no security for an inherit auth", () => {
    const root: OpenapiExportRoot = {
      name: "C",
      config: { auth: authOf({ active: "inherit" }) },
      children: [
        req({ name: "List", method: "GET", url: "{{baseUrl}}/users" }),
      ],
    };

    const doc = docOf(root);

    expect(doc.components?.securitySchemes).toBeUndefined();
    expect("security" in doc).toBe(false);
  });
});

describe("treeToOpenapiDoc - round-trip via openapiToTree (AC-009)", () => {
  // Project a node to only the importer-expressible, round-trip-preserved shape.
  // The importer mints fresh ids, resets auth secrets to empty, re-serializes the
  // JSON body with 2-space indent (whitespace normalizes), and drops non-JSON
  // bodies. So: strip ids; compare header/query/path rows by key+value only (the
  // importer produces {key,value} rows); compare the JSON body by its PARSED value;
  // compare auth by MODE only (secret reset). Children are name-sorted, same
  // discipline as the Bruno/Postman round-trip tests.
  function rows(
    list: KeyValue[] | undefined,
  ): Array<{ key: string; value: string }> {
    return (list ?? []).map(({ key, value }) => ({ key, value }));
  }

  function project(node: TreeNode): Record<string, unknown> {
    if (node.kind === "request") {
      return {
        kind: "request",
        name: node.name,
        method: node.method,
        url: node.url,
        query: rows(node.params.query),
        path: rows(node.params.path),
        headers: rows(node.config.headers),
        body:
          node.body.active === "json"
            ? { active: "json", json: JSON.parse(node.body.types.json) }
            : { active: node.body.active },
        authMode: node.config.auth?.active ?? null,
      };
    }
    return {
      kind: "folder",
      name: node.name,
      children: projectChildren(node.children),
    };
  }

  function projectChildren(children: TreeNode[]): Record<string, unknown>[] {
    return [...children]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(project);
  }

  // TC-015 (load-bearing) - behavior: a tree in importer-canonical shape (root; one
  // tag folder + one loose request; query/path/header rows; a JSON body; a baseUrl
  // variable; root bearer auth) survives openapiToTree(treeToOpenapiDoc(root)) as a
  // single root folder whose nesting + per-request name/method/url/query/path/
  // headers/JSON-body + baseUrl variable + auth MODE equal the originals, modulo
  // node ids and the reset bearer token.
  it("should reconstruct the importer-expressible subset after emitting then re-importing", () => {
    const root: OpenapiExportRoot = {
      name: "My API",
      config: {
        variables: [{ key: "baseUrl", value: "https://api.example.com" }],
        auth: authOf({ active: "bearer", token: "secret-token-xyz" }),
      },
      children: [
        folder({
          name: "Users",
          children: [
            req({
              name: "Get User",
              method: "GET",
              url: "{{baseUrl}}/users/:id",
              params: {
                query: [{ key: "page", value: "2" }],
                path: [{ key: "id", value: "7" }],
              },
              config: { headers: [{ key: "X-Api", value: "k" }] },
              body: {
                ...emptyBody(),
                active: "json",
                types: { ...emptyBody().types, json: '{"a":1}' },
              },
            }),
          ],
        }),
        req({
          name: "Health",
          method: "GET",
          url: "{{baseUrl}}/health",
          body: { ...emptyBody(), active: "none" },
        }),
      ],
    };

    const doc = treeToOpenapiDoc(root);
    const rebuilt = openapiToTree(JSON.stringify(doc), root.name);

    expect(rebuilt).toHaveLength(1);
    const rebuiltRoot = asFolder(rebuilt[0]);
    expect(rebuiltRoot.name).toBe("My API");
    expect(rowValue(rebuiltRoot.config.variables, "baseUrl")).toBe(
      "https://api.example.com",
    );
    expect(rebuiltRoot.config.auth?.active).toBe("bearer");
    expect(rebuiltRoot.config.auth?.types.bearer.token).toBe("");
    expect(JSON.stringify(doc)).not.toContain("secret-token-xyz");
    expect(projectChildren(rebuiltRoot.children)).toEqual(
      projectChildren(root.children),
    );
  });
});
