import { describe, it, expect } from "vitest";

import {
  parsePostmanCollection,
  parsePostmanEnvironment,
} from "@/lib/postman/parse-postman";
import { authOf } from "@/lib/workspace/model";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

const SCHEMA =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

function collectNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) =>
    node.kind === "folder" ? [node, ...collectNodes(node.children)] : [node],
  );
}

function parseRoot(
  doc: Record<string, unknown>,
  fallback = "fallback",
): FolderNode {
  const parsed = parsePostmanCollection(JSON.stringify(doc), fallback);
  if (!parsed || parsed.kind !== "folder") {
    throw new Error("expected a folder node");
  }
  return parsed;
}

function firstRequest(root: FolderNode): RequestNode {
  const request = collectNodes(root.children).find(
    (node): node is RequestNode => node.kind === "request",
  );
  if (!request) {
    throw new Error("expected a request node");
  }
  return request;
}

function parseRequest(request: Record<string, unknown>): RequestNode {
  return firstRequest(
    parseRoot({
      info: { name: "Coll", schema: SCHEMA },
      item: [{ name: "Req", request }],
    }),
  );
}

describe("parsePostmanCollection - method / url (AC-001)", () => {
  // AC-001, TC-001 - behavior: request `method` is upper-cased and `url.raw`
  // becomes the request url.
  it("should extract the upper-cased method and url from url.raw", () => {
    const request = parseRequest({
      method: "post",
      url: { raw: "https://api.example.com/users" },
    });

    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://api.example.com/users");
  });

  // AC-001 - behavior: a bare string url is taken verbatim.
  it("should take a bare string url verbatim", () => {
    const request = parseRequest({
      method: "get",
      url: "https://x.test/bare",
    });

    expect(request.method).toBe("GET");
    expect(request.url).toBe("https://x.test/bare");
  });

  // AC-001 - behavior: a non-standard method falls back to GET.
  it("should fall back to GET if the method is non-standard", () => {
    const request = parseRequest({
      method: "PROPFIND",
      url: { raw: "https://x.test" },
    });

    expect(request.method).toBe("GET");
  });

  // TC-008, AC-009 - behavior: QUERY is a known method, so it maps through (not GET).
  it("should map a QUERY method to QUERY", () => {
    const request = parseRequest({
      method: "QUERY",
      url: { raw: "https://x.test" },
    });

    expect(request.method).toBe("QUERY");
  });

  // AC-001, edge §8 - behavior: a url object without `raw` is reconstructed from
  // protocol + host (array joined with ".") + path (array joined with "/").
  it("should reconstruct the url from protocol/host/path if raw is absent", () => {
    const request = parseRequest({
      method: "get",
      url: {
        protocol: "https",
        host: ["api", "example", "com"],
        path: ["v1", "users"],
      },
    });

    expect(request.url).toBe("https://api.example.com/v1/users");
  });
});

describe("parsePostmanCollection - headers (AC-002)", () => {
  // AC-002, TC-001 - behavior: header rows map to config.headers; a
  // `disabled:true` header becomes enabled:false, others enabled:true.
  it("should map header rows with disabled:true becoming enabled:false", () => {
    const request = parseRequest({
      method: "get",
      url: { raw: "https://x.test" },
      header: [
        { key: "Accept", value: "application/json" },
        { key: "X-Debug", value: "1", disabled: true },
      ],
    });

    expect(request.config.headers).toEqual([
      { key: "Accept", value: "application/json", enabled: true },
      { key: "X-Debug", value: "1", enabled: false },
    ]);
  });
});

describe("parsePostmanCollection - body (AC-003)", () => {
  // AC-003, TC-002 - behavior: a raw body lands in the json slot verbatim with
  // the default json mode.
  it("should map a raw body to the json slot verbatim", () => {
    const raw = '{\n  "name": "John"\n}';
    const request = parseRequest({
      method: "post",
      url: { raw: "https://x.test" },
      body: { mode: "raw", raw, options: { raw: { language: "json" } } },
    });

    expect(request.body.active).toBe("json");
    expect(request.body.types.json).toBe(raw);
  });

  // AC-003, TC-002 - behavior: a urlencoded body maps to form mode with rows
  // (disabled:true -> enabled:false).
  it("should map a urlencoded body to form mode with rows", () => {
    const request = parseRequest({
      method: "post",
      url: { raw: "https://x.test" },
      body: {
        mode: "urlencoded",
        urlencoded: [
          { key: "page", value: "2" },
          { key: "size", value: "50", disabled: true },
        ],
      },
    });

    expect(request.body.active).toBe("form");
    expect(request.body.types.form).toEqual([
      { key: "page", value: "2", enabled: true },
      { key: "size", value: "50", enabled: false },
    ]);
  });

  // AC-003, TC-002 - behavior: a formdata body maps to multipart mode; a
  // type:"file" row keeps its literal value (no file src).
  it("should map a formdata body to multipart mode keeping a file row's literal value", () => {
    const request = parseRequest({
      method: "post",
      url: { raw: "https://x.test" },
      body: {
        mode: "formdata",
        formdata: [
          { key: "field", value: "value" },
          { key: "avatar", value: "/tmp/a.txt", type: "file" },
        ],
      },
    });

    expect(request.body.active).toBe("multipart");
    expect(request.body.types.multipart).toEqual([
      { key: "field", value: "value", enabled: true },
      { key: "avatar", value: "/tmp/a.txt", enabled: true },
    ]);
  });

  // AC-003, TC-002 - behavior: a graphql body maps to graphql mode with the
  // query and variables kept as their strings.
  it("should map a graphql body to graphql mode with query and variables", () => {
    const request = parseRequest({
      method: "post",
      url: { raw: "https://x.test/graphql" },
      body: {
        mode: "graphql",
        graphql: { query: "query { me { id } }", variables: '{"id":1}' },
      },
    });

    expect(request.body.active).toBe("graphql");
    expect(request.body.types.graphql.query).toBe("query { me { id } }");
    expect(request.body.types.graphql.variables).toBe('{"id":1}');
  });

  // AC-003, TC-002 - behavior: no body -> none mode.
  it("should map an absent body to none mode", () => {
    const request = parseRequest({
      method: "get",
      url: { raw: "https://x.test" },
    });

    expect(request.body.active).toBe("none");
  });

  // AC-003 - behavior: a file-mode body -> none (no file part supported).
  it("should map a file-mode body to none", () => {
    const request = parseRequest({
      method: "post",
      url: { raw: "https://x.test" },
      body: { mode: "file", file: { src: "/tmp/x" } },
    });

    expect(request.body.active).toBe("none");
  });
});

describe("parsePostmanCollection - auth (AC-004)", () => {
  // AC-004, TC-001 - behavior: a bearer auth -> {active:"bearer", token}.
  it("should map a bearer auth to a bearer auth with the token", () => {
    const request = parseRequest({
      method: "get",
      url: { raw: "https://x.test" },
      auth: { type: "bearer", bearer: [{ key: "token", value: "t" }] },
    });

    expect(request.config.auth).toEqual(
      authOf({ active: "bearer", token: "t" }),
    );
  });

  // AC-004, TC-003 - behavior: a basic auth -> {active:"basic", username, password}.
  it("should map a basic auth to a basic auth with username and password", () => {
    const request = parseRequest({
      method: "get",
      url: { raw: "https://x.test" },
      auth: {
        type: "basic",
        basic: [
          { key: "username", value: "admin" },
          { key: "password", value: "s3cret" },
        ],
      },
    });

    expect(request.config.auth).toEqual(
      authOf({ active: "basic", username: "admin", password: "s3cret" }),
    );
  });

  // AC-004, TC-003 - behavior: a noauth auth -> {active:"none"}.
  it("should map a noauth auth to type none", () => {
    const request = parseRequest({
      method: "get",
      url: { raw: "https://x.test" },
      auth: { type: "noauth" },
    });

    expect(request.config.auth).toEqual(authOf({ active: "none" }));
  });

  // AC-004, TC-003 - behavior: an unsupported auth type sets no auth (the request
  // inherits from an ancestor scope).
  it("should set no auth for an unsupported auth type", () => {
    const request = parseRequest({
      method: "get",
      url: { raw: "https://x.test" },
      auth: { type: "apikey", apikey: [{ key: "key", value: "k" }] },
    });

    expect(request.config.auth).toBeUndefined();
  });
});

describe("parsePostmanCollection - params (AC-005)", () => {
  // AC-005, TC-004 - behavior: url.query rows -> params.query (disabled kept);
  // a key already present in url.raw's ?query is dropped (the url wins).
  it("should map url.query rows dropping a key already in the url raw query", () => {
    const request = parseRequest({
      method: "get",
      url: {
        raw: "https://x.test/users?culture=de",
        query: [
          { key: "culture", value: "de" },
          { key: "page", value: "2" },
          { key: "debug", value: "1", disabled: true },
        ],
      },
    });

    expect(request.params.query).toEqual([
      { key: "page", value: "2", enabled: true },
      { key: "debug", value: "1", enabled: false },
    ]);
  });

  // AC-005, TC-004 - behavior: url.variable rows -> params.path rows.
  it("should map url.variable rows to path params", () => {
    const request = parseRequest({
      method: "get",
      url: {
        raw: "https://x.test/users/:id",
        variable: [{ key: "id", value: "42" }],
      },
    });

    expect(request.params.path).toHaveLength(1);
    expect(request.params.path[0]).toEqual(
      expect.objectContaining({ key: "id", value: "42" }),
    );
  });
});

describe("parsePostmanCollection - event scripts (AC-006)", () => {
  // AC-006, TC-005 - behavior: a prerequest event exec array joins with \n into
  // scripts.pre; a test event exec string maps verbatim to scripts.post.
  it("should map a prerequest exec array to scripts.pre and a test exec string to scripts.post", () => {
    const root = parseRoot({
      info: { name: "Coll", schema: SCHEMA },
      item: [
        {
          name: "Scripted",
          request: { method: "GET", url: { raw: "https://x.test" } },
          event: [
            {
              listen: "prerequest",
              script: { exec: ["const a = 1;", "purerequest.setVar('a', String(a));"] },
            },
            {
              listen: "test",
              script: { exec: "pm.test('ok', () => {});" },
            },
          ],
        },
      ],
    });
    const request = firstRequest(root);

    expect(request.config.scripts?.pre).toBe(
      "const a = 1;\npurerequest.setVar('a', String(a));",
    );
    expect(request.config.scripts?.post).toBe("pm.test('ok', () => {});");
  });
});

describe("parsePostmanCollection - tree + collection config (AC-008)", () => {
  // AC-008, TC-007 - behavior: an item with a nested `item` array -> a named
  // child folder; an item with `request` -> a request node; collection-level
  // variable/auth/event land on the root folder's config.
  it("should build a nested folder and put collection variable/auth/event on the root config", () => {
    const root = parseRoot({
      info: { name: "My API", schema: SCHEMA },
      variable: [{ key: "baseUrl", value: "https://api.example.com" }],
      auth: { type: "bearer", bearer: [{ key: "token", value: "t" }] },
      event: [{ listen: "prerequest", script: { exec: ["const x = 1;"] } }],
      item: [
        {
          name: "Folder A",
          item: [
            {
              name: "Get One",
              request: { method: "GET", url: { raw: "https://x.test/1" } },
            },
          ],
        },
      ],
    });

    expect(root.name).toBe("My API");
    expect(root.config.variables).toEqual([
      { key: "baseUrl", value: "https://api.example.com" },
    ]);
    expect(root.config.auth).toEqual(authOf({ active: "bearer", token: "t" }));
    expect(root.config.scripts?.pre).toBe("const x = 1;");

    const folderA = root.children.find(
      (node): node is FolderNode =>
        node.kind === "folder" && node.name === "Folder A",
    );
    expect(folderA).toBeDefined();
    const request = folderA!.children.find(
      (node): node is RequestNode => node.kind === "request",
    );
    expect(request?.name).toBe("Get One");
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("https://x.test/1");
  });

  // AC-008 - behavior: with no info.name the root falls back to the provided name.
  it("should fall back to the provided name if info has no name", () => {
    const root = parseRoot(
      {
        info: { schema: SCHEMA },
        item: [
          {
            name: "R",
            request: { method: "GET", url: { raw: "https://x.test" } },
          },
        ],
      },
      "picked-dir",
    );

    expect(root.name).toBe("picked-dir");
  });
});

describe("parsePostmanCollection - lenient parsing (AC-007)", () => {
  // AC-007, TC-006 - behavior: garbage JSON yields null without throwing.
  it("should return null for garbage JSON", () => {
    expect(parsePostmanCollection("not json {{{", "fallback")).toBeNull();
  });

  // AC-007, TC-006 - behavior: a document without info+item yields null.
  it("should return null for a document without info and item", () => {
    expect(parsePostmanCollection("{}", "fallback")).toBeNull();
  });

  // AC-007, TC-006 - behavior: an unknown top-level field is skipped and the
  // collection still parses.
  it("should parse a collection with an unknown top-level field without throwing", () => {
    const parsed = parsePostmanCollection(
      JSON.stringify({
        info: { name: "X", schema: SCHEMA },
        item: [],
        _postman_id: "abc",
        weird: { a: 1 },
      }),
      "fallback",
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("folder");
    expect(parsed?.name).toBe("X");
    expect(parsed?.children).toEqual([]);
  });
});

describe("parsePostmanEnvironment (AC-009)", () => {
  // AC-009, TC-008 - behavior: a {name, values} environment doc -> an Environment
  // with variable rows; enabled:false is kept, enabled:true/absent -> {key,value}.
  it("should map a {name, values} doc to an Environment keeping enabled:false rows", () => {
    const env = parsePostmanEnvironment(
      JSON.stringify({
        name: "Local",
        values: [
          { key: "baseUrl", value: "https://local.test", enabled: true },
          { key: "secret", value: "s", enabled: false },
        ],
      }),
    );

    expect(env?.name).toBe("Local");
    expect(env?.variables).toEqual([
      { key: "baseUrl", value: "https://local.test" },
      { key: "secret", value: "s", enabled: false },
    ]);
  });

  // AC-009 - behavior: invalid JSON yields null without throwing.
  it("should return null for invalid JSON", () => {
    expect(parsePostmanEnvironment("nope {{{")).toBeNull();
  });

  // AC-009 - behavior: a doc without name+values yields null.
  it("should return null for a doc without name and values", () => {
    expect(parsePostmanEnvironment("{}")).toBeNull();
  });
});
