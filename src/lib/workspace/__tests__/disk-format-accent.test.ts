import { describe, it, expect } from "vitest";

import { serialize, deserialize } from "@/lib/workspace/disk-format";
import type { FileMap } from "@/lib/workspace/disk-format";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

const request = (name: string): RequestNode => ({
  kind: "request",
  id: `pending-${name}`,
  name,
  method: "GET",
  url: `https://example.test/${name}`,
  body: emptyBody(),
  params: emptyParams(),
  config: {},
});

const folder = (
  name: string,
  children: TreeNode[],
  overrides: Partial<FolderNode> = {},
): FolderNode => ({
  kind: "folder",
  id: `pending-${name}`,
  name,
  config: {},
  children,
  ...overrides,
});

const expectOk = (result: ReturnType<typeof deserialize>) => {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error}`);
  }
  return result;
};

const loadedFolder = (
  result: ReturnType<typeof expectOk>,
  name: string,
): FolderNode => {
  const node = result.tree.find(
    (n): n is FolderNode => n.kind === "folder" && n.name === name,
  );
  if (!node) {
    throw new Error(`folder ${name} not found in deserialized tree`);
  }
  return node;
};

const folderJson = (map: FileMap): Record<string, unknown> => {
  const entry = Object.entries(map).find(([path]) =>
    path.endsWith("/folder.json"),
  );
  if (!entry) {
    throw new Error("no folder.json emitted");
  }
  return JSON.parse(entry[1]) as Record<string, unknown>;
};

describe("disk-format folder environmentColors round-trip (AC-003, TC-004)", () => {
  // AC-003, E-7, TC-004 - behavior: a folder's environmentColors map survives
  // serialize/deserialize for every entry.
  it("should round-trip a folder's environmentColors map through serialize then deserialize", () => {
    const tree: TreeNode[] = [
      folder("Api", [request("Get")], {
        environmentColors: { prod: "#dc262680", local: "#16a34a80" },
      }),
    ];

    const result = expectOk(deserialize(serialize(tree)));

    expect(loadedFolder(result, "Api").environmentColors).toEqual({
      prod: "#dc262680",
      local: "#16a34a80",
    });
  });

  // AC-003, E-4 - behavior: a 6-digit #rrggbb env color round-trips intact.
  it("should round-trip a 6-digit #rrggbb env color", () => {
    const tree: TreeNode[] = [
      folder("Api", [request("Get")], {
        environmentColors: { prod: "#2563eb" },
      }),
    ];

    const result = expectOk(deserialize(serialize(tree)));

    expect(loadedFolder(result, "Api").environmentColors).toEqual({
      prod: "#2563eb",
    });
  });
});

describe("disk-format env color emit-only-when-non-empty (AC-003, E-7)", () => {
  // AC-003, TC-004, E-7 - side-effect-contract: serialize folds an env color into a
  // synthesized `environments` entry (no separate environmentColors field on disk).
  it("should fold an env color into an environments entry on disk if the folder has at least one", () => {
    const tree: TreeNode[] = [
      folder("Api", [request("Get")], {
        environmentColors: { prod: "#16a34a80" },
      }),
    ];

    const doc = folderJson(serialize(tree));
    expect(doc.environmentColors).toBeUndefined();
    expect(doc.environments).toEqual([
      { name: "prod", color: "#16a34a80", variables: [] },
    ]);
  });

  // AC-003, E-7 - side-effect-contract: an empty color map emits NO environments
  // (paired below with a non-empty sibling that DOES, so a green run proves the
  // empty case is the only one omitted, not that colors are never written).
  it("should emit no environments on disk if the color map is empty", () => {
    const tree: TreeNode[] = [
      folder("Empty", [request("a")], { environmentColors: {} }),
      folder("Filled", [request("b")], {
        environmentColors: { prod: "#dc262680" },
      }),
    ];

    const map = serialize(tree);
    const emptyEntry = Object.entries(map).find(
      ([path]) => path.startsWith("empty/") && path.endsWith("/folder.json"),
    );
    const filledEntry = Object.entries(map).find(
      ([path]) => path.startsWith("filled/") && path.endsWith("/folder.json"),
    );

    expect(JSON.parse(emptyEntry![1])).not.toHaveProperty("environments");
    expect(JSON.parse(emptyEntry![1])).not.toHaveProperty("environmentColors");
    expect(JSON.parse(filledEntry![1]).environments).toEqual([
      { name: "prod", color: "#dc262680", variables: [] },
    ]);
  });

  // AC-003, E-7 - side-effect-contract: a folder with no color at all emits no
  // environments; a colored sibling carries the folded entry (paired, non-tautological).
  it("should fold the color only into the colored folder's folder.json", () => {
    const tree: TreeNode[] = [
      folder("Colored", [request("a")], {
        environmentColors: { prod: "#dc262680" },
      }),
      folder("Plain", [request("b")]),
    ];

    const map = serialize(tree);
    const coloredEntry = Object.entries(map).find(([path]) =>
      path.startsWith("colored/"),
    );
    const plainEntry = Object.entries(map).find(
      ([path]) => path.startsWith("plain/") && path.endsWith("/folder.json"),
    );

    expect(JSON.parse(coloredEntry![1]).environments).toEqual([
      { name: "prod", color: "#dc262680", variables: [] },
    ]);
    expect(JSON.parse(plainEntry![1])).not.toHaveProperty("environments");
    expect(JSON.parse(plainEntry![1])).not.toHaveProperty("environmentColors");
  });

  // AC-003 - behavior: a request never carries environmentColors after a round-trip.
  it("should leave a request without an environmentColors field after a round-trip", () => {
    const tree: TreeNode[] = [request("Health")];

    const result = expectOk(deserialize(serialize(tree)));
    const health = result.tree.find(
      (n): n is RequestNode => n.kind === "request" && n.name === "Health",
    );

    expect(health).not.toHaveProperty("environmentColors");
  });
});

describe("disk-format environmentColors sanitize (AC-008, E-2, E-4)", () => {
  // Each garbage case is paired with a VALID colored sibling ("Good", prod=#2563eb)
  // so a green run proves the field is actually READ + validated - not merely never
  // read (which would make a bare "garbage -> undefined" assertion tautological).
  const folderJsonWith = (environmentColors: unknown): FileMap => ({
    "requi.workspace.json": JSON.stringify({ schemaVersion: 3, name: "W" }),
    "api/folder.json": JSON.stringify({
      name: "Api",
      config: { variables: { baseUrl: "https://api" } },
      order: 0,
      environmentColors,
    }),
    "api/get.req.json": JSON.stringify({
      name: "Get",
      method: "GET",
      url: "u",
      body: "",
      config: {},
      order: 0,
    }),
    "good/folder.json": JSON.stringify({
      name: "Good",
      config: {},
      order: 1,
      environmentColors: { prod: "#2563eb" },
    }),
  });

  const expectGoodSiblingKept = (result: ReturnType<typeof expectOk>) =>
    expect(loadedFolder(result, "Good").environmentColors).toEqual({
      prod: "#2563eb",
    });

  // AC-008, E-2 - behavior: a lowercase #rrggbb hex value is accepted.
  it("should keep a valid lowercase #rrggbb env color from folder.json", () => {
    const result = expectOk(deserialize(folderJsonWith({ prod: "#dc2626" })));

    expect(loadedFolder(result, "Api").environmentColors).toEqual({
      prod: "#dc2626",
    });
  });

  // AC-008, E-4 - behavior: an uppercase hex value is lowercased on deserialize.
  it("should lowercase an uppercase #RRGGBB env color from folder.json", () => {
    const result = expectOk(deserialize(folderJsonWith({ prod: "#DC2626" })));

    expect(loadedFolder(result, "Api").environmentColors).toEqual({
      prod: "#dc2626",
    });
  });

  // AC-008, E-4 - behavior: an 8-digit #rrggbbaa hex (alpha pair) value is kept.
  it("should keep a valid #rrggbbaa env color carrying an alpha pair", () => {
    const result = expectOk(deserialize(folderJsonWith({ prod: "#dc262640" })));

    expect(loadedFolder(result, "Api").environmentColors).toEqual({
      prod: "#dc262640",
    });
  });

  // AC-008, E-2 - behavior: a non-hex value for one env is dropped while a valid
  // sibling entry in the SAME map survives.
  it('should drop a non-hex "red" entry but keep a valid sibling entry in the same map', () => {
    const result = expectOk(
      deserialize(folderJsonWith({ bad: "red", prod: "#16a34a80" })),
    );

    expect(loadedFolder(result, "Api").environmentColors).toEqual({
      prod: "#16a34a80",
    });
  });

  // AC-008, E-2 - behavior: a numeric value entry is dropped, valid sibling kept.
  it("should drop a numeric env-color entry but keep a valid sibling entry", () => {
    const result = expectOk(
      deserialize(folderJsonWith({ bad: 123, prod: "#16a34a80" })),
    );
    const loaded = loadedFolder(result, "Api");

    expect(loaded.environmentColors).toEqual({ prod: "#16a34a80" });
    expect(loaded.config.variables).toEqual([
      { key: "baseUrl", value: "https://api" },
    ]);
  });

  // AC-008, E-2 - behavior: a 3-digit "#abc" value is dropped (not #rrggbb/#rrggbbaa),
  // a valid sibling entry survives.
  it('should drop a 3-digit "#abc" env-color entry but keep a valid sibling entry', () => {
    const result = expectOk(
      deserialize(folderJsonWith({ bad: "#abc", prod: "#2563eb80" })),
    );

    expect(loadedFolder(result, "Api").environmentColors).toEqual({
      prod: "#2563eb80",
    });
  });

  // AC-008, E-2 - behavior: when NO entry survives, the field is dropped entirely
  // (the map empties), the folder otherwise intact + a colored sibling folder kept.
  it("should drop environmentColors entirely if no entry is a valid hex, keeping the rest", () => {
    const result = expectOk(
      deserialize(folderJsonWith({ a: "red", b: 7, c: "#12345" })),
    );
    const loaded = loadedFolder(result, "Api");

    expect(loaded.environmentColors).toBeUndefined();
    expect(loaded.config.variables).toEqual([
      { key: "baseUrl", value: "https://api" },
    ]);
    expectGoodSiblingKept(result);
  });

  // AC-008, E-2 - behavior: a non-object environmentColors (a string) is dropped,
  // folder + colored sibling intact.
  it("should drop a non-object environmentColors but keep the rest of the folder", () => {
    const result = expectOk(deserialize(folderJsonWith("not-an-object")));
    const loaded = loadedFolder(result, "Api");

    expect(loaded.environmentColors).toBeUndefined();
    expect(loaded.children).toHaveLength(1);
    expect(loaded.children[0].name).toBe("Get");
    expectGoodSiblingKept(result);
  });

  // AC-008, E-2 - behavior: a malformed environmentColors leaves the folder loadable
  // (no crash); a valid sibling color still loads (proving the field is read).
  it("should still load the folder normally if environmentColors is malformed", () => {
    const result = expectOk(deserialize(folderJsonWith(42)));
    const loaded = loadedFolder(result, "Api");

    expect(loaded.environmentColors).toBeUndefined();
    expect(loaded.children).toHaveLength(1);
    expectGoodSiblingKept(result);
  });
});
