import { describe, expect, it } from "vitest";
import type { FileMap } from "@/lib/workspace/disk-format";
import { deserialize, serialize } from "@/lib/workspace/disk-format";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";

// Tolerant read of the pre-restructure (schemaVersion 3) on-disk shape: a request
// carried `body` as a string/StoredBody plus sibling `bodyMode`/`bodyForm`, query
// params lived in `config.params`, and path params in a top-level `pathParams`.
// These must all map onto the new `body {active,types}` + `params {path,query}`
// model, and a legacy FOLDER `config.params` must be dropped. Each case pairs the
// migrated request with a plain sibling so a green run proves the field is read.

const expectOk = (result: ReturnType<typeof deserialize>) => {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error}`);
  }
  return result;
};

const findRequest = (
  result: ReturnType<typeof expectOk>,
  name: string,
): RequestNode => {
  const walk = (nodes: (FolderNode | RequestNode)[]): RequestNode | null => {
    for (const node of nodes) {
      if (node.kind === "request" && node.name === name) {
        return node;
      }
      if (node.kind === "folder") {
        const found = walk(node.children);
        if (found) {
          return found;
        }
      }
    }
    return null;
  };
  const node = walk(result.tree);
  if (!node) {
    throw new Error(`request ${name} not found`);
  }
  return node;
};

const findFolder = (
  result: ReturnType<typeof expectOk>,
  name: string,
): FolderNode => {
  const node = result.tree.find(
    (n): n is FolderNode => n.kind === "folder" && n.name === name,
  );
  if (!node) {
    throw new Error(`folder ${name} not found`);
  }
  return node;
};

const legacyRequest = (fields: Record<string, unknown>): string =>
  JSON.stringify({
    name: "Legacy",
    method: "POST",
    url: "https://api/users/:id",
    config: {},
    order: 0,
    ...fields,
  });

describe("disk-format legacy v3 body migration (AC-008, TC-005)", () => {
  // AC-008 - behavior: a legacy `bodyMode:"form"` + `bodyForm` lands in the form
  // slot; the multipart slot stays empty; a legacy body string fills the json slot.
  it("should map legacy form bodyMode + bodyForm into the form slot", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({
        schemaVersion: 3,
        name: "W",
      }),
      "legacy.req.json": legacyRequest({
        body: "raw",
        bodyMode: "form",
        bodyForm: [{ key: "a", value: "1", enabled: true }],
      }),
    };

    const req = findRequest(expectOk(deserialize(files)), "Legacy");

    expect(req.body.active).toBe("form");
    expect(req.body.types.form).toEqual([
      { key: "a", value: "1", enabled: true },
    ]);
    expect(req.body.types.multipart).toEqual([]);
    expect(req.body.types.json).toBe("raw");
  });

  // AC-008 - behavior: a legacy `bodyMode:"multipart"` puts the rows in the
  // multipart slot, leaving the form slot empty (the slot the legacy mode named).
  it("should map legacy multipart bodyMode + bodyForm into the multipart slot", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({
        schemaVersion: 3,
        name: "W",
      }),
      "legacy.req.json": legacyRequest({
        body: "",
        bodyMode: "multipart",
        bodyForm: [{ key: "file", value: "x" }],
      }),
    };

    const req = findRequest(expectOk(deserialize(files)), "Legacy");

    expect(req.body.active).toBe("multipart");
    expect(req.body.types.multipart).toEqual([{ key: "file", value: "x" }]);
    expect(req.body.types.form).toEqual([]);
  });

  // AC-008 - behavior: a legacy tagged json body fills the json slot as
  // stringified text, with json the active mode when no bodyMode is present.
  it("should map a legacy tagged json body into the json slot", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({
        schemaVersion: 3,
        name: "W",
      }),
      "legacy.req.json": legacyRequest({
        body: { type: "json", payload: { a: 1 } },
      }),
    };

    const req = findRequest(expectOk(deserialize(files)), "Legacy");

    expect(req.body.active).toBe("json");
    expect(JSON.parse(req.body.types.json)).toEqual({ a: 1 });
  });

  // AC-008 - behavior: an EARLY v4 doc wrote the `body.types.json` slot as the
  // retired tagged `{type,payload}` shape; the reader must decode it so those
  // transitional files still load (not stringify the wrapper itself).
  it("should decode a retired tagged json slot in an early v4 body object", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({
        schemaVersion: 4,
        name: "W",
      }),
      "legacy.req.json": legacyRequest({
        body: {
          active: "json",
          types: { json: { type: "json", payload: { asd: "qwe" } } },
        },
      }),
    };

    const req = findRequest(expectOk(deserialize(files)), "Legacy");

    expect(req.body.active).toBe("json");
    expect(JSON.parse(req.body.types.json)).toEqual({ asd: "qwe" });
  });
});

describe("disk-format legacy v3 params migration (AC-006, AC-008, TC-004/005)", () => {
  // AC-008 - behavior: a legacy request `config.params` becomes the request's own
  // `params.query`; the disabled row is preserved verbatim (encoding drops it later).
  it("should move a legacy request config.params into params.query", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({
        schemaVersion: 3,
        name: "W",
      }),
      "legacy.req.json": legacyRequest({
        body: "",
        config: {
          params: [
            { key: "page", value: "1", enabled: true },
            { key: "debug", value: "1", enabled: false },
          ],
        },
      }),
    };

    const req = findRequest(expectOk(deserialize(files)), "Legacy");

    expect(req.body.active).toBe("json");
    expect(req.params.query).toEqual([
      { key: "page", value: "1", enabled: true },
      { key: "debug", value: "1", enabled: false },
    ]);
    // The config.params key must not resurface on the migrated config.
    expect((req.config as { params?: unknown }).params).toBeUndefined();
  });

  // AC-006, AC-008 - behavior: a legacy FOLDER `config.params` is dropped entirely
  // (folders no longer carry query params); the folder's other config survives and
  // a descendant request does NOT inherit the folder's params onto its own query.
  it("should drop a legacy folder config.params and not inherit it onto a descendant", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({
        schemaVersion: 3,
        name: "W",
      }),
      "api/folder.json": JSON.stringify({
        name: "api",
        config: {
          params: [{ key: "inherited", value: "x", enabled: true }],
          headers: [{ key: "Accept", value: "application/json" }],
        },
        order: 0,
      }),
      "api/child.req.json": JSON.stringify({
        name: "Child",
        method: "GET",
        url: "https://api/child",
        body: "",
        config: {},
        order: 0,
      }),
    };

    const result = expectOk(deserialize(files));
    const folder = findFolder(result, "api");
    const child = findRequest(result, "Child");

    expect((folder.config as { params?: unknown }).params).toBeUndefined();
    expect(folder.config.headers).toEqual([
      { key: "Accept", value: "application/json" },
    ]);
    expect(child.params.query).toEqual([]);
  });

  // AC-008, TC-005 - behavior: a full v3 doc combining a string body, multipart
  // bodyMode + bodyForm, config.params, and top-level pathParams all migrate at
  // once into the new body + params shape.
  it("should migrate a full legacy v3 request document into the new shape", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({
        schemaVersion: 3,
        name: "W",
      }),
      "legacy.req.json": legacyRequest({
        body: '{\n  "raw": true\n}',
        bodyMode: "multipart",
        bodyForm: [{ key: "part", value: "v" }],
        config: { params: [{ key: "q", value: "1", enabled: true }] },
        pathParams: { id: "{{ENV_1}}" },
      }),
    };

    const req = findRequest(expectOk(deserialize(files)), "Legacy");

    expect(req.body.active).toBe("multipart");
    expect(req.body.types.multipart).toEqual([{ key: "part", value: "v" }]);
    expect(req.body.types.json).toBe('{\n  "raw": true\n}');
    expect(req.params.path).toEqual([{ key: "id", value: "{{ENV_1}}" }]);
    expect(req.params.query).toEqual([{ key: "q", value: "1", enabled: true }]);
    expect((req.config as { params?: unknown }).params).toBeUndefined();
  });
});

describe("disk-format flat config (v5)", () => {
  // behavior: config fields serialize FLAT at the doc's top level (no `config`
  // wrapper), next to name/method/url.
  it("should serialize config fields flat at the top level", () => {
    const tree: TreeNode[] = [
      {
        kind: "request",
        id: "pending",
        name: "Req",
        method: "GET",
        url: "https://api/get",
        body: emptyBody(),
        params: emptyParams(),
        config: {
          headers: [{ key: "Accept", value: "application/json" }],
          auth: authOf({ active: "bearer", token: "t" }),
        },
      },
    ];

    const map = serialize(tree);
    const reqFile = Object.entries(map).find(([path]) =>
      path.endsWith(".req.json"),
    );
    const doc = JSON.parse(reqFile![1]) as Record<string, unknown>;

    expect(doc.headers).toEqual([{ key: "Accept", value: "application/json" }]);
    expect(doc.auth).toEqual(authOf({ active: "bearer", token: "t" }));
    expect(doc.config).toBeUndefined();
  });

  // behavior: a flat-config doc round-trips back to the same in-memory config,
  // including the full auth object (both variant slots survive - the active one
  // AND the retained-but-inactive one).
  it("should round-trip a flat-config request including both auth slots", () => {
    const auth = authOf({ active: "bearer", token: "t" });
    auth.types.basic = { username: "u", password: "p" };
    const tree: TreeNode[] = [
      {
        kind: "request",
        id: "pending",
        name: "Req",
        method: "GET",
        url: "https://api/get",
        body: emptyBody(),
        params: emptyParams(),
        config: { headers: [{ key: "X", value: "1" }], timeoutMs: 5000, auth },
      },
    ];

    const req = findRequest(expectOk(deserialize(serialize(tree))), "Req");

    expect(req.config).toEqual({
      headers: [{ key: "X", value: "1" }],
      timeoutMs: 5000,
      auth,
    });
    expect(req.config.auth?.active).toBe("bearer");
    expect(req.config.auth?.types.basic).toEqual({
      username: "u",
      password: "p",
    });
  });

  // behavior: a legacy (<= v4) doc with a NESTED `config` object still loads - the
  // flat fields are absent, so readConfig falls back to the nested wrapper.
  it("should still read a legacy nested config object", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({
        schemaVersion: 4,
        name: "W",
      }),
      "legacy.req.json": legacyRequest({
        body: { active: "json", types: {} },
        config: {
          headers: [{ key: "Accept", value: "application/json" }],
          timeoutMs: 1234,
        },
      }),
    };

    const req = findRequest(expectOk(deserialize(files)), "Legacy");

    expect(req.config.headers).toEqual([
      { key: "Accept", value: "application/json" },
    ]);
    expect(req.config.timeoutMs).toBe(1234);
  });

  // behavior: a flat field WINS over a stale nested `config` for the same key (a
  // hand-mixed doc); other nested-only fields still fall through.
  it("should let a flat field win over the nested config for the same key", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({
        schemaVersion: 4,
        name: "W",
      }),
      "legacy.req.json": legacyRequest({
        body: { active: "json", types: {} },
        timeoutMs: 999,
        config: { timeoutMs: 111, variables: { a: "b" } },
      }),
    };

    const req = findRequest(expectOk(deserialize(files)), "Legacy");

    expect(req.config.timeoutMs).toBe(999);
    expect(req.config.variables).toEqual([{ key: "a", value: "b" }]);
  });
});
