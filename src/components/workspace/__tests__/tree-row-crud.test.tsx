import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { TreeRow } from "@/components/workspace/tree-row";
import { TreeDndProvider } from "@/components/workspace/tree-dnd";
import { ToastProvider } from "@/components/ui/toast";
import { fixtureTree, profileRequest } from "./fixtures";
import type { TreeNode } from "@/lib/workspace/model";

// TreeRow render contract for tree-crud. Driven through the REAL WorkspaceProvider
// (never mock the system under test) + a tiny probe that calls beginRename so the
// row enters the renaming state. The radix ContextMenu DOES open under jsdom via
// fireEvent.contextMenu (unlike Select, whose options need pointer/measure -
// verified empirically), so the menu-item assertions fire a real contextmenu
// event on the row and assert the kind-appropriate items render.

type RenameSurface = ReturnType<typeof useWorkspace> & {
  renamingNodeId: string | null;
  beginRename: (id: string) => void;
};

const usersFolder = fixtureTree.find(
  (node): node is TreeNode => node.id === "folder-users",
)!;

// A control probe that exposes beginRename so a test can drive the renaming state
// without needing to open the context menu / fire a real F2 hotkey.
function RenameControl() {
  const { beginRename } = useWorkspace() as RenameSurface;
  return (
    <button type="button" onClick={() => beginRename(profileRequest.id)}>
      start rename
    </button>
  );
}

function renderRow(node: TreeNode) {
  return render(
    <ToastProvider>
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
        <RenameControl />
        <DndContext>
          <TreeDndProvider value={{ activeId: null, indicator: null }}>
            <ul>
              <TreeRow node={node} depth={0} />
            </ul>
          </TreeDndProvider>
        </DndContext>
      </WorkspaceProvider>
    </ToastProvider>,
  );
}

describe("TreeRow inline rename (AC-004)", () => {
  // AC-004 - render-contract: entering the renaming state replaces the label with
  // a text input seeded with the current name.
  it("should render a text input seeded with the name if the row enters the renaming state", async () => {
    const user = userEvent.setup();
    renderRow(profileRequest);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /start rename/i }));

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue(profileRequest.name);
  });

  // AC-004 - render-contract: the label is swapped FOR the input only while
  // renaming (so a non-renaming row keeps its label, no input). Driving the
  // begin makes this RED until the renaming swap is implemented.
  it("should hide the label and show the input only while the row is being renamed", async () => {
    const user = userEvent.setup();
    renderRow(profileRequest);

    // not renaming: label present, no input.
    expect(screen.getByText(profileRequest.name)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /start rename/i }));

    // renaming: input present, the static label text is gone.
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByText(profileRequest.name)).not.toBeInTheDocument();
  });

  // AC-004 - behavior: typing a new name + Enter commits it (input closes, the
  // label reflects the new name persisted into the tree).
  it("should commit the typed name and close the input if Enter is pressed", async () => {
    const user = userEvent.setup();
    renderRow(profileRequest);

    await user.click(screen.getByRole("button", { name: /start rename/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "renamed-here{Enter}");

    // input closed + the row now shows the committed name.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("renamed-here")).toBeInTheDocument();
  });

  // AC-004, TC-005 - behavior: Escape cancels the rename - input closes and the
  // original name is unchanged.
  it("should cancel and keep the original name if Escape is pressed", async () => {
    const user = userEvent.setup();
    renderRow(profileRequest);

    await user.click(screen.getByRole("button", { name: /start rename/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "discarded{Escape}");

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(profileRequest.name)).toBeInTheDocument();
    expect(screen.queryByText("discarded")).not.toBeInTheDocument();
  });

  // AC-004 - behavior: double-clicking the row enters the renaming state.
  it("should enter the renaming state if the row is double-clicked", async () => {
    const user = userEvent.setup();
    renderRow(profileRequest);

    await user.dblClick(screen.getByRole("treeitem", { name: /profile/i }));

    expect(screen.getByRole("textbox")).toHaveValue(profileRequest.name);
  });
});

describe("TreeRow context menu (AC-008, TC-012)", () => {
  // AC-008, TC-012 - render-contract: a request row's context menu offers
  // Rename, Duplicate, Delete - NOT New request / New folder (creating a node
  // "on" a leaf request is meaningless; create lives in the empty-area menu +
  // palette + shortcuts).
  it("should show Rename, Duplicate, Edit config, Delete and NOT create items for a request row", async () => {
    renderRow(profileRequest);

    // the hover pencil is gone - config editing moved to the context menu.
    expect(
      screen.queryByRole("button", { name: /edit config/i }),
    ).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /profile/i }));

    expect(
      await screen.findByRole("menuitem", { name: /rename/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /duplicate/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /^edit$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /delete/i }),
    ).toBeInTheDocument();
    // create actions do not belong on a row.
    expect(
      screen.queryByRole("menuitem", { name: /new request/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /new folder/i }),
    ).not.toBeInTheDocument();
  });

  // AC-008, TC-010 - render-contract: a FOLDER row's context menu offers New
  // request / New folder (create INSIDE it) + Rename + Duplicate + Delete. A
  // folder CAN now be duplicated (the request-only guard was dropped).
  it("should show New request, New folder, Rename, Duplicate, Edit config, Delete for a folder row", async () => {
    renderRow(usersFolder);

    // the hover pencil is gone - config editing moved to the context menu.
    expect(
      screen.queryByRole("button", { name: /edit config/i }),
    ).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /users/i }));

    expect(
      await screen.findByRole("menuitem", { name: /new request/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /new folder/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /rename/i }),
    ).toBeInTheDocument();
    // a folder CAN now be duplicated.
    expect(
      screen.getByRole("menuitem", { name: /duplicate/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /^edit$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /delete/i }),
    ).toBeInTheDocument();
  });
});
