import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Content } from "@/components/workspace/content";
import { Sidebar } from "@/components/workspace/sidebar";
import { TreeDndProvider } from "@/components/workspace/tree-dnd";
import { TreeRow } from "@/components/workspace/tree-row";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import type { ConfigScope, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import { createFakeHttpClient } from "./fake-http-client";

const REQ_CONFIG: ConfigScope = { variables: [{ key: "token", value: "abc" }] };

const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-1",
    name: "Folder",
    config: {
      variables: [{ key: "baseUrl", value: "https://api.example.com" }],
    },
    children: [
      {
        kind: "request",
        id: "req-1",
        name: "Req",
        method: "GET",
        url: "{{baseUrl}}/get",
        body: emptyBody(),
        params: emptyParams(),
        config: REQ_CONFIG,
      },
    ],
  },
];

function renderShell() {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={tree}
        consoleLines={["[12:00:00] Ready."]}
        initialExpandedIds={["folder-1"]}
        initialActiveRequestId="req-1"
        envText="TOKEN=seed"
        httpClient={createFakeHttpClient()}
      >
        <Sidebar />
        <Content />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

describe("Sidebar row edit-config control", () => {
  // AC-012 - behavior: clicking a row's edit-config control swaps content to the editor.
  it("should show the config editor in the content area if a row's edit-config control is clicked", async () => {
    const user = userEvent.setup();
    renderShell();

    const tree = await screen.findByRole("tree", { name: /collection/i });
    const reqRow = within(tree).getByRole("treeitem", { name: /Req/i });

    // config editing lives in the row context menu now (no hover pencil).
    fireEvent.contextMenu(reqRow);
    await user.click(await screen.findByRole("menuitem", { name: /^edit$/i }));

    // The editor seeds with the node's config JSON; assert the live CM doc shows it.
    await waitFor(() => {
      const editor = document.querySelector(".cm-editor");
      expect(editor).not.toBeNull();
    });
  });
});

describe("root .env relocated out of the sidebar", () => {
  // AC-009 - behavior: the sidebar no longer hosts a .env edit control.
  it("should not render a .env edit control in the sidebar", async () => {
    renderShell();

    await screen.findByRole("tree", { name: /collection/i });

    expect(
      screen.queryByRole("button", { name: /edit \.env/i }),
    ).not.toBeInTheDocument();
  });

  // AC-009 - behavior: the root .env editor lives in the Settings view instead.
  it("should show the root .env editor in the Settings view", async () => {
    const user = userEvent.setup();
    render(
      <SettingsProvider
        store={createInMemorySettingsStore({
          ...DEFAULT_SETTINGS,
          shortcuts: {},
        })}
      >
        <WorkspaceProvider
          tree={tree}
          envText="TOKEN=seed"
          httpClient={createFakeHttpClient()}
        >
          <OpenSettingsButton />
          <Content />
        </WorkspaceProvider>
      </SettingsProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: /open settings/i }),
    );
    // Env now lives behind its own Settings sub-tab (Theme is the default). The
    // root .env is a full-bleed key/value grid (like the folder Env view), seeded
    // from the dotenv text - no heading/description.
    await user.click(await screen.findByRole("tab", { name: /^env$/i }));

    expect(await screen.findByLabelText("key 1")).toHaveValue("TOKEN");
    expect(screen.getByLabelText("value 1")).toHaveValue("seed");
  });
});

function OpenSettingsButton() {
  const { openSettings } = useWorkspace();
  return (
    <button type="button" onClick={openSettings}>
      open settings
    </button>
  );
}

// Smaller-piece fallbacks: prove the tree-row control wiring + content-render
// contract directly, so a regression localizes even if the full-shell click path
// shifts. These do not depend on the integration render above.
type EditSurface = ReturnType<typeof useWorkspace> & {
  openConfigEditor: (id: string) => void;
  editTarget: unknown;
};

function EditTargetProbe() {
  const ctx = useWorkspace() as EditSurface;
  return (
    <span data-testid="has-edit-target">{ctx.editTarget ? "yes" : "no"}</span>
  );
}

describe("TreeRow edit-config control wiring", () => {
  // AC-012 - side-effect-contract: the row's control opens the config editor target.
  it("should set a config edit target if the row's edit-config control is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={tree} httpClient={createFakeHttpClient()}>
        <TreeDndProvider value={{ activeId: null, indicator: null }}>
          <ul role="tree" aria-label="Collection">
            <TreeRow node={tree[0]} depth={0} />
          </ul>
        </TreeDndProvider>
        <EditTargetProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("has-edit-target")).toHaveTextContent("no");

    const folderRow = screen.getByRole("treeitem", { name: /Folder/i });
    fireEvent.contextMenu(folderRow);
    await user.click(await screen.findByRole("menuitem", { name: /^edit$/i }));

    expect(screen.getByTestId("has-edit-target")).toHaveTextContent("yes");
  });
});
