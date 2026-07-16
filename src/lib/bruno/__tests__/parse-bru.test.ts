import { authOf } from "@/lib/workspace/model";
import { describe, it, expect } from "vitest";

import { parseBru } from "@/lib/bruno/parse-bru";

describe("parseBru - method / url / headers (AC-001, AC-002)", () => {
  // AC-001, TC-001 - behavior: the method block name -> upper-cased method, its
  // `url` field -> url.
  it("should extract the upper-cased method and url from the method block", () => {
    const parsed = parseBru(
      [
        "post {",
        "  url: https://api.example.com/users",
        "}",
      ].join("\n"),
    );

    expect(parsed.method).toBe("POST");
    expect(parsed.url).toBe("https://api.example.com/users");
  });

  // AC-001, TC-001 - behavior: a GET method block parses too (method from block name).
  it("should read GET from a get method block", () => {
    const parsed = parseBru("get {\n  url: https://x.test/a\n}");

    expect(parsed.method).toBe("GET");
    expect(parsed.url).toBe("https://x.test/a");
  });

  // TC-009, AC-010 - behavior: a lowercase `query` method block -> method QUERY.
  it("should read QUERY from a query method block", () => {
    const parsed = parseBru(
      ["query {", "  url: https://example.org", "}"].join("\n"),
    );

    expect(parsed.method).toBe("QUERY");
    expect(parsed.url).toBe("https://example.org");
  });

  // AC-001 - behavior: meta.name lands in `name`.
  it("should extract the name from the meta block", () => {
    const parsed = parseBru(
      [
        "meta {",
        "  name: Create User",
        "  type: http",
        "  seq: 1",
        "}",
        "get {",
        "  url: https://x.test",
        "}",
      ].join("\n"),
    );

    expect(parsed.name).toBe("Create User");
  });

  // AC-002, TC-001 - behavior: headers rows extracted; a `~`-prefixed key is a
  // disabled row, a plain key is enabled.
  it("should map a ~-prefixed header key to enabled:false and a plain key to enabled:true", () => {
    const parsed = parseBru(
      [
        "headers {",
        "  Content-Type: application/json",
        "  ~X-Debug: 1",
        "}",
      ].join("\n"),
    );

    expect(parsed.headers).toEqual([
      { key: "Content-Type", value: "application/json", enabled: true },
      { key: "X-Debug", value: "1", enabled: false },
    ]);
  });

  // AC-001/002, TC-001 - behavior: a full GET request with meta, method+url,
  // headers (one disabled) and bearer auth parses into the whole record.
  it("should parse a complete GET request with meta, headers, a disabled row and bearer auth", () => {
    const parsed = parseBru(
      [
        "meta {",
        "  name: Get Users",
        "}",
        "get {",
        "  url: https://api.example.com/users",
        "  auth: bearer",
        "}",
        "headers {",
        "  Accept: application/json",
        "  ~X-Debug: 1",
        "}",
        "auth:bearer {",
        "  token: {{token}}",
        "}",
      ].join("\n"),
    );

    expect(parsed.name).toBe("Get Users");
    expect(parsed.method).toBe("GET");
    expect(parsed.url).toBe("https://api.example.com/users");
    expect(parsed.headers).toEqual([
      { key: "Accept", value: "application/json", enabled: true },
      { key: "X-Debug", value: "1", enabled: false },
    ]);
    expect(parsed.auth).toEqual(authOf({ active: "bearer", token: "{{token}}" }));
  });
});

describe("parseBru - body (AC-003)", () => {
  // AC-003, TC-002 - behavior: a body:json block -> the json body verbatim,
  // default mode (no explicit form/multipart).
  it("should extract a body:json block as the verbatim body", () => {
    const parsed = parseBru(
      [
        "post {",
        "  url: https://x.test",
        "  body: json",
        "}",
        "body:json {",
        '  {',
        '    "name": "John"',
        '  }',
        "}",
      ].join("\n"),
    );

    expect(parsed.body).toContain('"name": "John"');
    expect(parsed.bodyMode).not.toBe("form");
    expect(parsed.bodyMode).not.toBe("multipart");
  });

  // AC-003, TC-002 - behavior (brace nesting): a JSON body with nested objects is
  // captured whole, not truncated at the first inner `}`.
  it("should capture a nested-brace JSON body in full without truncating at the first inner brace", () => {
    const parsed = parseBru(
      [
        "post {",
        "  url: https://x.test",
        "  body: json",
        "}",
        "body:json {",
        "  {",
        '    "a": { "b": { "c": 1 } },',
        '    "d": [1, 2, 3]',
        "  }",
        "}",
      ].join("\n"),
    );

    expect(parsed.body).toContain('"a": { "b": { "c": 1 } }');
    expect(parsed.body).toContain('"d": [1, 2, 3]');
  });

  // AC-003 - behavior: a bare `body` block (no subtype) defaults to json/verbatim.
  it("should treat a bare body block as the verbatim body", () => {
    const parsed = parseBru(
      [
        "post {",
        "  url: https://x.test",
        "}",
        "body {",
        "  hello",
        "}",
      ].join("\n"),
    );

    expect(parsed.body).toContain("hello");
  });

  // AC-003, TC-002 - behavior: body:form-urlencoded -> bodyMode "form" + rows.
  it("should map a body:form-urlencoded block to bodyMode form with rows", () => {
    const parsed = parseBru(
      [
        "post {",
        "  url: https://x.test",
        "  body: form-urlencoded",
        "}",
        "body:form-urlencoded {",
        "  page: 2",
        "  size: 50",
        "}",
      ].join("\n"),
    );

    expect(parsed.bodyMode).toBe("form");
    expect(parsed.bodyForm).toEqual([
      { key: "page", value: "2", enabled: true },
      { key: "size", value: "50", enabled: true },
    ]);
  });

  // AC-003, TC-002 - behavior: body:multipart-form -> bodyMode "multipart" + rows.
  it("should map a body:multipart-form block to bodyMode multipart with rows", () => {
    const parsed = parseBru(
      [
        "post {",
        "  url: https://x.test",
        "  body: multipart-form",
        "}",
        "body:multipart-form {",
        "  field: value",
        "}",
      ].join("\n"),
    );

    expect(parsed.bodyMode).toBe("multipart");
    expect(parsed.bodyForm).toEqual([
      { key: "field", value: "value", enabled: true },
    ]);
  });

  // AC-003 - behavior: no body block -> empty body string.
  it("should yield an empty body if there is no body block", () => {
    const parsed = parseBru("get {\n  url: https://x.test\n}");

    expect(parsed.body).toBe("");
  });

  // edge (spec §8) - behavior: with several body blocks and a `body:` selector,
  // the method block's declared type picks the active body.
  it("should pick the body block named by the method block's body selector", () => {
    const parsed = parseBru(
      [
        "post {",
        "  url: https://x.test",
        "  body: form-urlencoded",
        "}",
        "body:json {",
        '  { "ignored": true }',
        "}",
        "body:form-urlencoded {",
        "  k: v",
        "}",
      ].join("\n"),
    );

    expect(parsed.bodyMode).toBe("form");
    expect(parsed.bodyForm).toEqual([{ key: "k", value: "v", enabled: true }]);
  });
});

describe("parseBru - graphql body (AC-005)", () => {
  // AC-005, TC-007 - behavior: a method block `body: graphql` + a body:graphql
  // block -> bodyMode "graphql", the block content captured as the query.
  it("should map a body:graphql block to bodyMode graphql with the query captured", () => {
    const parsed = parseBru(
      [
        "post {",
        "  url: https://x.test/graphql",
        "  body: graphql",
        "}",
        "body:graphql {",
        "  query { me { id } }",
        "}",
      ].join("\n"),
    );

    expect(parsed.bodyMode).toBe("graphql");
    expect(parsed.body).toContain("query { me { id } }");
  });

  // AC-005, TC-007 (brace nesting) - behavior: a multi-line graphql query with
  // nested braces is captured whole, not truncated at the first inner `}`.
  it("should capture a nested-brace graphql query in full", () => {
    const parsed = parseBru(
      [
        "post {",
        "  url: https://x.test/graphql",
        "  body: graphql",
        "}",
        "body:graphql {",
        "  query GetUser($id: ID!) {",
        "    user(id: $id) { id name }",
        "  }",
        "}",
      ].join("\n"),
    );

    expect(parsed.bodyMode).toBe("graphql");
    expect(parsed.body).toContain("query GetUser($id: ID!)");
    expect(parsed.body).toContain("user(id: $id) { id name }");
  });

  // AC-005, TC-008 - behavior: a body:graphql block with no method-block selector
  // is still chosen (graphql no longer filtered out of the usable body blocks).
  it("should choose a body:graphql block even without a body selector", () => {
    const parsed = parseBru(
      [
        "post {",
        "  url: https://x.test/graphql",
        "}",
        "body:graphql {",
        "  query { ping }",
        "}",
      ].join("\n"),
    );

    expect(parsed.bodyMode).toBe("graphql");
    expect(parsed.body).toContain("query { ping }");
  });
});

describe("parseBru - auth (AC-004)", () => {
  // AC-004, TC-001 - behavior: auth:bearer { token } -> bearer auth.
  it("should map auth:bearer to a bearer auth with the token", () => {
    const parsed = parseBru(
      [
        "get {",
        "  url: https://x.test",
        "  auth: bearer",
        "}",
        "auth:bearer {",
        "  token: abc123",
        "}",
      ].join("\n"),
    );

    expect(parsed.auth).toEqual(authOf({ active: "bearer", token: "abc123" }));
  });

  // AC-004, TC-003 - behavior: auth:basic { username, password } -> basic auth.
  it("should map auth:basic to a basic auth with username and password", () => {
    const parsed = parseBru(
      [
        "get {",
        "  url: https://x.test",
        "  auth: basic",
        "}",
        "auth:basic {",
        "  username: admin",
        "  password: s3cret",
        "}",
      ].join("\n"),
    );

    expect(parsed.auth).toEqual(
      authOf({ active: "basic", username: "admin", password: "s3cret" }),
    );
  });

  // AC-004, TC-003 - behavior: a method block `auth: none` with no creds block
  // -> { type: "none" }.
  it("should map a method block auth: none with no creds block to type none", () => {
    const parsed = parseBru(
      [
        "get {",
        "  url: https://x.test",
        "  auth: none",
        "}",
      ].join("\n"),
    );

    expect(parsed.auth).toEqual(authOf({ active: "none" }));
  });

  // AC-004 - behavior: a method block `auth: inherit` with no creds block
  // -> { type: "inherit" }.
  it("should map a method block auth: inherit with no creds block to type inherit", () => {
    const parsed = parseBru(
      [
        "get {",
        "  url: https://x.test",
        "  auth: inherit",
        "}",
      ].join("\n"),
    );

    expect(parsed.auth).toEqual(authOf({ active: "inherit" }));
  });
});

describe("parseBru - params / vars / scripts (AC-005)", () => {
  // AC-005, TC-004 - behavior: params:query rows -> params.
  it("should map a params:query block to params rows", () => {
    const parsed = parseBru(
      [
        "get {",
        "  url: https://x.test",
        "}",
        "params:query {",
        "  page: 2",
        "}",
      ].join("\n"),
    );

    expect(parsed.params).toEqual([{ key: "page", value: "2", enabled: true }]);
  });

  // AC-005, TC-004 - behavior: vars:pre-request -> variables map.
  it("should map a vars:pre-request block to the variables record", () => {
    const parsed = parseBru(
      [
        "get {",
        "  url: https://x.test",
        "}",
        "vars:pre-request {",
        "  baseUrl: https://api.example.com",
        "}",
      ].join("\n"),
    );

    expect(parsed.variables).toEqual({ baseUrl: "https://api.example.com" });
  });

  // AC-005 - behavior: a bare `vars` block is the same as vars:pre-request.
  it("should map a bare vars block to the variables record", () => {
    const parsed = parseBru(
      [
        "get {",
        "  url: https://x.test",
        "}",
        "vars {",
        "  token: t",
        "}",
      ].join("\n"),
    );

    expect(parsed.variables).toEqual({ token: "t" });
  });

  // AC-005, TC-004 - behavior: script:pre-request -> scripts.pre,
  // script:post-response -> scripts.post.
  it("should map script:pre-request to scripts.pre and script:post-response to scripts.post", () => {
    const parsed = parseBru(
      [
        "get {",
        "  url: https://x.test",
        "}",
        "script:pre-request {",
        '  console.log("hi");',
        "}",
        "script:post-response {",
        '  requi.setVar("t", res.getJson().token);',
        "}",
      ].join("\n"),
    );

    expect(parsed.scripts?.pre).toContain('console.log("hi");');
    expect(parsed.scripts?.post).toContain(
      'requi.setVar("t", res.getJson().token);',
    );
  });
});

describe("parseBru - lenient parsing (AC-006)", () => {
  // AC-006, TC-005 - behavior: tests / docs / assert blocks are skipped (never
  // fatal) and the rest of the request still parses. body:graphql is NO LONGER
  // skipped (see AC-005) - it is now captured as the graphql query.
  it("should skip tests, docs and assert blocks but now capture a body:graphql block", () => {
    const parsed = parseBru(
      [
        "meta {",
        "  name: Lenient",
        "}",
        "get {",
        "  url: https://x.test",
        "}",
        "tests {",
        '  expect(res.status).to.equal(200);',
        "}",
        "assert {",
        "  res.status: eq 200",
        "}",
        "docs {",
        "  Some docs prose.",
        "}",
        "body:graphql {",
        "  query { me { id } }",
        "}",
      ].join("\n"),
    );

    expect(parsed.name).toBe("Lenient");
    expect(parsed.method).toBe("GET");
    expect(parsed.url).toBe("https://x.test");
    // body:graphql is now parsed, not dropped: the block content becomes the body
    // (the query) and the mode is graphql.
    expect(parsed.bodyMode).toBe("graphql");
    expect(parsed.body).toContain("query { me { id } }");
  });

  // AC-006, TC-005 - behavior: a garbage string returns a best-effort record
  // (empty collections) without throwing.
  it("should return a best-effort record for a garbage string without throwing", () => {
    const parsed = parseBru("}}}} not a bru file ((((");

    expect(parsed.headers).toEqual([]);
    expect(parsed.params).toEqual([]);
    expect(parsed.bodyForm).toEqual([]);
    expect(parsed.variables).toEqual({});
    expect(parsed.environments).toEqual({});
    expect(parsed.body).toBe("");
  });

  // AC-006 - behavior: empty input returns a best-effort record without throwing.
  it("should return a best-effort record for empty input without throwing", () => {
    const parsed = parseBru("");

    expect(parsed.headers).toEqual([]);
    expect(parsed.params).toEqual([]);
    expect(parsed.bodyForm).toEqual([]);
    expect(parsed.variables).toEqual({});
    expect(parsed.environments).toEqual({});
    expect(parsed.body).toBe("");
  });
});
