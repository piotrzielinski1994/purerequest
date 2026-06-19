import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { TreeRow } from "@/components/workspace/tree-row";
import {
  TreeDndProvider,
  type DropIndicator,
} from "@/components/workspace/tree-dnd";
import { fixtureTree } from "./fixtures";
import type { TreeNode } from "@/lib/workspace/model";

function renderRow(node: TreeNode, indicator: DropIndicator | null) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
      <DndContext>
        <TreeDndProvider value={{ activeId: "req-session", indicator }}>
          <ul>
            <TreeRow node={node} depth={0} />
          </ul>
        </TreeDndProvider>
      </DndContext>
    </WorkspaceProvider>,
  );
}

const sessionRequest = fixtureTree.find(
  (node): node is TreeNode => node.id === "req-session",
)!;
const usersFolder = fixtureTree.find(
  (node): node is TreeNode => node.id === "folder-users",
)!;

describe("tree drop indicator (AC-009)", () => {
  // AC-009 - behavior: a "before" indicator renders an insertion line
  it("should render a drop line if the indicator points before this row", () => {
    renderRow(sessionRequest, { overId: "req-session", position: "before" });

    expect(screen.getByTestId("drop-line")).toBeInTheDocument();
  });

  // AC-009 - behavior: a row with no matching indicator shows no line
  it("should not render a drop line if the indicator points at another row", () => {
    renderRow(sessionRequest, { overId: "folder-users", position: "before" });

    expect(screen.queryByTestId("drop-line")).not.toBeInTheDocument();
  });

  // AC-009 - behavior: an "inside" indicator highlights the folder row
  it("should highlight a folder row if the indicator points inside it", () => {
    renderRow(usersFolder, { overId: "folder-users", position: "inside" });

    const row = screen.getByRole("treeitem", { name: "Users" });
    expect(row.className).toMatch(/ring/);
    // No insertion line for an inside-drop.
    expect(screen.queryByTestId("drop-line")).not.toBeInTheDocument();
  });

  // AC-009 - behavior: no indicator means no affordance
  it("should render neither line nor highlight if there is no indicator", () => {
    renderRow(usersFolder, null);

    expect(screen.queryByTestId("drop-line")).not.toBeInTheDocument();
    const row = screen.getByRole("treeitem", { name: "Users" });
    expect(row.className).not.toMatch(/ring/);
  });
});

describe("empty-folder drop zone", () => {
  const emptyFolder: TreeNode = {
    kind: "folder",
    id: "folder-empty",
    name: "Empty",
    config: {},
    children: [],
  };

  function renderEmpty(activeId: string | null, indicator: DropIndicator | null) {
    return render(
      <WorkspaceProvider
        tree={[emptyFolder]}
        initialExpandedIds={["folder-empty"]}
      >
        <DndContext>
          <TreeDndProvider value={{ activeId, indicator }}>
            <ul>
              <TreeRow node={emptyFolder} depth={0} />
            </ul>
          </TreeDndProvider>
        </DndContext>
      </WorkspaceProvider>,
    );
  }

  // behavior: an expanded empty folder shows a drop zone while a drag is active
  it("should render a drop zone in an expanded empty folder if a drag is active", () => {
    renderEmpty("req-x", null);

    expect(screen.getByTestId("empty-drop-zone")).toBeInTheDocument();
  });

  // behavior: no drag in progress -> no drop zone (no clutter at rest)
  it("should not render a drop zone if no drag is active", () => {
    renderEmpty(null, null);

    expect(screen.queryByTestId("empty-drop-zone")).not.toBeInTheDocument();
  });

  // behavior: hovering the zone highlights it
  it("should highlight the empty drop zone if the indicator points at it", () => {
    renderEmpty("req-x", {
      overId: "empty-zone:folder-empty",
      position: "inside",
    });

    expect(screen.getByTestId("empty-drop-zone").className).toMatch(/ring/);
  });
});
