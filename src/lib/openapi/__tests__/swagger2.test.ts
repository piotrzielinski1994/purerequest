import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openapiToTree } from "@/lib/openapi/openapi-to-tree";
import { parseOpenapiDocument } from "@/lib/openapi/parse-openapi";
import { normalizeSwagger2 } from "@/lib/openapi/swagger2";
import type {
  FolderNode,
  KeyValue,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";

// --- tree helpers (mirrored from openapi-to-tree.test.ts) ---

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

function treeRoot(
  doc: Record<string, unknown>,
  fallback = "fallback",
): FolderNode {
  const tree = openapiToTree(JSON.stringify(doc), fallback);
  const root = tree[0];
  if (tree.length !== 1 || !root || root.kind !== "folder") {
    throw new Error("expected a single root folder node");
  }
  return root;
}

function rowValue(
  rows: KeyValue[] | undefined,
  key: string,
): string | undefined {
  return rows?.find((row) => row.key === key)?.value;
}

// Narrow the operation slice the body-split assertions read (avoids `any`).
type NormalizedOp = {
  requestBody?: { content: Record<string, { schema: unknown }> };
  parameters?: Array<Record<string, unknown>>;
};

function opAt(
  doc: Record<string, unknown>,
  path: string,
  method: string,
): NormalizedOp {
  const paths = doc.paths as Record<string, Record<string, NormalizedOp>>;
  return paths[path][method];
}

const CARMEDIA_PATH = ".pzielinski/carmedia.openapi.json";

describe("normalizeSwagger2 - servers (TC-003, E-1/E-2/E-3)", () => {
  // TC-003, E-3 - behavior: schemes[0]+host+basePath -> one server url; openapi is
  // bumped to 3.0.0 and the swagger tag is dropped.
  it("should build servers from schemes+host+basePath and rewrite openapi to 3.0.0", () => {
    const result = normalizeSwagger2({
      swagger: "2.0",
      schemes: ["https"],
      host: "api.x.com",
      basePath: "/v1",
      paths: {},
    });

    expect(result.servers).toEqual([{ url: "https://api.x.com/v1" }]);
    expect(result.openapi).toBe("3.0.0");
    expect(result.swagger).toBeUndefined();
  });

  // E-3 - behavior: multiple schemes collapse to the FIRST (https), not two servers.
  it("should use the first scheme only when several schemes are present", () => {
    const result = normalizeSwagger2({
      swagger: "2.0",
      schemes: ["https", "http"],
      host: "api.x.com",
      basePath: "/v1",
      paths: {},
    });

    expect(result.servers).toEqual([{ url: "https://api.x.com/v1" }]);
  });

  // E-2 - behavior: absent schemes defaults the protocol to https.
  it("should default the scheme to https when schemes is absent", () => {
    const result = normalizeSwagger2({
      swagger: "2.0",
      host: "api.x.com",
      basePath: "/v1",
      paths: {},
    });

    expect(result.servers).toEqual([{ url: "https://api.x.com/v1" }]);
  });

  // E-1 - behavior: no host -> no `servers` key at all (mapper -> relative paths).
  it("should omit the servers key when there is no host", () => {
    const result = normalizeSwagger2({
      swagger: "2.0",
      basePath: "/v1",
      paths: {},
    });

    expect("servers" in result).toBe(false);
  });
});

describe("normalizeSwagger2 - body split + params (TC-004, E-7)", () => {
  // TC-004, E-7 - behavior: an in:body param's schema becomes the JSON requestBody
  // schema and the body param is removed from `parameters`.
  it("should move an in:body param schema to requestBody and drop it from parameters", () => {
    const result = normalizeSwagger2({
      swagger: "2.0",
      paths: {
        "/x": {
          post: {
            parameters: [
              {
                name: "d",
                in: "body",
                required: true,
                schema: { $ref: "#/definitions/D" },
              },
            ],
          },
        },
      },
    });
    const post = opAt(result, "/x", "post");

    expect(post.requestBody?.content["application/json"].schema).toEqual({
      $ref: "#/definitions/D",
    });
    expect((post.parameters ?? []).some((p) => p.in === "body")).toBe(false);
  });

  // E-7 - behavior: non-body params (path/query) survive in `parameters` unchanged.
  it("should leave non-body params in parameters unchanged", () => {
    const result = normalizeSwagger2({
      swagger: "2.0",
      paths: {
        "/x": {
          get: {
            parameters: [
              { name: "id", in: "path", type: "string" },
              { name: "q", in: "query" },
            ],
          },
        },
      },
    });

    expect(opAt(result, "/x", "get").parameters).toEqual([
      { name: "id", in: "path", type: "string" },
      { name: "q", in: "query" },
    ]);
  });
});

describe("normalizeSwagger2 - security + definitions (E-5/E-6)", () => {
  // AC (security move) - behavior: securityDefinitions surface under
  // components.securitySchemes verbatim.
  it("should map securityDefinitions to components.securitySchemes", () => {
    const scheme = { type: "apiKey", name: "Authorization", in: "header" };
    const result = normalizeSwagger2({
      swagger: "2.0",
      paths: {},
      securityDefinitions: { A: scheme },
    });
    const components = result.components as Record<string, unknown>;
    const schemes = components.securitySchemes as Record<string, unknown>;

    expect(schemes.A).toEqual(scheme);
  });

  // E-6 - behavior: definitions are retained so `#/definitions/X` refs still resolve.
  it("should retain definitions so #/definitions refs resolve", () => {
    const result = normalizeSwagger2({
      swagger: "2.0",
      paths: {},
      definitions: { D: { example: { a: 1 } } },
    });
    const definitions = result.definitions as Record<string, unknown>;

    expect(definitions.D).toEqual({ example: { a: 1 } });
  });
});

describe("normalizeSwagger2 - purity", () => {
  // behavior: the adapter is pure - it must not mutate the doc it is handed.
  it("should not mutate its input", () => {
    const input = {
      swagger: "2.0",
      schemes: ["https"],
      host: "api.x.com",
      basePath: "/v1",
      paths: {
        "/x": {
          post: {
            parameters: [
              { name: "d", in: "body", schema: { $ref: "#/definitions/D" } },
            ],
          },
        },
      },
      definitions: { D: { example: { a: 1 } } },
      securityDefinitions: { A: { type: "apiKey" } },
    };
    const before = JSON.stringify(input);

    normalizeSwagger2(input);

    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("parseOpenapiDocument - swagger 2.0 gate (AC-001/002/008, TC-001)", () => {
  // AC-001, TC-001 - behavior: a minimal swagger 2.0 doc is now accepted (non-null).
  it("should accept a swagger 2.0 document", () => {
    const doc = JSON.stringify({
      swagger: "2.0",
      info: { title: "x" },
      paths: { "/x": { get: {} } },
    });

    expect(parseOpenapiDocument(doc)).not.toBeNull();
  });

  // AC-002 - behavior: a swagger 1.0 doc is still rejected (null). Regression guard;
  // passes on today's code.
  it("should still reject a swagger 1.0 document", () => {
    const doc = JSON.stringify({
      swagger: "1.0",
      info: { title: "x" },
      paths: {},
    });

    expect(parseOpenapiDocument(doc)).toBeNull();
  });

  // AC-002 - behavior: a doc with no version tag is still rejected (null). Regression
  // guard; passes on today's code.
  it("should still reject a document with no version tag", () => {
    const doc = JSON.stringify({ info: { title: "x" }, paths: {} });

    expect(parseOpenapiDocument(doc)).toBeNull();
  });

  // AC-008 - behavior: a valid 3.0 doc is still accepted (non-null). Regression
  // guard; passes on today's code.
  it("should still accept a 3.0 document", () => {
    const doc = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "x" },
      paths: { "/x": { get: {} } },
    });

    expect(parseOpenapiDocument(doc)).not.toBeNull();
  });
});

describe("openapiToTree - swagger 2.0 end-to-end (AC-003..AC-006)", () => {
  // TC-002, AC-003 - behavior: a 2.0 doc with tagged get+post yields one "T" folder
  // holding two requests with the upper-cased methods.
  it("should group tagged 2.0 operations into a folder with a request per method", () => {
    const root = treeRoot({
      swagger: "2.0",
      info: { title: "My API" },
      paths: {
        "/x": {
          get: { tags: ["T"], summary: "G" },
          post: { tags: ["T"] },
        },
      },
    });
    const folder = root.children.find(
      (node): node is FolderNode => node.kind === "folder" && node.name === "T",
    );
    expect(folder).toBeDefined();
    if (!folder) {
      throw new Error("expected a T folder");
    }
    const requests = collectRequests(folder.children);

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.method).sort()).toEqual([
      "GET",
      "POST",
    ]);
  });

  // TC-003, AC-004 - behavior: schemes+host+basePath -> root baseUrl var + a
  // {{baseUrl}}-prefixed request url.
  it("should derive a baseUrl variable and prefix request urls from schemes+host+basePath", () => {
    const root = treeRoot({
      swagger: "2.0",
      schemes: ["https"],
      host: "api.x.com",
      basePath: "/v1",
      paths: { "/x": { get: {} } },
    });

    expect(rowValue(root.config.variables, "baseUrl")).toBe(
      "https://api.x.com/v1",
    );
    expect(collectRequests(root.children)[0].url).toBe("{{baseUrl}}/x");
  });

  // TC-003, AC-004 - behavior: a 2.0 doc with no host -> bare relative url + no
  // baseUrl var.
  it("should use a bare relative url and no baseUrl var when there is no host", () => {
    const root = treeRoot({ swagger: "2.0", paths: { "/x": { get: {} } } });

    expect(collectRequests(root.children)[0].url).toBe("/x");
    expect(rowValue(root.config.variables, "baseUrl")).toBeUndefined();
  });

  // TC-004, AC-005, E-7 - behavior: a body-param $ref whose definition carries an
  // example -> a pretty-printed json body; the body key leaks into no grid.
  it("should seed a json body from a body-param $ref example and keep it out of the grids", () => {
    const root = treeRoot({
      swagger: "2.0",
      paths: {
        "/x": {
          post: {
            parameters: [
              { name: "d", in: "body", schema: { $ref: "#/definitions/D" } },
            ],
          },
        },
      },
      definitions: { D: { example: { a: 1 } } },
    });
    const request = collectRequests(root.children)[0];

    expect(request.body.active).toBe("json");
    expect(request.body.types.json).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(rowValue(request.params.path, "d")).toBeUndefined();
    expect(rowValue(request.params.query, "d")).toBeUndefined();
    expect(rowValue(request.config.headers, "d")).toBeUndefined();
  });

  // TC-005, AC-006 - behavior: a path param's `example` and a query param's top-level
  // `default` seed the path/query grids. The `q=x` half needs the Task-2 one-line
  // paramValue tweak (reads top-level `default`), so it stays RED until then.
  it("should map non-body params to the path/query grids seeding example and default", () => {
    const root = treeRoot({
      swagger: "2.0",
      paths: {
        "/x": {
          get: {
            parameters: [
              { name: "id", in: "path", type: "string", example: "7" },
              { name: "q", in: "query", default: "x" },
            ],
          },
        },
      },
    });
    const request = collectRequests(root.children)[0];

    expect(rowValue(request.params.path, "id")).toBe("7");
    expect(rowValue(request.params.query, "q")).toBe("x");
  });
});

describe("openapiToTree - real carmedia 2.0 file (TC-006, AC-007)", () => {
  // TC-006, AC-007 - behavior: the real (git-ignored) carmedia 2.0 file imports to a
  // non-empty single-root tree with the expected baseUrl. Skips when the file is
  // absent (CI) so it never fails there.
  it.skipIf(!existsSync(CARMEDIA_PATH))(
    "should import the real carmedia 2.0 file to a non-empty tree with the expected baseUrl",
    () => {
      const text = readFileSync(CARMEDIA_PATH, "utf8");
      const tree = openapiToTree(text, "carmedia");

      expect(tree).toHaveLength(1);
      const root = tree[0];
      expect(root.kind).toBe("folder");
      if (root.kind !== "folder") {
        throw new Error("expected a folder root");
      }
      expect(collectRequests(root.children).length).toBeGreaterThanOrEqual(1);
      expect(rowValue(root.config.variables, "baseUrl")).toBe(
        "https://api.carmedia2p0.com/api/1.0",
      );
    },
  );
});
