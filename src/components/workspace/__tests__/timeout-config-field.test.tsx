import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { RequestPane } from "@/components/workspace/request-pane";
import { FolderPane } from "@/components/workspace/folder-pane";
import { ContentHeader } from "@/components/workspace/content-header";
import { CloseConfirmDialog } from "@/components/workspace/close-confirm-dialog";
import type { ConfigScope, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import { createFakeHttpClient } from "./fake-http-client";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

// ---------------------------------------------------------------------------
// Request pane harness (mirrors editable-config-panels.test.tsx)
// ---------------------------------------------------------------------------

function SaveProbe() {
  const { saveActiveEditor, saveActiveRequest } = useWorkspace();
  return (
    <button
      type="button"
      onClick={() => {
        if (!saveActiveEditor()) {
          saveActiveRequest();
        }
      }}
    >
      fire save
    </button>
  );
}

const requestTree: TreeNode[] = [
  {
    kind: "request",
    id: "req-1",
    name: "Req",
    method: "GET",
    url: "https://api/get",
    body: emptyBody(),
    params: emptyParams(),
    config: {},
  },
];

// A request nested under a folder that sets timeoutMs, so the request's
// effective timeout resolves to the folder's value + name (inherit placeholder).
const inheritedTree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-1",
    name: "Parent",
    config: { timeoutMs: 7000 },
    children: [
      {
        kind: "request",
        id: "req-1",
        name: "Req",
        method: "GET",
        url: "https://api/get",
        body: emptyBody(),
        params: emptyParams(),
        config: {},
      },
    ],
  },
];

function renderRequestPane(tree: TreeNode[], onTreeChange: OnTreeChange) {
  return render(
    <WorkspaceProvider
      tree={tree}
      initialActiveRequestId="req-1"
      initialOpenRequestIds={["req-1"]}
      httpClient={createFakeHttpClient()}
      onTreeChange={onTreeChange}
    >
      <SaveProbe />
      <RequestPane />
    </WorkspaceProvider>,
  );
}

const openRequestTab = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) => {
  const tablist = screen.getByRole("tablist", { name: /request sections/i });
  await user.click(within(tablist).getByRole("tab", { name }));
};

const savedRequestConfig = (
  onTreeChange: ReturnType<typeof vi.fn>,
): ConfigScope => {
  const calls = onTreeChange.mock.calls;
  const tree = calls[calls.length - 1][0] as TreeNode[];
  const node = tree.find((n) => n.id === "req-1");
  if (!node || node.kind !== "request") {
    throw new Error("req-1 not found");
  }
  return node.config;
};

describe("request Settings tab timeout field", () => {
  // side-effect-contract (TC-001, AC-001/AC-004): typing a positive integer into
  // the Settings-tab Timeout field and saving persists config.timeoutMs.
  it("should persist config.timeoutMs if a value is typed in the request Settings tab and saved", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderRequestPane(requestTree, onTreeChange);
    await openRequestTab(user, "Settings");

    await user.type(screen.getByLabelText(/timeout/i), "5000");
    await user.tab();

    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /fire save/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedRequestConfig(onTreeChange).timeoutMs).toBe(5000);
  });

  // side-effect-contract (TC-003, AC-005): clearing an own timeoutMs and saving
  // removes the key (inherit again).
  it("should persist removal of config.timeoutMs if the request Settings field is cleared and saved", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderRequestPane(
      [
        {
          kind: "request",
          id: "req-1",
          name: "Req",
          method: "GET",
          url: "https://api/get",
          body: emptyBody(),
          params: emptyParams(),
          config: { timeoutMs: 5000 },
        },
      ],
      onTreeChange,
    );
    await openRequestTab(user, "Settings");

    await user.clear(screen.getByLabelText(/timeout/i));
    await user.click(screen.getByRole("button", { name: /fire save/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedRequestConfig(onTreeChange).timeoutMs).toBeUndefined();
  });

  // behavior (TC-004, AC-006): with no ancestor setting it, the request Settings
  // Timeout field is empty and shows the default effective value + origin.
  it("should show the default effective value and origin as placeholder if nothing sets it", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderRequestPane(requestTree, onTreeChange);
    await openRequestTab(user, "Settings");

    const input = screen.getByLabelText(/timeout/i);
    expect(input).toHaveDisplayValue("");
    expect(input).toHaveAttribute("placeholder", "30000 (default)");
  });

  // behavior (TC-005, AC-006): a request under a folder that sets timeoutMs shows
  // the inherited value + the folder name as placeholder (empty own value).
  it("should show the inherited folder value and name as placeholder if unset on the request", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderRequestPane(inheritedTree, onTreeChange);
    await openRequestTab(user, "Settings");

    const input = screen.getByLabelText(/timeout/i);
    expect(input).toHaveDisplayValue("");
    expect(input).toHaveAttribute("placeholder", "7000 (from Parent)");
  });
});

// ---------------------------------------------------------------------------
// Raw tab rename + edit jump (request pane)
// ---------------------------------------------------------------------------

describe("request pane Raw tab (renamed from Settings)", () => {
  // behavior (TC-007, AC-003): the request sections expose a Raw tab that renders
  // the raw-JSON CodeMirror editor.
  it("should expose a Raw tab that renders the raw JSON editor", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderRequestPane(requestTree, onTreeChange);

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    const rawTab = within(tablist).getByRole("tab", { name: "Raw" });
    expect(rawTab).toBeInTheDocument();

    await user.click(rawTab);
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });
  });

  // behavior (TC-008, AC-008): openConfigEditor on a request activates the Raw
  // tab (the full-JSON editor jump).
  it("should activate the Raw tab if openConfigEditor is called for the request", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    render(
      <WorkspaceProvider
        tree={requestTree}
        httpClient={createFakeHttpClient()}
        onTreeChange={onTreeChange}
      >
        <EditJumpProbe />
        <RequestPane />
      </WorkspaceProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: /open config editor/i }),
    );

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    expect(within(tablist).getByRole("tab", { name: "Raw" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

function EditJumpProbe() {
  const { openConfigEditor } = useWorkspace();
  return (
    <button type="button" onClick={() => openConfigEditor("req-1")}>
      open config editor
    </button>
  );
}

// ---------------------------------------------------------------------------
// Folder pane harness (mirrors folder-explicit-save.test.tsx)
// ---------------------------------------------------------------------------

const folderTree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-1",
    name: "Folder",
    config: { variables: [{ key: "token", value: "tok-123" }] },
    children: [
      {
        kind: "request",
        id: "req-1",
        name: "Req",
        method: "GET",
        url: "https://api/get",
        body: emptyBody(),
        params: emptyParams(),
        config: {},
      },
    ],
  },
];

function FolderProbe() {
  const { openConfigEditor, saveActiveEditor } = useWorkspace();
  return (
    <div>
      <button type="button" onClick={() => openConfigEditor("folder-1")}>
        open folder config
      </button>
      <button type="button" onClick={() => saveActiveEditor()}>
        fire save
      </button>
    </div>
  );
}

function renderFolder(onTreeChange: OnTreeChange) {
  return render(
    <WorkspaceProvider tree={folderTree} onTreeChange={onTreeChange}>
      <ContentHeader />
      <FolderProbe />
      <FolderPane />
      <CloseConfirmDialog />
    </WorkspaceProvider>,
  );
}

const openFolderConfig = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /open folder config/i }));

const openFolderTab = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) => {
  const tablist = screen.getByRole("tablist", { name: /folder sections/i });
  await user.click(within(tablist).getByRole("tab", { name }));
};

const savedFolderConfig = (
  onTreeChange: ReturnType<typeof vi.fn>,
): ConfigScope => {
  const calls = onTreeChange.mock.calls;
  const lastTree = calls[calls.length - 1][0] as TreeNode[];
  const folder = lastTree.find((n) => n.id === "folder-1");
  if (!folder || folder.kind !== "folder") {
    throw new Error("folder-1 not found");
  }
  return folder.config;
};

describe("folder Settings tab timeout field", () => {
  // side-effect-contract (TC-002, AC-002/AC-004): typing a positive integer into
  // the folder Settings-tab Timeout field and saving persists folder
  // config.timeoutMs (variables preserved).
  it("should persist folder config.timeoutMs if a value is typed in the folder Settings tab and saved", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange);
    await openFolderConfig(user);
    await openFolderTab(user, "Settings");

    await user.type(screen.getByLabelText(/timeout/i), "8000");
    await user.tab();

    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /fire save/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalledTimes(1));
    const config = savedFolderConfig(onTreeChange);
    expect(config.timeoutMs).toBe(8000);
    expect(config.variables).toEqual([{ key: "token", value: "tok-123" }]);
  });
});

describe("folder pane Raw tab (renamed from Settings)", () => {
  // behavior (TC-007, AC-003): the folder sections expose a Raw tab that renders
  // the raw-JSON CodeMirror editor.
  it("should expose a Raw tab that renders the raw JSON editor", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange);
    await openFolderConfig(user);

    const tablist = screen.getByRole("tablist", { name: /folder sections/i });
    const rawTab = within(tablist).getByRole("tab", { name: "Raw" });
    expect(rawTab).toBeInTheDocument();

    await user.click(rawTab);
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });
  });
});
