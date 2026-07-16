import { describe, it, expect, vi } from "vitest";

import { createExports } from "@/components/workspace/workspace-context/exports";
import type { WorkspaceInternals } from "@/components/workspace/workspace-context/types";
import type { BrunoExportWriter } from "@/lib/bruno/writer";
import type { BrunoFileMap } from "@/lib/bruno/bruno-to-tree";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

function req(id: string, name: string): RequestNode {
  return {
    kind: "request",
    id,
    name,
    method: "GET",
    url: "https://x.test",
    body: emptyBody(),
    params: emptyParams(),
    config: {},
  };
}

function folder(id: string, name: string, children: TreeNode[]): FolderNode {
  return { kind: "folder", id, name, config: {}, children };
}

type SaveCall = { files: BrunoFileMap; suggestedName: string };

function harness(saveResult = true) {
  const calls: SaveCall[] = [];
  const writer: BrunoExportWriter = {
    save: (files, suggestedName) => {
      calls.push({ files, suggestedName });
      return Promise.resolve(saveResult);
    },
  };
  return { calls, writer };
}

function makeInternals(
  tree: TreeNode[],
  writer: BrunoExportWriter,
  workspaceName: string,
  onToast: (m: string) => void,
): WorkspaceInternals {
  return {
    tree,
    workspaceName,
    brunoWriterRef: { current: writer },
    showToastRef: { current: onToast },
  } as unknown as WorkspaceInternals;
}

describe("createExports - exportBruno routing (AC-012)", () => {
  // TC-013 - behavior: a folder nodeId routes THAT folder as the collection root
  // (suggestedName = folder name), and a success toast fires.
  it("should export the selected folder as the collection root and toast on success", async () => {
    const users = folder("f1", "Users", [req("r1", "Get Users")]);
    const tree: TreeNode[] = [users];
    const toasts: string[] = [];
    const { calls, writer } = harness();
    const internals = makeInternals(tree, writer, "My WS", (m) => toasts.push(m));

    const { exportBruno } = createExports(internals);
    exportBruno("f1");
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    expect(calls[0].suggestedName).toBe("Users");
    expect(JSON.parse(calls[0].files["bruno.json"]).name).toBe("Users");
    await vi.waitFor(() => expect(toasts).toContain("Exported Bruno collection"));
  });

  // TC-014 - behavior: a non-folder id (or undefined) routes the WHOLE workspace
  // wrapped in a synthetic root named after the workspace.
  it("should export the whole workspace named after the workspace if the target is not a folder", async () => {
    const tree: TreeNode[] = [req("r1", "Top Req"), folder("f1", "A", [])];
    const { calls, writer } = harness();
    const internals = makeInternals(tree, writer, "My WS", () => {});

    const { exportBruno } = createExports(internals);
    exportBruno("r1");
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    expect(calls[0].suggestedName).toBe("My WS");
    expect(JSON.parse(calls[0].files["bruno.json"]).name).toBe("My WS");
    expect(calls[0].files["a/folder.bru"]).toBeDefined();
    expect(calls[0].files["top-req.bru"]).toBeDefined();
  });

  // behavior: undefined target also routes the whole workspace.
  it("should export the whole workspace if the target is undefined", async () => {
    const tree: TreeNode[] = [req("r1", "Only")];
    const { calls, writer } = harness();
    const internals = makeInternals(tree, writer, "WS", () => {});

    createExports(internals).exportBruno(undefined);
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    expect(calls[0].suggestedName).toBe("WS");
  });

  // behavior: a cancelled save (false) fires no toast.
  it("should not toast if the writer save resolves false", async () => {
    const tree: TreeNode[] = [folder("f1", "Users", [])];
    const toasts: string[] = [];
    const { calls, writer } = harness(false);
    const internals = makeInternals(tree, writer, "WS", (m) => toasts.push(m));

    createExports(internals).exportBruno("f1");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await Promise.resolve();

    expect(toasts).toHaveLength(0);
  });

  // spec §8.7 - behavior: a rejecting save (fs write failure) surfaces an error
  // toast rather than an unhandled rejection.
  it("should show an error toast if the writer save rejects", async () => {
    const tree: TreeNode[] = [folder("f1", "Users", [])];
    const toasts: string[] = [];
    const writer: BrunoExportWriter = {
      save: () => Promise.reject(new Error("disk full")),
    };
    const internals = makeInternals(tree, writer, "WS", (m) => toasts.push(m));

    createExports(internals).exportBruno("f1");

    await vi.waitFor(() =>
      expect(toasts).toContain("Failed to export Bruno collection"),
    );
  });
});
