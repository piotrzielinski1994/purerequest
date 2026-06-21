import { describe, it, expect } from "vitest";

import { resolveConfig } from "@/lib/workspace/resolve";
import type {
  Auth,
  FolderNode,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";

const request = (
  id: string,
  name: string,
  config: RequestNode["config"],
): RequestNode => ({
  kind: "request",
  id,
  name,
  method: "GET",
  url: "",
  body: "",
  config,
});

const folder = (
  id: string,
  name: string,
  config: FolderNode["config"],
  children: TreeNode[],
): FolderNode => ({ kind: "folder", id, name, config, children });

describe("resolveConfig - variables", () => {
  // AC-001, AC-005, TC-001 - behavior
  it("should resolve a request at root over defaults if it has no parent folder", () => {
    const req = request("req-root", "Root Req", {
      variables: { token: "abc" },
    });

    const effective = resolveConfig([req], "req-root");

    expect(effective.variables.token.value).toBe("abc");
    expect(effective.variables.token.from).toEqual({
      scopeId: "req-root",
      scopeName: "Root Req",
    });
  });

  // AC-001, AC-002, AC-005, TC-001 - behavior
  it("should let a child variable replace a same-key parent variable", () => {
    const req = request("req-1", "Req", { variables: { baseUrl: "stg" } });
    const sub = folder("sub", "Sub", {}, [req]);
    const root = folder("root", "Root", { variables: { baseUrl: "prod" } }, [
      sub,
    ]);

    const effective = resolveConfig([root], "req-1");

    expect(effective.variables.baseUrl.value).toBe("stg");
    expect(effective.variables.baseUrl.from).toEqual({
      scopeId: "req-1",
      scopeName: "Req",
    });
  });

  // AC-002, AC-005, TC-001 - behavior
  it("should inherit a non-conflicting parent variable with parent provenance", () => {
    const req = request("req-1", "Req", { variables: { baseUrl: "stg" } });
    const root = folder(
      "root",
      "Root",
      { variables: { baseUrl: "prod", apiKey: "k1" } },
      [req],
    );

    const effective = resolveConfig([root], "req-1");

    expect(effective.variables.apiKey.value).toBe("k1");
    expect(effective.variables.apiKey.from).toEqual({
      scopeId: "root",
      scopeName: "Root",
    });
  });

  // AC-006, E-2, TC-001 - behavior
  it("should let the deepest scope win if a variable conflicts at three levels", () => {
    const req = request("req-deep", "Deep", { variables: { env: "request" } });
    const subsub = folder(
      "subsub",
      "SubSub",
      { variables: { env: "subsub" } },
      [req],
    );
    const sub = folder("sub", "Sub", { variables: { env: "sub" } }, [subsub]);
    const root = folder("root", "Root", { variables: { env: "root" } }, [sub]);

    const effective = resolveConfig([root], "req-deep");

    expect(effective.variables.env.value).toBe("request");
    expect(effective.variables.env.from).toEqual({
      scopeId: "req-deep",
      scopeName: "Deep",
    });
  });

  // AC-006 - behavior
  it("should carry the right provenance for each variable if overrides sit at multiple levels", () => {
    const req = request("req-deep", "Deep", { variables: { c: "fromReq" } });
    const subsub = folder(
      "subsub",
      "SubSub",
      { variables: { b: "fromSubSub" } },
      [req],
    );
    const sub = folder("sub", "Sub", { variables: { a: "fromSub" } }, [subsub]);
    const root = folder("root", "Root", { variables: { root: "fromRoot" } }, [
      sub,
    ]);

    const effective = resolveConfig([root], "req-deep");

    expect(effective.variables.root.from.scopeId).toBe("root");
    expect(effective.variables.a.from.scopeId).toBe("sub");
    expect(effective.variables.b.from.scopeId).toBe("subsub");
    expect(effective.variables.c.from.scopeId).toBe("req-deep");
  });
});

describe("resolveConfig - headers", () => {
  // AC-002, E-5 - behavior
  it("should merge headers by case-insensitive name and let the deepest win", () => {
    const req = request("req-1", "Req", {
      headers: [{ key: "accept", value: "application/xml" }],
    });
    const root = folder(
      "root",
      "Root",
      { headers: [{ key: "Accept", value: "application/json" }] },
      [req],
    );

    const effective = resolveConfig([root], "req-1");

    const matching = Object.keys(effective.headers).filter(
      (name) => name.toLowerCase() === "accept",
    );
    expect(matching).toHaveLength(1);
    expect(effective.headers[matching[0]].value).toBe("application/xml");
    expect(effective.headers[matching[0]].from.scopeId).toBe("req-1");
  });

  // E-5 - behavior
  it("should keep the casing of the winning header if a parent used different casing", () => {
    const req = request("req-1", "Req", {
      headers: [{ key: "X-Trace-Id", value: "child" }],
    });
    const root = folder(
      "root",
      "Root",
      { headers: [{ key: "x-trace-id", value: "parent" }] },
      [req],
    );

    const effective = resolveConfig([root], "req-1");

    expect(Object.keys(effective.headers)).toContain("X-Trace-Id");
    expect(Object.keys(effective.headers)).not.toContain("x-trace-id");
  });

  // AC-002 - behavior
  it("should keep a non-conflicting parent header with parent provenance", () => {
    const req = request("req-1", "Req", {
      headers: [{ key: "Accept", value: "json" }],
    });
    const root = folder(
      "root",
      "Root",
      { headers: [{ key: "Authorization", value: "secret" }] },
      [req],
    );

    const effective = resolveConfig([root], "req-1");

    expect(effective.headers.Authorization.value).toBe("secret");
    expect(effective.headers.Authorization.from.scopeId).toBe("root");
  });

  // config-grid - behavior: a header with enabled:false is excluded.
  it("should exclude a header explicitly disabled (enabled:false)", () => {
    const req = request("req-1", "Req", {
      headers: [
        { key: "Accept", value: "json" },
        { key: "X-Debug", value: "1", enabled: false },
      ],
    });

    const effective = resolveConfig([req], "req-1");

    expect(effective.headers.Accept).toBeDefined();
    expect(effective.headers["X-Debug"]).toBeUndefined();
  });

  // config-grid - behavior: enabled:true (or absent) is kept.
  it("should keep a header that is enabled:true or has no enabled flag", () => {
    const req = request("req-1", "Req", {
      headers: [
        { key: "Accept", value: "json" },
        { key: "X-On", value: "1", enabled: true },
      ],
    });

    const effective = resolveConfig([req], "req-1");

    expect(effective.headers.Accept).toBeDefined();
    expect(effective.headers["X-On"]).toBeDefined();
  });
});

describe("resolveConfig - params", () => {
  // AC-002 - behavior
  it("should let a child param replace a same-key parent param", () => {
    const req = request("req-1", "Req", {
      params: [{ key: "page", value: "2" }],
    });
    const root = folder(
      "root",
      "Root",
      { params: [{ key: "page", value: "1" }] },
      [req],
    );

    const effective = resolveConfig([root], "req-1");

    expect(effective.params.page.value).toBe("2");
    expect(effective.params.page.from.scopeId).toBe("req-1");
  });

  // AC-002 - behavior
  it("should treat param keys case-sensitively keeping differing-case keys separate", () => {
    const req = request("req-1", "Req", {
      params: [{ key: "Page", value: "child" }],
    });
    const root = folder(
      "root",
      "Root",
      { params: [{ key: "page", value: "parent" }] },
      [req],
    );

    const effective = resolveConfig([root], "req-1");

    expect(effective.params.page.value).toBe("parent");
    expect(effective.params.page.from.scopeId).toBe("root");
    expect(effective.params.Page.value).toBe("child");
    expect(effective.params.Page.from.scopeId).toBe("req-1");
  });

  // config-grid - behavior: a param with enabled:false is excluded.
  it("should exclude a param explicitly disabled (enabled:false)", () => {
    const req = request("req-1", "Req", {
      params: [
        { key: "page", value: "1" },
        { key: "debug", value: "1", enabled: false },
      ],
    });

    const effective = resolveConfig([req], "req-1");

    expect(effective.params.page).toBeDefined();
    expect(effective.params.debug).toBeUndefined();
  });
});

describe("resolveConfig - auth", () => {
  // AC-003, E-3, TC-002 - behavior
  it("should inherit the folder auth if the request auth is inherit", () => {
    const folderAuth: Auth = { type: "bearer", token: "T" };
    const req = request("req-1", "Req", { auth: { type: "inherit" } });
    const root = folder("root", "Root", { auth: folderAuth }, [req]);

    const effective = resolveConfig([root], "req-1");

    expect(effective.auth.value).toEqual(folderAuth);
    expect(effective.auth.from.scopeId).toBe("root");
  });

  // AC-003, E-4 - behavior
  it("should resolve auth to none with default provenance if no scope sets it", () => {
    const req = request("req-1", "Req", {});
    const root = folder("root", "Root", {}, [req]);

    const effective = resolveConfig([root], "req-1");

    expect(effective.auth.value).toEqual({ type: "none" });
    expect(effective.auth.from.scopeId).toBe("default");
  });

  // AC-003, TC-002 - behavior
  it("should let a request none override an ancestor bearer", () => {
    const req = request("req-1", "Req", { auth: { type: "none" } });
    const root = folder(
      "root",
      "Root",
      { auth: { type: "bearer", token: "T" } },
      [req],
    );

    const effective = resolveConfig([root], "req-1");

    expect(effective.auth.value).toEqual({ type: "none" });
    expect(effective.auth.from.scopeId).toBe("req-1");
  });

  // AC-003 - behavior
  it("should pick the nearest non-inherit ancestor if an intermediate folder inherits", () => {
    const req = request("req-1", "Req", { auth: { type: "inherit" } });
    const sub = folder("sub", "Sub", { auth: { type: "inherit" } }, [req]);
    const root = folder(
      "root",
      "Root",
      { auth: { type: "basic", username: "u", password: "p" } },
      [sub],
    );

    const effective = resolveConfig([root], "req-1");

    expect(effective.auth.value).toEqual({
      type: "basic",
      username: "u",
      password: "p",
    });
    expect(effective.auth.from.scopeId).toBe("root");
  });

  // AC-003 - behavior
  it("should resolve auth whole-object and not field-merge across scopes", () => {
    const req = request("req-1", "Req", {
      auth: { type: "bearer", token: "child" },
    });
    const root = folder(
      "root",
      "Root",
      { auth: { type: "basic", username: "u", password: "p" } },
      [req],
    );

    const effective = resolveConfig([root], "req-1");

    expect(effective.auth.value).toEqual({ type: "bearer", token: "child" });
  });
});

describe("resolveConfig - scripts and timeout", () => {
  // AC-004, TC-003 - behavior
  it("should resolve pre and post scripts independently from their nearest setters", () => {
    const req = request("req-1", "Req", { scripts: { post: "postBody" } });
    const root = folder("root", "Root", { scripts: { pre: "preBody" } }, [req]);

    const effective = resolveConfig([root], "req-1");

    expect(effective.scripts.pre.value).toBe("preBody");
    expect(effective.scripts.pre.from.scopeId).toBe("root");
    expect(effective.scripts.post.value).toBe("postBody");
    expect(effective.scripts.post.from.scopeId).toBe("req-1");
  });

  // AC-004 - behavior
  it("should treat an empty-string script as a defined override of an ancestor", () => {
    const req = request("req-1", "Req", { scripts: { pre: "" } });
    const root = folder("root", "Root", { scripts: { pre: "ancestor" } }, [
      req,
    ]);

    const effective = resolveConfig([root], "req-1");

    expect(effective.scripts.pre.value).toBe("");
    expect(effective.scripts.pre.from.scopeId).toBe("req-1");
  });

  // AC-004, E-4 - behavior
  it("should resolve timeoutMs with default provenance if no scope sets it", () => {
    const req = request("req-1", "Req", {});
    const root = folder("root", "Root", {}, [req]);

    const effective = resolveConfig([root], "req-1");

    expect(effective.timeoutMs.from.scopeId).toBe("default");
    expect(typeof effective.timeoutMs.value).toBe("number");
  });

  // AC-004, TC-003 - behavior
  it("should resolve timeoutMs to the nearest setter with its value and provenance", () => {
    const req = request("req-1", "Req", {});
    const sub = folder("sub", "Sub", { timeoutMs: 5000 }, [req]);
    const root = folder("root", "Root", { timeoutMs: 1000 }, [sub]);

    const effective = resolveConfig([root], "req-1");

    expect(effective.timeoutMs.value).toBe(5000);
    expect(effective.timeoutMs.from.scopeId).toBe("sub");
  });
});
