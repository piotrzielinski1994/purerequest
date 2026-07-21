import { EditorView } from "@codemirror/view";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CloseConfirmDialog } from "@/components/workspace/close-confirm-dialog";
import { ContentHeader } from "@/components/workspace/content-header";
import { FolderPane } from "@/components/workspace/folder-pane";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { ConfigScope, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

const folderConfig: ConfigScope = {
  variables: [{ key: "token", value: "tok-123" }],
};

const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-1",
    name: "Folder",
    config: folderConfig,
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

// Opens the folder's config pane (FolderPane mounts off editTarget.kind ===
// "config"), and routes the save action through saveActiveEditor (the seam the
// folder editor registers on), exactly like the real Mod+S folder path.
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
    <WorkspaceProvider tree={tree} onTreeChange={onTreeChange}>
      <ContentHeader />
      <FolderProbe />
      <FolderPane />
      <CloseConfirmDialog />
    </WorkspaceProvider>,
  );
}

const openFolderConfig = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /open folder config/i }));

const openFolderSubTab = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) => {
  const tablist = screen.getByRole("tablist", { name: /folder sections/i });
  await user.click(within(tablist).getByRole("tab", { name }));
};

// The folder config editor tab carries the same "Unsaved changes" dirty marker
// (driven by editorDirty) as the .env / request-config editor tabs.
const dirtyDot = () => {
  const tablist = screen.getByRole("tablist", { name: /open requests/i });
  return within(tablist).queryByLabelText(/unsaved changes/i);
};

const savedConfig = (onTreeChange: ReturnType<typeof vi.fn>): ConfigScope => {
  const calls = onTreeChange.mock.calls;
  const lastTree = calls[calls.length - 1][0] as TreeNode[];
  const folder = lastTree.find((n) => n.id === "folder-1");
  if (folder?.kind !== "folder") {
    throw new Error("folder-1 not found in persisted tree");
  }
  return folder.config;
};

describe("folder structured panels - explicit save (AC-007)", () => {
  // behavior: editing a folder Var and blurring it does NOT persist on blur (no
  // onTreeChange), but it marks the folder config editor dirty.
  it("should mark the folder editor dirty without persisting if a var is edited and blurred", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange);
    await openFolderConfig(user);
    await openFolderSubTab(user, "Vars");

    const valueInput = screen.getByDisplayValue("tok-123");
    await user.clear(valueInput);
    await user.type(valueInput, "tok-999");
    await user.tab();

    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();
    await waitFor(() => expect(dirtyDot()).toBeInTheDocument());
  });

  // side-effect-contract: firing the save action after a folder var edit persists
  // the folder via onTreeChange with the edited config.
  it("should persist the folder config if the save action fires", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange);
    await openFolderConfig(user);
    await openFolderSubTab(user, "Vars");

    const valueInput = screen.getByDisplayValue("tok-123");
    await user.clear(valueInput);
    await user.type(valueInput, "tok-999");
    await user.tab();

    // nothing persisted on blur - persistence happens AT the save action.
    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /fire save/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalledTimes(1));
    expect(savedConfig(onTreeChange).variables).toEqual([
      { key: "token", value: "tok-999" },
    ]);
  });

  // behavior: closing the folder config editor while dirty opens the existing
  // confirm dialog instead of closing it.
  it("should open the confirm dialog if the folder config editor is closed while dirty", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange);
    await openFolderConfig(user);
    await openFolderSubTab(user, "Vars");

    const valueInput = screen.getByDisplayValue("tok-123");
    await user.clear(valueInput);
    await user.type(valueInput, "tok-999");
    await user.tab();
    await waitFor(() => expect(dirtyDot()).toBeInTheDocument());

    await user.click(
      screen.getByRole("button", { name: /close config editor/i }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /unsaved changes/i }),
    ).toBeInTheDocument();
  });

  // side-effect-contract: the Raw raw-JSON sub-tab owns the active-editor
  // slot, so editing a structured var, THEN switching to Settings and editing the
  // raw JSON, then saving must persist the SETTINGS JSON value - the structured
  // draft must NOT clobber it (single owner of the editor slot per sub-tab).
  it("should persist the Raw JSON value, not the structured draft, when both are touched", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange);
    await openFolderConfig(user);

    // structured edit on Vars
    await openFolderSubTab(user, "Vars");
    const valueInput = screen.getByDisplayValue("tok-123");
    await user.clear(valueInput);
    await user.type(valueInput, "tok-999");
    await user.tab();

    // switch to Settings and set the raw JSON to a DIFFERENT value
    await openFolderSubTab(user, "Raw");
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });
    const view = EditorView.findFromDOM(
      document.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    const settingsJson = JSON.stringify({ variables: { fromSettings: "yes" } });
    // Dispatch inside act so the onChange -> setText -> re-register-descriptor
    // update flushes BEFORE firing save - else the save reads the stale seed
    // descriptor (the CM-dispatch/Mod+S timing flake class, docs/learnings.md #139).
    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: settingsJson },
      });
    });

    await user.click(screen.getByRole("button", { name: /fire save/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).variables).toEqual([
      { key: "fromSettings", value: "yes" },
    ]);
  });
});
