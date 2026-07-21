import { EditorView } from "@codemirror/view";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Content } from "@/components/workspace/content";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { folderConfigDoc } from "@/lib/workspace/disk-format";
import type { ConfigScope, TreeNode } from "@/lib/workspace/model";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";
import { createFakeHttpClient } from "./fake-http-client";

const FOLDER_CONFIG: ConfigScope = {
  variables: [{ key: "baseUrl", value: "https://api.example.com" }],
  headers: [{ key: "Accept", value: "application/json" }],
  auth: authOf({ active: "bearer", token: "folder-token" }),
  scripts: { pre: "// folder pre-request" },
  environments: [
    {
      name: "local",
      variables: [{ key: "baseUrl", value: "http://localhost:8080" }],
    },
  ],
};

const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-1",
    name: "Auth",
    config: FOLDER_CONFIG,
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

function OpenFolder() {
  const { openConfigEditor, saveActiveEditor } = useWorkspace();
  return (
    <>
      <button type="button" onClick={() => openConfigEditor("folder-1")}>
        open folder
      </button>
      <button type="button" onClick={saveActiveEditor}>
        fire shortcut
      </button>
    </>
  );
}

function renderContent(onTreeChange = vi.fn().mockResolvedValue({ ok: true })) {
  const store = createInMemorySettingsStore({ ...DEFAULT_SETTINGS });
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={tree}
        httpClient={createFakeHttpClient()}
        onTreeChange={onTreeChange}
      >
        <OpenFolder />
        <Content />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

function liveDoc(): string {
  const el = document.querySelector<HTMLElement>(".cm-editor");
  if (!el) throw new Error(".cm-editor not found");
  const view = EditorView.findFromDOM(el);
  if (!view) throw new Error("live EditorView not found");
  return view.state.doc.toString();
}

describe("FolderPane", () => {
  // behavior: opening a folder shows a pane with the folder sub-tabs (folders carry
  // no request-only Params tab - query/path params are request-owned now).
  it("should render Vars/Auth/Headers/Script/Env/Settings/Raw sub-tabs", async () => {
    const user = userEvent.setup();
    renderContent();

    await user.click(
      await screen.findByRole("button", { name: /open folder/i }),
    );

    const tablist = await screen.findByRole("tablist", {
      name: /folder sections/i,
    });
    for (const name of [
      "Vars",
      "Auth",
      "Headers",
      "Script",
      "Env",
      "Settings",
      "Raw",
    ]) {
      expect(within(tablist).getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  // behavior: a folder pane opens on the Vars sub-tab by default
  it("should select the Vars sub-tab by default", async () => {
    const user = userEvent.setup();
    renderContent();

    await user.click(
      await screen.findByRole("button", { name: /open folder/i }),
    );

    const tablist = await screen.findByRole("tablist", {
      name: /folder sections/i,
    });
    expect(within(tablist).getByRole("tab", { name: "Vars" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // behavior: the Vars sub-tab lists the folder's variables
  it("should show the folder variables in the Vars sub-tab", async () => {
    const user = userEvent.setup();
    renderContent();

    await user.click(
      await screen.findByRole("button", { name: /open folder/i }),
    );

    expect(await screen.findByDisplayValue("baseUrl")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://api.example.com"),
    ).toBeInTheDocument();
  });

  // behavior: the Headers sub-tab lists the folder's headers
  it("should show the folder headers in the Headers sub-tab", async () => {
    const user = userEvent.setup();
    renderContent();

    await user.click(
      await screen.findByRole("button", { name: /open folder/i }),
    );
    const tablist = await screen.findByRole("tablist", {
      name: /folder sections/i,
    });
    await user.click(within(tablist).getByRole("tab", { name: "Headers" }));

    expect(await screen.findByDisplayValue("Accept")).toBeInTheDocument();
  });

  // behavior: the Raw sub-tab shows the folder config as editable JSON
  it("should show the folder config as raw JSON in the Raw sub-tab", async () => {
    const user = userEvent.setup();
    renderContent();

    await user.click(
      await screen.findByRole("button", { name: /open folder/i }),
    );
    const tablist = await screen.findByRole("tablist", {
      name: /folder sections/i,
    });
    await user.click(within(tablist).getByRole("tab", { name: "Raw" }));

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });
    // the Settings doc is the on-disk folder shape (folderConfigDoc), not the raw
    // in-memory config: config fields in CONFIG_KEYS order + env colors folded in.
    expect(liveDoc()).toBe(
      JSON.stringify(folderConfigDoc(FOLDER_CONFIG, {}), null, 2),
    );
  });

  // behavior: Mod+S persists the folder config (the Save bar was removed)
  it("should persist the folder config when the save shortcut fires", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn().mockResolvedValue({ ok: true });
    renderContent(onTreeChange);

    await user.click(
      await screen.findByRole("button", { name: /open folder/i }),
    );
    const tablist = await screen.findByRole("tablist", {
      name: /folder sections/i,
    });
    await user.click(within(tablist).getByRole("tab", { name: "Raw" }));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const view = EditorView.findFromDOM(
      document.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    // Dispatch inside act so the onChange -> setText -> re-register-descriptor
    // update flushes BEFORE firing save - else the save reads the stale seed
    // (the CM-dispatch/Mod+S timing flake class, docs/learnings.md #139).
    await act(async () => {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: JSON.stringify({ variables: { x: "1" } }),
        },
      });
    });
    await user.click(screen.getByRole("button", { name: /fire shortcut/i }));

    await waitFor(() => {
      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });
    const next = onTreeChange.mock.calls[0][0] as TreeNode[];
    expect(next.find((n) => n.id === "folder-1")?.config).toEqual({
      variables: [{ key: "x", value: "1" }],
    });
  });
});
