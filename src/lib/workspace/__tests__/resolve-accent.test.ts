import { describe, it, expect } from "vitest";

import {
  accentColorFor,
  environmentNamesForScope,
  environmentOrigins,
} from "@/lib/workspace/resolve";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

const request = (id: string, name: string): RequestNode => ({
  kind: "request",
  id,
  name,
  method: "GET",
  url: "",
  body: emptyBody(),
  params: emptyParams(),
  config: {},
});

const folder = (
  id: string,
  name: string,
  children: TreeNode[],
  overrides: Partial<FolderNode> = {},
): FolderNode => ({
  kind: "folder",
  id,
  name,
  config: {},
  children,
  ...overrides,
});

describe("accentColorFor(tree, id, env) - null env (AC-007, E-1)", () => {
  // AC-007, E-1 - behavior: a null env yields no color even for a folder that has
  // colors defined.
  it("should return null if env is null even for a colored folder", () => {
    const tree: TreeNode[] = [
      folder("f-1", "Folder", [request("req-1", "Req")], {
        environmentColors: { prod: "#dc262680" },
      }),
    ];

    expect(accentColorFor(tree, "f-1", null)).toBeNull();
  });

  // AC-007, E-1 - behavior: an undefined env yields no color.
  it("should return null if env is undefined even for a colored folder", () => {
    const tree: TreeNode[] = [
      folder("f-1", "Folder", [request("req-1", "Req")], {
        environmentColors: { prod: "#dc262680" },
      }),
    ];

    expect(accentColorFor(tree, "f-1", undefined)).toBeNull();
  });
});

describe("accentColorFor(tree, id, env) - request inheritance (AC-007, E-5, E-6)", () => {
  // AC-007, E-5 - behavior: a request at workspace root has no ancestor folder, so
  // no color even with an active env.
  it("should return null for a request at workspace root with no ancestor folder", () => {
    const tree: TreeNode[] = [request("req-root", "Root Req")];

    expect(accentColorFor(tree, "req-root", "prod")).toBeNull();
  });

  // AC-007 - behavior: a request inherits its nearest ancestor folder's color for
  // the active env.
  it("should return the parent folder's env color for a request inside a colored folder", () => {
    const tree: TreeNode[] = [
      folder("f-1", "Folder", [request("req-1", "Req")], {
        environmentColors: { prod: "#dc262680" },
      }),
    ];

    expect(accentColorFor(tree, "req-1", "prod")).toBe("#dc262680");
  });

  // AC-007 - behavior: a request inherits the nearest colored ancestor when an
  // intermediate folder is uncolored (the colored grandparent wins).
  it("should return the nearest colored ancestor's env color skipping an uncolored intermediate folder", () => {
    const tree: TreeNode[] = [
      folder(
        "root",
        "Root",
        [folder("mid", "Mid", [request("req-1", "Req")])],
        { environmentColors: { prod: "#2563eb80" } },
      ),
    ];

    expect(accentColorFor(tree, "req-1", "prod")).toBe("#2563eb80");
  });

  // AC-007, E-6 - behavior: with both ancestors colored for the env, the nearest
  // wins over the colored grandparent.
  it("should let the nearest colored ancestor win over a colored grandparent for the active env", () => {
    const tree: TreeNode[] = [
      folder(
        "root",
        "Root",
        [
          folder("mid", "Mid", [request("req-1", "Req")], {
            environmentColors: { prod: "#16a34a80" },
          }),
        ],
        { environmentColors: { prod: "#dc262680" } },
      ),
    ];

    expect(accentColorFor(tree, "req-1", "prod")).toBe("#16a34a80");
  });
});

describe("accentColorFor(tree, id, env) - env keying (AC-007, E-8)", () => {
  // AC-007, E-8 - behavior: a folder colored only for prod returns null when local
  // is the active env (the color map is keyed per env).
  it("should return null for a prod-only colored folder when local is the active env", () => {
    const tree: TreeNode[] = [
      folder("f-1", "Folder", [request("req-1", "Req")], {
        environmentColors: { prod: "#dc262680" },
      }),
    ];

    expect(accentColorFor(tree, "f-1", "local")).toBeNull();
  });

  // AC-007, E-8 - behavior: the same folder, asked for the env it IS colored for,
  // returns that env's color (paired with the null case above so it isn't a
  // never-set tautology).
  it("should return the prod color for the same prod-only folder when prod is the active env", () => {
    const tree: TreeNode[] = [
      folder("f-1", "Folder", [request("req-1", "Req")], {
        environmentColors: { prod: "#dc262680" },
      }),
    ];

    expect(accentColorFor(tree, "f-1", "prod")).toBe("#dc262680");
  });

  // AC-007, E-8 - behavior: a request under a prod/local-colored folder resolves the
  // distinct color per active env.
  it("should resolve a distinct inherited color per active env for a request under a multi-env folder", () => {
    const tree: TreeNode[] = [
      folder("f-1", "Folder", [request("req-1", "Req")], {
        environmentColors: { prod: "#dc262680", local: "#16a34a80" },
      }),
    ];

    expect(accentColorFor(tree, "req-1", "prod")).toBe("#dc262680");
    expect(accentColorFor(tree, "req-1", "local")).toBe("#16a34a80");
    expect(accentColorFor(tree, "req-1", "staging")).toBeNull();
  });
});

describe("accentColorFor(tree, id, env) - folder's own color (AC-007)", () => {
  // AC-007 - behavior: a folder id resolves to the folder's own env color.
  it("should return a folder's own env color for that folder's id", () => {
    const tree: TreeNode[] = [
      folder("f-1", "Folder", [request("req-1", "Req")], {
        environmentColors: { prod: "#dc262680" },
      }),
    ];

    expect(accentColorFor(tree, "f-1", "prod")).toBe("#dc262680");
  });

  // AC-007 - behavior: an uncolored folder INHERITS its colored parent's env color
  // (uniform inheritance: a folder resolves like a request, nearest ancestor wins).
  it("should inherit a colored parent's env color for an uncolored child folder's id", () => {
    const tree: TreeNode[] = [
      folder(
        "root",
        "Root",
        [folder("child", "Child", [request("req-1", "Req")])],
        { environmentColors: { prod: "#dc262680" } },
      ),
    ];

    expect(accentColorFor(tree, "child", "prod")).toBe("#dc262680");
  });

  // AC-007 - behavior: an unknown id resolves to null (no scope path).
  it("should return null for an unknown id", () => {
    const tree: TreeNode[] = [
      folder("f-1", "Folder", [request("req-1", "Req")], {
        environmentColors: { prod: "#dc262680" },
      }),
    ];

    expect(accentColorFor(tree, "does-not-exist", "prod")).toBeNull();
  });
});

describe("environmentNamesForScope(tree, nodeId) - chain union (AC-009)", () => {
  // AC-009 - behavior: a request under nested folders sees the SORTED union of every
  // ancestor folder's environments along its chain (root -> node).
  it("should return the sorted env-name union along the chain for a request under nested folders", () => {
    const tree: TreeNode[] = [
      folder(
        "root",
        "Root",
        [
          folder(
            "mid",
            "Mid",
            [request("req-1", "Req")],
            { config: { environments: [{ name: "staging", variables: [] }] } },
          ),
        ],
        {
          config: {
            environments: [
              { name: "prod", variables: [] },
              { name: "local", variables: [] },
            ],
          },
        },
      ),
    ];

    expect(environmentNamesForScope(tree, "req-1")).toEqual([
      "local",
      "prod",
      "staging",
    ]);
  });

  // AC-009 - behavior: a folder with only its OWN envs (a sibling folder's envs are
  // off-chain) sees just its own, not the sibling's.
  it("should return only the folder's own envs and exclude a sibling folder's envs", () => {
    const tree: TreeNode[] = [
      folder("a", "A", [request("req-a", "A Req")], {
        config: {
          environments: [
            { name: "prod", variables: [] },
            { name: "local", variables: [] },
          ],
        },
      }),
      folder("b", "B", [request("req-b", "B Req")], {
        config: { environments: [{ name: "staging", variables: [] }] },
      }),
    ];

    expect(environmentNamesForScope(tree, "b")).toEqual(["staging"]);
  });

  // AC-009 - behavior: an env that the folder has COLORED but not defined in
  // config.environments still counts as in-scope (coloring an env for a folder is a
  // per-folder signal it cares about that env, so the sidebar must offer it).
  it("should include an env name the folder has colored even if it is not in config.environments", () => {
    const tree: TreeNode[] = [
      folder("f-1", "Folder", [request("req-1", "Req")], {
        config: {
          environments: [
            { name: "prod", variables: [] },
            { name: "local", variables: [] },
          ],
        },
        environmentColors: { staging: "#2563eb80" },
      }),
    ];

    expect(environmentNamesForScope(tree, "f-1")).toEqual([
      "local",
      "prod",
      "staging",
    ]);
    // a request inside inherits the same scoped union.
    expect(environmentNamesForScope(tree, "req-1")).toEqual([
      "local",
      "prod",
      "staging",
    ]);
  });

  // AC-011 - behavior: every env name in scope maps to the name of the nearest
  // ancestor folder that DEFINES it (in config.environments), walking root -> node.
  it("should map each scoped env name to the nearest defining ancestor folder name", () => {
    const tree: TreeNode[] = [
      folder(
        "asd1",
        "asd1",
        [folder("asd2", "asd2", [request("req", "Req")], {
          config: { environments: [{ name: "env-21", variables: [] }] },
        })],
        {
          config: {
            environments: [
              { name: "env-11", variables: [] },
              { name: "env-12", variables: [] },
            ],
          },
        },
      ),
    ];

    // From asd2's own id: env-21 is asd2's, env-11/env-12 come from asd1.
    expect(environmentOrigins(tree, "asd2")).toEqual({
      "env-21": "asd2",
      "env-11": "asd1",
      "env-12": "asd1",
    });
  });

  // AC-011 - behavior: when both an ancestor and the node define the same env, the
  // NEAREST (the node itself) wins as the origin.
  it("should let the nearest folder win as the origin for a shadowed env name", () => {
    const tree: TreeNode[] = [
      folder(
        "parent",
        "parent",
        [folder("child", "child", [], { config: { environments: [{ name: "env", variables: [] }] } })],
        { config: { environments: [{ name: "env", variables: [] }] } },
      ),
    ];

    expect(environmentOrigins(tree, "child").env).toBe("child");
  });

  // AC-009 - behavior: a null nodeId returns ALL tree env names (delegates to
  // listEnvironmentNames), so the combobox falls back to the whole tree.
  it("should return all tree env names if nodeId is null", () => {
    const tree: TreeNode[] = [
      folder("a", "A", [request("req-a", "A Req")], {
        config: {
          environments: [
            { name: "prod", variables: [] },
            { name: "local", variables: [] },
          ],
        },
      }),
      folder("b", "B", [request("req-b", "B Req")], {
        config: { environments: [{ name: "staging", variables: [] }] },
      }),
    ];

    expect(environmentNamesForScope(tree, null)).toEqual([
      "local",
      "prod",
      "staging",
    ]);
  });
});
