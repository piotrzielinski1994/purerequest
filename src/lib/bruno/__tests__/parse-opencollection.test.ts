import { describe, it, expect } from "vitest";

import { parseOpenCollection } from "@/lib/bruno/parse-opencollection";

describe("parseOpenCollection - info / http (AC-011)", () => {
  // AC-011 - behavior: info.name -> name; http.method/url -> upper method + url.
  it("should extract the name, upper-cased method and url", () => {
    const parsed = parseOpenCollection(
      [
        "info:",
        "  name: Create User",
        "  type: http",
        "  seq: 1",
        "http:",
        "  method: post",
        "  url: https://api.example.com/users",
      ].join("\n"),
    );

    expect(parsed.name).toBe("Create User");
    expect(parsed.method).toBe("POST");
    expect(parsed.url).toBe("https://api.example.com/users");
  });

  // AC-011 - behavior: http.headers list -> rows; disabled:true -> enabled:false.
  it("should map http.headers to rows with disabled:true becoming enabled:false", () => {
    const parsed = parseOpenCollection(
      [
        "info:",
        "  name: H",
        "http:",
        "  method: get",
        "  url: https://x.test",
        "  headers:",
        "    - name: Accept",
        "      value: application/json",
        "    - name: X-Testmode",
        '      value: "true"',
        "      disabled: true",
      ].join("\n"),
    );

    expect(parsed.headers).toEqual([
      { key: "Accept", value: "application/json", enabled: true },
      { key: "X-Testmode", value: "true", enabled: false },
    ]);
  });

  // Bruno mirrors query params in BOTH the url and the params block; importing
  // both would duplicate (?culture=x&culture=x). A param already present in the
  // url's query string is dropped from params (the url query wins).
  it("should drop a param already present in the url query string", () => {
    const parsed = parseOpenCollection(
      [
        "info:",
        "  name: Ref",
        "http:",
        "  method: get",
        '  url: "{{LTS_URL}}/references?culture={{CULTURE}}"',
        "  params:",
        "    - name: culture",
        '      value: "{{CULTURE}}"',
        "      type: query",
      ].join("\n"),
    );

    expect(parsed.params).toEqual([]);
  });

  // A param NOT in the url query string is kept.
  it("should keep a query param that is not already in the url", () => {
    const parsed = parseOpenCollection(
      [
        "info:",
        "  name: Ref",
        "http:",
        "  method: get",
        '  url: "https://x.test/references?culture=de"',
        "  params:",
        "    - name: page",
        '      value: "2"',
        "      type: query",
      ].join("\n"),
    );

    expect(parsed.params).toEqual([{ key: "page", value: "2", enabled: true }]);
  });

  // AC-011 - behavior: http.params with type query -> params rows; type path skipped.
  it("should map query params and skip path params", () => {
    const parsed = parseOpenCollection(
      [
        "info:",
        "  name: P",
        "http:",
        "  method: get",
        "  url: https://x.test/{id}",
        "  params:",
        "    - name: page",
        '      value: "2"',
        "      type: query",
        "    - name: id",
        '      value: "{id}"',
        "      type: path",
      ].join("\n"),
    );

    expect(parsed.params).toEqual([{ key: "page", value: "2", enabled: true }]);
  });
});

describe("parseOpenCollection - body (AC-011)", () => {
  // AC-011 - behavior: body {type:json, data} -> verbatim body, default mode.
  it("should extract a json body verbatim", () => {
    const parsed = parseOpenCollection(
      [
        "info:",
        "  name: B",
        "http:",
        "  method: post",
        "  url: https://x.test",
        "  body:",
        "    type: json",
        "    data: |-",
        "      {",
        '        "name": "John",',
        '        "nested": { "a": 1 }',
        "      }",
      ].join("\n"),
    );

    expect(parsed.body).toContain('"name": "John"');
    expect(parsed.body).toContain('"nested": { "a": 1 }');
    expect(parsed.bodyMode).not.toBe("form");
    expect(parsed.bodyMode).not.toBe("multipart");
  });

  // AC-011 - behavior: body {type:form-urlencoded, data:[{name,value}]} -> form mode + rows.
  it("should map a form-urlencoded body to form mode with rows", () => {
    const parsed = parseOpenCollection(
      [
        "info:",
        "  name: F",
        "http:",
        "  method: post",
        "  url: https://x.test",
        "  body:",
        "    type: form-urlencoded",
        "    data:",
        "      - name: grant_type",
        "        value: client_credentials",
        "      - name: scope",
        '        value: "{{scope}}"',
        "        disabled: true",
      ].join("\n"),
    );

    expect(parsed.bodyMode).toBe("form");
    expect(parsed.bodyForm).toEqual([
      { key: "grant_type", value: "client_credentials", enabled: true },
      { key: "scope", value: "{{scope}}", enabled: false },
    ]);
  });

  // AC-011 - behavior: a text body -> verbatim body string.
  it("should extract a text body verbatim", () => {
    const parsed = parseOpenCollection(
      [
        "info:",
        "  name: T",
        "http:",
        "  method: post",
        "  url: https://x.test",
        "  body:",
        "    type: text",
        "    data: hello world",
      ].join("\n"),
    );

    expect(parsed.body).toContain("hello world");
  });
});

describe("parseOpenCollection - auth (AC-011)", () => {
  // AC-011 - behavior: auth string "inherit" -> {type:"inherit"}.
  it("should map a string auth of inherit to type inherit", () => {
    const parsed = parseOpenCollection(
      ["info:", "  name: A", "http:", "  method: get", "  url: https://x.test", "  auth: inherit"].join(
        "\n",
      ),
    );

    expect(parsed.auth).toEqual({ type: "inherit" });
  });

  // AC-011 - behavior: auth string "none" -> {type:"none"}.
  it("should map a string auth of none to type none", () => {
    const parsed = parseOpenCollection(
      ["info:", "  name: A", "http:", "  method: get", "  url: https://x.test", "  auth: none"].join(
        "\n",
      ),
    );

    expect(parsed.auth).toEqual({ type: "none" });
  });

  // AC-011 - behavior: auth object {type:bearer, token} -> bearer auth.
  it("should map an auth object of bearer to a bearer auth", () => {
    const parsed = parseOpenCollection(
      [
        "info:",
        "  name: A",
        "http:",
        "  method: get",
        "  url: https://x.test",
        "  auth:",
        "    type: bearer",
        '    token: "{{BEARER_TOKEN}}"',
      ].join("\n"),
    );

    expect(parsed.auth).toEqual({ type: "bearer", token: "{{BEARER_TOKEN}}" });
  });

  // AC-011 - behavior: auth object {type:basic, username, password} -> basic auth.
  it("should map an auth object of basic to a basic auth", () => {
    const parsed = parseOpenCollection(
      [
        "info:",
        "  name: A",
        "http:",
        "  method: get",
        "  url: https://x.test",
        "  auth:",
        "    type: basic",
        '    username: "{{CLIENT_ID}}"',
        '    password: "{{CLIENT_SECRET}}"',
      ].join("\n"),
    );

    expect(parsed.auth).toEqual({
      type: "basic",
      username: "{{CLIENT_ID}}",
      password: "{{CLIENT_SECRET}}",
    });
  });
});

describe("parseOpenCollection - variables / scripts (AC-011)", () => {
  // AC-011 - behavior: request.variables (folder/collection file) -> variables record.
  it("should map request.variables to the variables record", () => {
    const parsed = parseOpenCollection(
      [
        "info:",
        "  name: lts",
        "  type: folder",
        "request:",
        "  variables:",
        "    - name: LTS_URL",
        "      value: https://localized-taxonomy.api.autoscout24.com",
        "    - name: MAKE_ID",
        '      value: "9"',
      ].join("\n"),
    );

    expect(parsed.variables).toEqual({
      LTS_URL: "https://localized-taxonomy.api.autoscout24.com",
      MAKE_ID: "9",
    });
  });

  // AC-011 - behavior: runtime/request scripts before-request -> pre, after-response -> post.
  it("should map before-request to scripts.pre and after-response to scripts.post", () => {
    const parsed = parseOpenCollection(
      [
        "info:",
        "  name: S",
        "http:",
        "  method: get",
        "  url: https://x.test",
        "runtime:",
        "  scripts:",
        "    - type: before-request",
        "      code: |-",
        '        bru.setVar("x", 1);',
        "    - type: after-response",
        "      code: |-",
        '        bru.setVar("y", 2);',
      ].join("\n"),
    );

    expect(parsed.scripts?.pre).toContain('bru.setVar("x", 1);');
    expect(parsed.scripts?.post).toContain('bru.setVar("y", 2);');
  });
});

describe("parseOpenCollection - lenient (AC-011)", () => {
  // AC-011 - behavior: invalid YAML returns a best-effort record without throwing.
  it("should return a best-effort record for invalid YAML without throwing", () => {
    const parsed = parseOpenCollection("\t : : not\nyaml: [unclosed");

    expect(parsed.headers).toEqual([]);
    expect(parsed.params).toEqual([]);
    expect(parsed.bodyForm).toEqual([]);
    expect(parsed.variables).toEqual({});
    expect(parsed.environments).toEqual({});
    expect(parsed.body).toBe("");
  });

  // AC-011 - behavior: empty input returns a best-effort record without throwing.
  it("should return a best-effort record for empty input without throwing", () => {
    const parsed = parseOpenCollection("");

    expect(parsed.headers).toEqual([]);
    expect(parsed.body).toBe("");
  });
});
