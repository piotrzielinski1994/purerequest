import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import { createFakeHttpClient, type FakeHttpClient } from "./fake-http-client";
import { createFakeScriptRunner } from "@/lib/scripts/fake-runner";
import type { ScriptApi } from "@/lib/scripts/model";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

// A folder whose `BEARER_TOKEN` var row is a PURE pointer to its own `.env`,
// plus a second row `plain` that's a literal (legacy path). The request runs a
// post script that setVar's both.
const makeTree = (bearerRowValue: string): TreeNode[] => {
  const request: RequestNode = {
    kind: "request",
    id: "req-main",
    name: "main",
    method: "GET",
    url: "https://api.example.com/thing",
    body: emptyBody(),
    params: emptyParams(),
    config: { scripts: { post: "/* post */" } },
  };
  const folder: FolderNode = {
    kind: "folder",
    id: "identity",
    name: "identity",
    config: {
      variables: [
        { key: "BEARER_TOKEN", value: bearerRowValue },
        { key: "plain", value: "old" },
      ],
    },
    dotenv: "BEARER_TOKEN=old-token",
    children: [request],
  };
  return [folder];
};

function Probe() {
  const { sendRequest } = useWorkspace();
  return (
    <button type="button" onClick={() => sendRequest("req-main")}>
      send main
    </button>
  );
}

type RenderOpts = {
  tree: TreeNode[];
  setVarImpl: (api: ScriptApi) => void;
  onTreeChange: OnTreeChange;
  onEnvChange?: (text: string) => void;
  envText?: string;
  processEnv?: Record<string, string>;
};

function renderProbe({
  tree,
  setVarImpl,
  onTreeChange,
  onEnvChange,
  envText,
  processEnv,
}: RenderOpts) {
  const client: FakeHttpClient = createFakeHttpClient();
  return render(
    <WorkspaceProvider
      tree={tree}
      httpClient={client}
      scriptRunner={createFakeScriptRunner(setVarImpl)}
      initialActiveRequestId="req-main"
      initialExpandedIds={["identity"]}
      onTreeChange={onTreeChange}
      onEnvChange={onEnvChange}
      envText={envText}
      processEnv={processEnv}
    >
      <Probe />
    </WorkspaceProvider>,
  );
}

const findFolder = (nodes: TreeNode[], id: string): FolderNode | null => {
  for (const node of nodes) {
    if (node.id === id && node.kind === "folder") {
      return node;
    }
    if (node.kind === "folder") {
      const found = findFolder(node.children, id);
      if (found) {
        return found;
      }
    }
  }
  return null;
};

describe("setVar follows a pure process.env pointer to the folder .env (AC-001/002)", () => {
  // TC-001 - behavior: setVar on a BEARER_TOKEN row that is
  // {{process.env.BEARER_TOKEN}} writes the JWT into the folder .env and leaves
  // the config.variables pointer row untouched.
  it("should write the value to the owning folder .env and leave the pointer row untouched", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({
      tree: makeTree("{{process.env.BEARER_TOKEN}}"),
      setVarImpl: (api) => api.purerequest.setVar("BEARER_TOKEN", "new-jwt"),
      onTreeChange,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const calls = onTreeChange.mock.calls;
    const lastTree = calls[calls.length - 1][0];
    const folder = findFolder(lastTree, "identity");
    // .env updated:
    expect(folder?.dotenv ?? "").toContain("BEARER_TOKEN=new-jwt");
    // pointer row untouched:
    expect(
      folder?.config.variables?.find((r) => r.key === "BEARER_TOKEN")?.value,
    ).toBe("{{process.env.BEARER_TOKEN}}");
  });
});

describe("setVar follows a pure process.env pointer to the ROOT .env (AC-002)", () => {
  // TC-002 - behavior: the key lives only in the root .env (folder has no such
  // dotenv key); the write lands in the root .env via onEnvChange, folder row
  // untouched.
  it("should write to the root .env if the key is provided by the root, not the folder", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    const onEnvChange = vi.fn<(text: string) => void>();
    const tree = makeTree("{{process.env.BEARER_TOKEN}}");
    // Strip the folder .env so the key is only provided by the root.
    const folder = tree[0] as FolderNode;
    const rootProvidedTree: TreeNode[] = [{ ...folder, dotenv: undefined }];

    renderProbe({
      tree: rootProvidedTree,
      setVarImpl: (api) => api.purerequest.setVar("BEARER_TOKEN", "root-jwt"),
      onTreeChange,
      onEnvChange,
      envText: "BEARER_TOKEN=old-root",
      processEnv: { BEARER_TOKEN: "old-root" },
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => expect(onEnvChange).toHaveBeenCalled());
    const lastText =
      onEnvChange.mock.calls[onEnvChange.mock.calls.length - 1][0];
    expect(lastText).toContain("BEARER_TOKEN=root-jwt");
  });
});

describe("setVar appends to the root .env if the key owns no .env yet (AC-003)", () => {
  // TC-005 - behavior: the pointer resolves to a KEY not present in ANY .env (no
  // owner) -> it is appended to the root .env (the no-owner fallback).
  it("should append the key to the root .env if it has no owning scope", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    const onEnvChange = vi.fn<(text: string) => void>();
    const tree = makeTree("{{process.env.BEARER_TOKEN}}");
    // Folder .env exists but does not define BEARER_TOKEN; root .env is empty.
    const folder = tree[0] as FolderNode;
    const treeMissingKey: TreeNode[] = [{ ...folder, dotenv: "OTHER=x" }];

    renderProbe({
      tree: treeMissingKey,
      setVarImpl: (api) =>
        api.purerequest.setVar("BEARER_TOKEN", "appended-jwt"),
      onTreeChange,
      onEnvChange,
      envText: "",
      processEnv: {},
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => expect(onEnvChange).toHaveBeenCalled());
    const lastText =
      onEnvChange.mock.calls[onEnvChange.mock.calls.length - 1][0];
    expect(lastText).toContain("BEARER_TOKEN=appended-jwt");
  });
});

describe("a send-triggered setVar persist is silent (no Saved toast)", () => {
  // behavior: persisting a var written by a request script must NOT raise the
  // "Saved" toast - that toast is reserved for an explicit user save (Cmd+S /
  // edit). The tree still persists (onTreeChange fires), just without the toast.
  it("should persist the config.variables write but show no Saved toast when a script setVar fires on send", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({
      tree: makeTree("{{process.env.BEARER_TOKEN}}"),
      setVarImpl: (api) => api.purerequest.setVar("plain", "literal-new"),
      onTreeChange,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(screen.queryByText(/^saved$/i)).toBeNull();
  });

  // behavior: a .env write from a send-triggered setVar is likewise silent.
  it("should persist the .env write but show no Saved toast when a script setVar fires on send", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    const onEnvChange = vi.fn<(text: string) => void>();
    const tree = makeTree("{{process.env.BEARER_TOKEN}}");
    const folder = tree[0] as FolderNode;
    const rootProvidedTree: TreeNode[] = [{ ...folder, dotenv: undefined }];

    renderProbe({
      tree: rootProvidedTree,
      setVarImpl: (api) => api.purerequest.setVar("BEARER_TOKEN", "root-jwt"),
      onTreeChange,
      onEnvChange,
      envText: "BEARER_TOKEN=old-root",
      processEnv: { BEARER_TOKEN: "old-root" },
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => expect(onEnvChange).toHaveBeenCalled());
    expect(screen.queryByText(/^saved$/i)).toBeNull();
  });
});

describe("setVar on a literal row keeps the legacy config-overwrite (AC-004)", () => {
  // TC-003 - behavior: a plain-literal var row is overwritten in config.variables,
  // no .env write.
  it("should overwrite the config.variables row and not touch the .env for a literal value", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    const onEnvChange = vi.fn<(text: string) => void>();
    renderProbe({
      tree: makeTree("{{process.env.BEARER_TOKEN}}"),
      setVarImpl: (api) => api.purerequest.setVar("plain", "literal-new"),
      onTreeChange,
      onEnvChange,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const calls = onTreeChange.mock.calls;
    const lastTree = calls[calls.length - 1][0];
    const folder = findFolder(lastTree, "identity");
    expect(
      folder?.config.variables?.find((r) => r.key === "plain")?.value,
    ).toBe("literal-new");
    // the folder .env is unchanged and onEnvChange never fired for this write.
    expect(folder?.dotenv ?? "").toContain("BEARER_TOKEN=old-token");
    expect(onEnvChange).not.toHaveBeenCalled();
  });
});
