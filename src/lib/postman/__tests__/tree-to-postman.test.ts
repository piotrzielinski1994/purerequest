import { describe, it, expect } from "vitest";

import {
  postmanToTree,
  type PostmanFileMap,
} from "@/lib/postman/postman-to-tree";
import {
  treeToPostmanFiles,
  type PostmanExportRoot,
} from "@/lib/postman/tree-to-postman";
import { authOf, emptyAuth, emptyBody, emptyParams } from "@/lib/workspace/model";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

const SCHEMA =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

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

// ---- helpers to observe the emitted JSON documents --------------------------

type PostmanItem = {
  name?: string;
  request?: Record<string, unknown>;
  item?: PostmanItem[];
  event?: unknown;
  variable?: unknown;
  auth?: unknown;
};

type PostmanDoc = {
  info: { name: string; schema: string };
  item: PostmanItem[];
  variable?: unknown;
  auth?: unknown;
  event?: unknown;
};

function collectionDoc(files: PostmanFileMap): PostmanDoc {
  const path = Object.keys(files).find((p) =>
    p.endsWith(".postman_collection.json"),
  );
  if (path === undefined) {
    throw new Error("no collection file emitted");
  }
  return JSON.parse(files[path]) as PostmanDoc;
}

function requestOf(doc: PostmanDoc, name: string): Record<string, unknown> {
  const item = doc.item.find((i) => i.name === name && i.request !== undefined);
  if (!item || !item.request) {
    throw new Error(`no request item named ${name}`);
  }
  return item.request;
}

describe("treeToPostmanFiles - collection info + a single request (AC-001, AC-002)", () => {
  // TC-001 - behavior: a collection root with one GET request emits a
  // <slug>.postman_collection.json whose info carries name + the v2.1 schema and
  // whose top-level item holds the request with its method, url and header.
  it("should emit a collection with info.name/schema and a top-level request item if the root has one GET request", () => {
    const root: PostmanExportRoot = {
      name: "My API",
      config: {},
      children: [
        req({
          name: "Get Users",
          method: "GET",
          url: "https://api.example.com/users",
          config: {
            headers: [
              { key: "Accept", value: "application/json", enabled: true },
            ],
          },
        }),
      ],
    };

    const files = treeToPostmanFiles(root);

    expect(files["my-api.postman_collection.json"]).toBeDefined();

    const doc = collectionDoc(files);
    expect(doc.info.name).toBe("My API");
    expect(doc.info.schema).toBe(SCHEMA);

    const request = requestOf(doc, "Get Users");
    expect(request.method).toBe("GET");
    expect(request.url).toEqual({ raw: "https://api.example.com/users" });
    expect(request.header).toEqual([
      { key: "Accept", value: "application/json" },
    ]);
  });
});

describe("treeToPostmanFiles - disabled row flag (AC-003)", () => {
  // TC-002 - behavior: a disabled header row emits with disabled:true; an enabled
  // (or enabled-absent) row omits the disabled key.
  it("should emit disabled:true for a disabled header row and omit disabled for an enabled row", () => {
    const root: PostmanExportRoot = {
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

    const request = requestOf(collectionDoc(treeToPostmanFiles(root)), "Ping");

    expect(request.header).toEqual([
      { key: "Accept", value: "application/json" },
      { key: "X-Debug", value: "1", disabled: true },
    ]);
  });
});

describe("treeToPostmanFiles - body types (AC-004)", () => {
  // TC-003 - behavior: json/form/multipart/graphql bodies each emit the matching
  // body.mode + payload; json emits the raw language hint; graphql emits
  // graphql:{query,variables}.
  it("should map each body type to the matching Postman body mode and payload", () => {
    const root: PostmanExportRoot = {
      name: "Bodies",
      config: {},
      children: [
        req({
          name: "Json Req",
          method: "POST",
          body: {
            ...emptyBody(),
            active: "json",
            types: { ...emptyBody().types, json: '{"id":1}' },
          },
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

    const doc = collectionDoc(treeToPostmanFiles(root));

    const json = requestOf(doc, "Json Req").body as Record<string, unknown>;
    expect(json.mode).toBe("raw");
    expect(json.raw).toBe('{"id":1}');
    expect(json.options).toEqual({ raw: { language: "json" } });

    const form = requestOf(doc, "Form Req").body as Record<string, unknown>;
    expect(form.mode).toBe("urlencoded");
    expect(form.urlencoded).toEqual([{ key: "a", value: "b" }]);

    const multipart = requestOf(doc, "Multipart Req").body as Record<
      string,
      unknown
    >;
    expect(multipart.mode).toBe("formdata");
    expect(multipart.formdata).toEqual([{ key: "file", value: "x" }]);

    const graphql = requestOf(doc, "Graphql Req").body as Record<
      string,
      unknown
    >;
    expect(graphql.mode).toBe("graphql");
    expect(graphql.graphql).toEqual({
      query: "query { me { id } }",
      variables: '{ "x": 1 }',
    });
  });
});

describe("treeToPostmanFiles - none body / inherit auth omit keys (AC-004, AC-005)", () => {
  // TC-004 - behavior: a request with body.active "none" and auth.active "inherit"
  // emits no body key and no auth key on the request.
  it("should emit no body key and no auth key if the body is none and the auth is inherit", () => {
    const root: PostmanExportRoot = {
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

    const request = requestOf(collectionDoc(treeToPostmanFiles(root)), "Bare");

    expect("body" in request).toBe(false);
    expect("auth" in request).toBe(false);
  });
});

describe("treeToPostmanFiles - bearer auth (AC-005)", () => {
  // TC-005 - behavior: bearer auth with token "{{tok}}" emits {type:"bearer",
  // bearer:[{key:"token", value:"{{tok}}"}]} and the token survives verbatim.
  it("should emit a bearer auth block with the {{tok}} token verbatim", () => {
    const root: PostmanExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Secured",
          config: { auth: authOf({ active: "bearer", token: "{{tok}}" }) },
        }),
      ],
    };

    const request = requestOf(collectionDoc(treeToPostmanFiles(root)), "Secured");

    expect(request.auth).toEqual({
      type: "bearer",
      bearer: [{ key: "token", value: "{{tok}}" }],
    });
  });
});

describe("treeToPostmanFiles - basic auth (AC-005)", () => {
  // TC-006 - behavior: basic auth emits {type:"basic", basic:[{key:"username",...},
  // {key:"password",...}]}.
  it("should emit a basic auth block with username and password rows", () => {
    const root: PostmanExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "BasicReq",
          config: {
            auth: authOf({ active: "basic", username: "u", password: "p" }),
          },
        }),
      ],
    };

    const request = requestOf(
      collectionDoc(treeToPostmanFiles(root)),
      "BasicReq",
    );

    expect(request.auth).toEqual({
      type: "basic",
      basic: [
        { key: "username", value: "u" },
        { key: "password", value: "p" },
      ],
    });
  });
});

describe("treeToPostmanFiles - none auth (AC-005)", () => {
  // TC-007 - behavior: an explicit auth.active "none" emits {type:"noauth"}.
  it("should emit {type:noauth} for an explicit none auth", () => {
    const root: PostmanExportRoot = {
      name: "C",
      config: {},
      children: [
        req({ name: "Open", config: { auth: authOf({ active: "none" }) } }),
      ],
    };

    const request = requestOf(collectionDoc(treeToPostmanFiles(root)), "Open");

    expect(request.auth).toEqual({ type: "noauth" });
  });
});

describe("treeToPostmanFiles - nested folder + folder config (AC-006)", () => {
  // TC-008 - behavior: a nested folder with its own variable emits a folder item
  // { name, item:[...], variable:[...] } and its request sits inside the item.
  it("should emit a folder item with a nested item array and its own variable block", () => {
    const root: PostmanExportRoot = {
      name: "C",
      config: {},
      children: [
        folder({
          name: "A",
          config: {
            variables: [{ key: "baseUrl", value: "https://api.example.com" }],
          },
          children: [
            req({ name: "Ping", method: "GET", url: "https://x.test/ping" }),
          ],
        }),
      ],
    };

    const doc = collectionDoc(treeToPostmanFiles(root));
    const folderItem = doc.item.find((i) => i.name === "A");

    expect(folderItem).toBeDefined();
    expect(folderItem?.variable).toEqual([
      { key: "baseUrl", value: "https://api.example.com" },
    ]);
    expect(folderItem?.item).toHaveLength(1);
    expect(folderItem?.item?.[0].name).toBe("Ping");
    expect(folderItem?.item?.[0].request?.method).toBe("GET");
  });
});

describe("treeToPostmanFiles - environments (AC-007)", () => {
  // TC-009 - side-effect-contract: each collection-root environment emits a
  // separate <slug>.postman_environment.json; an enabled row is enabled:true, a
  // disabled row keeps enabled:false.
  it("should emit a postman_environment.json per environment with enabled flags per row", () => {
    const root: PostmanExportRoot = {
      name: "C",
      config: {
        environments: [
          {
            name: "dev",
            variables: [
              { key: "K", value: "1" },
              { key: "S", value: "s", enabled: false },
            ],
          },
        ],
      },
      children: [],
    };

    const files = treeToPostmanFiles(root);

    expect(files["dev.postman_environment.json"]).toBeDefined();
    expect(JSON.parse(files["dev.postman_environment.json"])).toEqual({
      name: "dev",
      values: [
        { key: "K", value: "1", enabled: true },
        { key: "S", value: "s", enabled: false },
      ],
    });
  });
});

describe("treeToPostmanFiles - url query + path params (AC-008)", () => {
  // TC-010 - behavior: query params emit as url.query and path params as
  // url.variable, so both grids round-trip.
  it("should emit query params as url.query and path params as url.variable", () => {
    const root: PostmanExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Fetch",
          method: "GET",
          url: "https://x.test/items/:id",
          params: {
            query: [{ key: "page", value: "2", enabled: true }],
            path: [{ key: "id", value: "7", enabled: true }],
          },
        }),
      ],
    };

    const request = requestOf(collectionDoc(treeToPostmanFiles(root)), "Fetch");

    expect(request.url).toEqual({
      raw: "https://x.test/items/:id",
      query: [{ key: "page", value: "2" }],
      variable: [{ key: "id", value: "7" }],
    });
  });

  // AC-003 for query rows - behavior: a disabled query row emits disabled:true (the
  // same convention as headers/form/multipart), so a disabled param does not
  // resurrect as enabled on re-import.
  it("should emit disabled:true for a disabled query row", () => {
    const root: PostmanExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Fetch",
          method: "GET",
          url: "https://x.test/items",
          params: {
            query: [
              { key: "page", value: "2", enabled: true },
              { key: "dbg", value: "1", enabled: false },
            ],
            path: [],
          },
        }),
      ],
    };

    const request = requestOf(collectionDoc(treeToPostmanFiles(root)), "Fetch");

    expect(request.url).toEqual({
      raw: "https://x.test/items",
      query: [
        { key: "page", value: "2" },
        { key: "dbg", value: "1", disabled: true },
      ],
    });
  });
});

describe("treeToPostmanFiles - scripts to events (AC-009)", () => {
  // TC-011 - behavior: config.scripts.pre/post map to prerequest/test events whose
  // exec is the script text split into a line array.
  it("should map pre/post scripts to prerequest and test events with exec line arrays", () => {
    const root: PostmanExportRoot = {
      name: "C",
      config: {},
      children: [
        req({
          name: "Scripted",
          config: { scripts: { pre: "pre();", post: "post();" } },
        }),
      ],
    };

    const doc = collectionDoc(treeToPostmanFiles(root));
    const item = doc.item.find((i) => i.name === "Scripted");
    const events = item?.event as Array<{
      listen: string;
      script: { type: string; exec: string[] };
    }>;

    const pre = events.find((e) => e.listen === "prerequest");
    const post = events.find((e) => e.listen === "test");

    expect(pre?.script.type).toBe("text/javascript");
    expect(pre?.script.exec).toEqual(["pre();"]);
    expect(post?.script.type).toBe("text/javascript");
    expect(post?.script.exec).toEqual(["post();"]);
  });
});

describe("treeToPostmanFiles - round-trip via postmanToTree (AC-010)", () => {
  // Project a node to only the round-trip-preserved shape. The importer mints fresh
  // ids, and Postman folders cannot carry headers, nor can Postman requests carry
  // variables, timeoutMs, httpVersion, environmentColors or a dotenv - all dropped.
  // Path params ARE a fidelity gain (url.variable) so they are kept. Children are
  // name-sorted (same discipline as the Bruno round-trip test).
  //
  // Query grid: the app always mirrors ENABLED query rows into the url `?` string
  // (query-sync `syncUrlFromParams`), and the importer drops a `url.query` row whose
  // key already sits in `url.raw` (parse-postman `queryParamsOf`). So an enabled
  // query row round-trips via the url (compared verbatim below), and only DISABLED
  // grid rows survive as `params.query`. Projecting query to the disabled rows keeps
  // the assertion honest for the realistic (url-mirrored) fixture state.
  function project(node: TreeNode): Record<string, unknown> {
    if (node.kind === "request") {
      return {
        kind: "request",
        name: node.name,
        method: node.method,
        url: node.url,
        headers: node.config.headers ?? [],
        query: node.params.query.filter((row) => row.enabled === false),
        path: node.params.path,
        auth: node.config.auth,
        scripts: node.config.scripts,
        body: node.body,
      };
    }
    return {
      kind: "folder",
      name: node.name,
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

  // TC-012 (load-bearing) - behavior: a multi-level tree (nested folders;
  // json/form/multipart/graphql+vars bodies; headers with a disabled row; query +
  // path params; folder vars; bearer auth; pre + post scripts; one environment)
  // survives postmanToTree(treeToPostmanFiles(root), name) as a single root folder
  // whose nesting + per-request name/method/url/enabled-headers/query/path/auth/
  // scripts/body equal the originals, modulo node ids + Postman-unrepresentable
  // fields.
  it("should reconstruct the tree shape after emitting then re-importing via postmanToTree", () => {
    const root: PostmanExportRoot = {
      name: "My API",
      config: {
        environments: [{ name: "dev", variables: [{ key: "K", value: "1" }] }],
      },
      children: [
        req({
          name: "Create User",
          method: "POST",
          url: "https://api.example.com/users/:id?page=2",
          body: {
            ...emptyBody(),
            active: "json",
            types: { ...emptyBody().types, json: '{"id":1}' },
          },
          params: {
            path: [{ key: "id", value: "9", enabled: true }],
            query: [
              { key: "page", value: "2", enabled: true },
              { key: "dbg", value: "0", enabled: false },
            ],
          },
          config: {
            headers: [
              { key: "Accept", value: "application/json", enabled: true },
              { key: "X-Debug", value: "1", enabled: false },
            ],
            auth: bearer,
            scripts: { pre: "pre();", post: "post();" },
          },
        }),
        folder({
          name: "Orders",
          config: {
            variables: [{ key: "org", value: "acme" }],
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

    const rebuilt = postmanToTree(treeToPostmanFiles(root), root.name);

    expect(rebuilt).toHaveLength(1);
    const rebuiltRoot = asFolder(rebuilt[0]);
    expect(rebuiltRoot.name).toBe("My API");
    expect(rebuiltRoot.config.environments).toEqual([
      { name: "dev", variables: [{ key: "K", value: "1" }] },
    ]);
    expect(projectChildren(rebuiltRoot.children)).toEqual(
      projectChildren(root.children),
    );
  });
});
