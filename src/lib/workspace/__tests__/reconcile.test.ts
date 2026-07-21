import { describe, expect, it } from "vitest";
import type { FileMap } from "@/lib/workspace/disk-format";
import {
  emptyDirsAfterRemoval,
  planReconcile,
} from "@/lib/workspace/reconcile";

describe("planReconcile write set", () => {
  // behavior - new file lands in write
  it("should include a key in write if it is new in next", () => {
    const current: FileMap = {
      "purerequest.workspace.json": '{"schemaVersion":2,"name":"W"}',
    };
    const next: FileMap = {
      "purerequest.workspace.json": '{"schemaVersion":2,"name":"W"}',
      "a.req.json": '{"name":"A"}',
    };

    const result = planReconcile(current, next);

    expect(result.write).toEqual({ "a.req.json": '{"name":"A"}' });
  });

  // behavior - changed content lands in write
  it("should include a key in write if its value differs from current", () => {
    const current: FileMap = { "a.req.json": '{"name":"A"}' };
    const next: FileMap = { "a.req.json": '{"name":"A-renamed"}' };

    const result = planReconcile(current, next);

    expect(result.write).toEqual({ "a.req.json": '{"name":"A-renamed"}' });
  });

  // behavior - unchanged content is not rewritten
  it("should not include a key in write if its value is identical to current", () => {
    const current: FileMap = {
      "a.req.json": '{"name":"A"}',
      "b.req.json": '{"name":"B"}',
    };
    const next: FileMap = {
      "a.req.json": '{"name":"A"}',
      "b.req.json": '{"name":"B-changed"}',
    };

    const result = planReconcile(current, next);

    expect(result.write).toEqual({ "b.req.json": '{"name":"B-changed"}' });
    expect(result.write["a.req.json"]).toBeUndefined();
  });
});

describe("planReconcile remove set", () => {
  // behavior - managed orphan is removed
  it("should include a managed key in remove if it exists in current but not next", () => {
    const current: FileMap = {
      "gone.req.json": '{"name":"Gone"}',
      "stay.req.json": '{"name":"Stay"}',
    };
    const next: FileMap = { "stay.req.json": '{"name":"Stay"}' };

    const result = planReconcile(current, next);

    expect(result.remove).toEqual(["gone.req.json"]);
  });

  // behavior - folder.json and manifest count as managed
  it("should include orphan folder.json and manifest keys in remove if managed", () => {
    const current: FileMap = {
      "purerequest.workspace.json": '{"schemaVersion":2}',
      "users/folder.json": '{"name":"Users"}',
    };
    const next: FileMap = {};

    const result = planReconcile(current, next);

    expect(result.remove.sort()).toEqual(
      ["purerequest.workspace.json", "users/folder.json"].sort(),
    );
  });

  // behavior - unmanaged orphan is never removed
  it("should not include an unmanaged orphan in remove", () => {
    const current: FileMap = {
      "notes.txt": "scratch",
      ".git/config": "[core]",
      "gone.req.json": '{"name":"Gone"}',
    };
    const next: FileMap = {};

    const result = planReconcile(current, next);

    expect(result.remove).toEqual(["gone.req.json"]);
    expect(result.remove).not.toContain("notes.txt");
    expect(result.remove).not.toContain(".git/config");
  });

  // behavior - a workspace-root .env is read-only input, never reconciled away
  it("should never remove a root .env even when it is absent from next", () => {
    const current: FileMap = {
      "purerequest.workspace.json": '{"schemaVersion":2}',
      ".env": "TOKEN=abc123",
      "gone.req.json": '{"name":"Gone"}',
    };
    const next: FileMap = {
      "purerequest.workspace.json": '{"schemaVersion":2}',
    };

    const result = planReconcile(current, next);

    expect(result.remove).not.toContain(".env");
    expect(result.remove).toContain("gone.req.json");
  });

  // AC-011 / behavior - a folder .env is read-only input, never reconciled away
  it("should never remove a folder .env even when it is absent from next", () => {
    const current: FileMap = {
      "purerequest.workspace.json": '{"schemaVersion":3}',
      "api/folder.json": '{"name":"Api","order":0}',
      "api/.env": "TOKEN=api",
      "api/get.req.json": '{"name":"Get","order":0}',
    };
    // An unrelated write (e.g. renaming a different folder) that doesn't re-emit
    // the folder .env must not flag it for removal.
    const next: FileMap = {
      "purerequest.workspace.json": '{"schemaVersion":3}',
      "api/folder.json": '{"name":"Api","order":0}',
      "api/get.req.json": '{"name":"Get","order":0}',
    };

    const result = planReconcile(current, next);

    expect(result.remove).not.toContain("api/.env");
  });

  // behavior - a folder .env IS removed when the whole folder is deleted, so the
  // now-empty dir can be pruned (else the orphan .env resurrects the folder on
  // reload). The folder is "gone" when no next key lives under its dir subtree.
  it("should remove a folder .env if its entire folder subtree is gone from next", () => {
    const current: FileMap = {
      "purerequest.workspace.json": '{"schemaVersion":3}',
      "bruno/folder.json": '{"name":"bruno","order":10}',
      "bruno/collections/folder.json": '{"name":"collections","order":0}',
      "bruno/collections/as24/folder.json": '{"name":"as24","order":0}',
      "bruno/collections/as24/.env": "TOKEN=secret",
    };
    const next: FileMap = {
      "purerequest.workspace.json": '{"schemaVersion":3}',
    };

    const result = planReconcile(current, next);

    expect(result.remove).toContain("bruno/collections/as24/.env");
    expect(result.remove).toContain("bruno/collections/as24/folder.json");
    expect(result.remove).toContain("bruno/folder.json");
  });

  // behavior - a folder .env survives when a DEEPER folder in its subtree still
  // exists (the parent folder is not gone).
  it("should keep a folder .env if a deeper folder in its subtree survives", () => {
    const current: FileMap = {
      "purerequest.workspace.json": '{"schemaVersion":3}',
      "api/.env": "TOKEN=api",
      "api/folder.json": '{"name":"Api","order":0}',
      "api/sub/folder.json": '{"name":"Sub","order":0}',
    };
    // The api/ folder itself lost its folder.json, but api/sub still exists, so
    // api/ still exists as an ancestor - its .env must not be reconciled away.
    const next: FileMap = {
      "purerequest.workspace.json": '{"schemaVersion":3}',
      "api/sub/folder.json": '{"name":"Sub","order":0}',
    };

    const result = planReconcile(current, next);

    expect(result.remove).not.toContain("api/.env");
  });

  // AC-006 / behavior - moved folder old paths are removed
  it("should include the old managed paths in remove if a folder moved", () => {
    const current: FileMap = {
      "purerequest.workspace.json": '{"schemaVersion":2}',
      "src/folder.json": '{"name":"Src","order":0}',
      "src/get.req.json": '{"name":"Get","order":0}',
    };
    const next: FileMap = {
      "purerequest.workspace.json": '{"schemaVersion":2}',
      "dst/src/folder.json": '{"name":"Src","order":0}',
      "dst/src/get.req.json": '{"name":"Get","order":0}',
    };

    const result = planReconcile(current, next);

    expect(result.remove.sort()).toEqual(
      ["src/folder.json", "src/get.req.json"].sort(),
    );
    expect(result.write).toEqual({
      "dst/src/folder.json": '{"name":"Src","order":0}',
      "dst/src/get.req.json": '{"name":"Get","order":0}',
    });
  });
});

describe("emptyDirsAfterRemoval", () => {
  // behavior: a dir whose only files were removed is reported, deepest-first
  it("should report a dir as empty if all its files were removed", () => {
    const next: FileMap = { "purerequest.workspace.json": "{}" };
    const removed = ["src/nested/get.req.json", "src/nested/folder.json"];

    const result = emptyDirsAfterRemoval(next, removed);

    expect(result).toEqual(["src/nested", "src"]);
  });

  // behavior: a dir that still has a surviving file is NOT reported
  it("should not report a dir as empty if a file still lives in it", () => {
    const next: FileMap = { "src/stay.req.json": "{}" };
    const removed = ["src/gone.req.json"];

    const result = emptyDirsAfterRemoval(next, removed);

    expect(result).toEqual([]);
  });

  // behavior: a surviving deeper file keeps the whole ancestor chain
  it("should keep ancestor dirs alive if a surviving file is nested deeper", () => {
    const next: FileMap = { "src/sub/stay.req.json": "{}" };
    const removed = ["src/sub/gone.req.json", "src/top.req.json"];

    const result = emptyDirsAfterRemoval(next, removed);

    expect(result).toEqual([]);
  });
});
