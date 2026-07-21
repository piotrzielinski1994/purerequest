import { describe, expect, it } from "vitest";

import { deserialize, serialize } from "@/lib/workspace/disk-format";
import { createInMemoryWorkspaceFs } from "@/lib/workspace/in-memory-fs";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import { moveNode } from "@/lib/workspace/move";

const request = (id: string, name = id): RequestNode => ({
  kind: "request",
  id,
  name,
  method: "GET",
  url: `https://example.test/${name}`,
  body: emptyBody(),
  params: emptyParams(),
  config: {},
});

const folder = (id: string, children: TreeNode[], name = id): FolderNode => ({
  kind: "folder",
  id,
  name,
  config: {},
  children,
});

const stripIds = (nodes: TreeNode[]): unknown =>
  nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        kind: node.kind,
        name: node.name,
        config: node.config,
        children: stripIds(node.children),
      };
    }
    return {
      kind: node.kind,
      name: node.name,
      method: node.method,
      url: node.url,
      body: node.body,
      config: node.config,
    };
  });

const expectDeserializeOk = (result: ReturnType<typeof deserialize>) => {
  if (!result.ok) {
    throw new Error(`expected ok deserialize, got error: ${result.error}`);
  }
  return result;
};

const findFolder = (nodes: TreeNode[], name: string): FolderNode => {
  const found = nodes.find(
    (node): node is FolderNode => node.kind === "folder" && node.name === name,
  );
  if (!found) {
    throw new Error(`folder ${name} not found at this level`);
  }
  return found;
};

const PATH = "/tmp/ws";

describe("in-memory writeWorkspace", () => {
  // AC-010 - behavior
  it("should round-trip a serialized tree if written then read back", async () => {
    const tree: TreeNode[] = [
      folder("f1", [request("c1"), request("c2")], "Users API"),
      request("r1", "Health"),
    ];
    const files = serialize(tree);
    const fs = createInMemoryWorkspaceFs({});

    const write = await fs.writeWorkspace(PATH, files);
    expect(write.ok).toBe(true);

    const read = await fs.readWorkspace(PATH);
    expect(read.ok).toBe(true);
    if (!read.ok) {
      throw new Error(read.error);
    }
    expect(read.files).toEqual(files);

    const reloaded = expectDeserializeOk(deserialize(read.files));
    expect(stripIds(reloaded.tree)).toEqual(stripIds(tree));
  });

  // AC-010, TC-008 - behavior
  it("should persist a reparented request if a move is serialized and written", async () => {
    const initialTree: TreeNode[] = [
      folder("dst", [], "Destination"),
      request("moving", "Move Me"),
    ];
    const fs = createInMemoryWorkspaceFs({ [PATH]: serialize(initialTree) });

    const seeded = expectDeserializeOk(deserialize(serialize(initialTree)));
    const destId = findFolder(seeded.tree, "Destination").id;
    const movingId = seeded.tree.find(
      (node): node is RequestNode =>
        node.kind === "request" && node.name === "Move Me",
    )?.id;
    if (!movingId) {
      throw new Error("seeded request not found");
    }

    const movedTree = moveNode(seeded.tree, movingId, {
      parentId: destId,
      index: 0,
    });

    const write = await fs.writeWorkspace(PATH, serialize(movedTree));
    expect(write.ok).toBe(true);

    const read = await fs.readWorkspace(PATH);
    if (!read.ok) {
      throw new Error(read.error);
    }
    const reloaded = expectDeserializeOk(deserialize(read.files));

    expect(reloaded.tree).toHaveLength(1);
    const dst = findFolder(reloaded.tree, "Destination");
    const childNames = dst.children.map((node) => node.name);
    expect(childNames).toContain("Move Me");
  });

  // side-effect-contract
  it("should return ok true if the write succeeds", async () => {
    const fs = createInMemoryWorkspaceFs({});
    const files = serialize([request("r1", "Solo")]);

    const result = await fs.writeWorkspace(PATH, files);

    expect(result).toEqual({ ok: true });
  });

  // behavior
  it("should create the workspace if it was not pre-seeded", async () => {
    const fs = createInMemoryWorkspaceFs({});
    const files = serialize([request("r1", "Fresh")]);

    const before = await fs.readWorkspace(PATH);
    expect(before.ok).toBe(false);

    await fs.writeWorkspace(PATH, files);

    const after = await fs.readWorkspace(PATH);
    expect(after.ok).toBe(true);
    if (!after.ok) {
      throw new Error(after.error);
    }
    expect(after.files).toEqual(files);
  });
});

describe("in-memory readWorkspace (existing API)", () => {
  // behavior
  it("should return the seeded file map if constructed with an initial workspace", async () => {
    const files = serialize([request("r1", "Seeded")]);
    const fs = createInMemoryWorkspaceFs({ [PATH]: files });

    const read = await fs.readWorkspace(PATH);

    expect(read.ok).toBe(true);
    if (!read.ok) {
      throw new Error(read.error);
    }
    expect(read.files).toEqual(files);
  });
});
