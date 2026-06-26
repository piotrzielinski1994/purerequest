import { describe, it, expect } from "vitest";

// Imported even though they do not exist yet: the test must fail on the missing
// feature (the two new pure fns), not on a typo. resolveProcessEnv folds a
// request's folder chain over a root base (nearest folder wins); the provenance
// variant maps each KEY to the scope that supplied it (folder id, or null = root).
import {
  resolveProcessEnv,
  resolveProcessEnvProvenance,
} from "@/lib/workspace/resolve";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

const request = (id: string, name = id): RequestNode => ({
  kind: "request",
  id,
  name,
  method: "GET",
  url: "",
  body: "",
  config: {},
});

const folder = (
  id: string,
  children: TreeNode[],
  dotenv?: string,
): FolderNode => ({
  kind: "folder",
  id,
  name: id,
  config: {},
  children,
  ...(dotenv !== undefined ? { dotenv } : {}),
});

describe("resolveProcessEnv - folder chain folding (AC-003)", () => {
  // AC-003, TC-001 - behavior: a folder .env KEY overrides the same KEY in root.
  it("should let a folder .env value win over root if both define the key", () => {
    const tree: TreeNode[] = [
      folder("api", [request("api/get")], "TOKEN=api"),
    ];

    const env = resolveProcessEnv(tree, "api/get", { TOKEN: "root" });

    expect(env.TOKEN).toBe("api");
  });

  // AC-003, TC-002 - behavior: nearest folder wins; a key absent in the nearest
  // folder is inherited from a farther ancestor folder.
  it("should resolve the nearest folder value if an inner folder omits the key", () => {
    const inner = folder("api/v2", [request("api/v2/get")]);
    const tree: TreeNode[] = [folder("api", [inner], "TOKEN=api")];

    const env = resolveProcessEnv(tree, "api/v2/get", {});

    expect(env.TOKEN).toBe("api");
  });

  // AC-003, TC-002 - behavior: a deeper folder defining the key beats a farther one.
  it("should let the deepest folder win if the key is defined at two folder levels", () => {
    const inner = folder("api/v2", [request("api/v2/get")], "TOKEN=v2");
    const tree: TreeNode[] = [folder("api", [inner], "TOKEN=api")];

    const env = resolveProcessEnv(tree, "api/v2/get", { TOKEN: "root" });

    expect(env.TOKEN).toBe("v2");
  });

  // AC-003, edge "root-level request" - behavior: a request not inside any folder
  // resolves only the root base.
  it("should resolve only the root env if the request is at workspace root", () => {
    const tree: TreeNode[] = [request("get")];

    const env = resolveProcessEnv(tree, "get", { TOKEN: "root" });

    expect(env.TOKEN).toBe("root");
  });

  // AC-003, TC-002 - behavior: a key in one folder's .env does not leak to a
  // sibling folder's requests (and the sibling has no root fallback for it).
  it("should not leak a folder .env key to a sibling folder request", () => {
    const tree: TreeNode[] = [
      folder("api", [request("api/get")], "TOKEN=api"),
      folder("web", [request("web/get")]),
    ];

    const env = resolveProcessEnv(tree, "web/get", {});

    expect(env.TOKEN).toBeUndefined();
  });

  // AC-003, edge "folder w/o .env" - behavior: a folder without a .env contributes
  // nothing and resolution falls back to the root base.
  it("should fall back to root if a folder has no .env", () => {
    const tree: TreeNode[] = [folder("api", [request("api/get")])];

    const env = resolveProcessEnv(tree, "api/get", { TOKEN: "root" });

    expect(env.TOKEN).toBe("root");
  });

  // AC-003 - behavior: root-only keys still surface for a request deep in folders.
  it("should keep a root-only key if no folder in the chain redefines it", () => {
    const inner = folder("api/v2", [request("api/v2/get")], "EXTRA=v2");
    const tree: TreeNode[] = [folder("api", [inner], "TOKEN=api")];

    const env = resolveProcessEnv(tree, "api/v2/get", { ROOT_ONLY: "base" });

    expect(env).toMatchObject({
      ROOT_ONLY: "base",
      TOKEN: "api",
      EXTRA: "v2",
    });
  });
});

describe("resolveProcessEnvProvenance - which scope supplied each key (AC-010)", () => {
  // AC-010, TC-007 - behavior: a key supplied by a folder reports that folder's id.
  it("should report the folder id as the owner if a folder .env supplies the key", () => {
    const tree: TreeNode[] = [
      folder("api", [request("api/get")], "TOKEN=api"),
    ];

    const prov = resolveProcessEnvProvenance(tree, "api/get", { TOKEN: "root" });

    expect(prov.TOKEN).toEqual({ value: "api", scopeId: "api" });
  });

  // AC-010, edge "token-edit of nonexistent key targets root" - behavior: a key
  // supplied only by root reports scopeId null (no folder owner).
  it("should report null as the owner if only the root env supplies the key", () => {
    const tree: TreeNode[] = [folder("api", [request("api/get")])];

    const prov = resolveProcessEnvProvenance(tree, "api/get", { TOKEN: "root" });

    expect(prov.TOKEN).toEqual({ value: "root", scopeId: null });
  });

  // AC-010 - behavior: the nearest folder that defines the key is the owner.
  it("should report the nearest folder as the owner if two folders define the key", () => {
    const inner = folder("api/v2", [request("api/v2/get")], "TOKEN=v2");
    const tree: TreeNode[] = [folder("api", [inner], "TOKEN=api")];

    const prov = resolveProcessEnvProvenance(tree, "api/v2/get", {
      TOKEN: "root",
    });

    expect(prov.TOKEN).toEqual({ value: "v2", scopeId: "api/v2" });
  });
});
