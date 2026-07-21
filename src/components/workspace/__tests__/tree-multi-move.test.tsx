import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { WriteResult } from "@/lib/workspace/fs";
import type { TreeNode } from "@/lib/workspace/model";
import { locateNode } from "@/lib/workspace/tree-locate";
import { fixtureTree } from "./fixtures";

// Drives moveNodes through the context (the multi-drag path) and reads both moved
// nodes' parents back out of the live tree.
function MultiMoveProbe() {
  const { tree, moveNodes } = useWorkspace();
  const profile = locateNode(tree, "req-profile");
  const session = locateNode(tree, "req-session");

  return (
    <div>
      <span data-testid="profile-parent">{profile?.parentId ?? "root"}</span>
      <span data-testid="session-parent">{session?.parentId ?? "root"}</span>
      <button
        type="button"
        onClick={() =>
          moveNodes(["req-profile", "req-session"], {
            parentId: "folder-users",
            index: 1,
          })
        }
      >
        move both into Users
      </button>
    </div>
  );
}

describe("WorkspaceProvider moveNodes (multi-drag)", () => {
  // AC-005, AC-008 - behavior + side-effect-contract (both selected nodes reparent and persist)
  it("should reparent every dragged node and fire onTreeChange when moveNodes is called", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<(tree: TreeNode[]) => Promise<WriteResult>>(() =>
      Promise.resolve({ ok: true }),
    );

    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={onTreeChange}>
        <MultiMoveProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("profile-parent")).toHaveTextContent("root");
    expect(screen.getByTestId("session-parent")).toHaveTextContent("root");

    await user.click(
      screen.getByRole("button", { name: /move both into users/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("profile-parent")).toHaveTextContent(
        "folder-users",
      );
    });
    expect(screen.getByTestId("session-parent")).toHaveTextContent(
      "folder-users",
    );

    const lastArg = onTreeChange.mock.calls.at(-1)?.[0];
    expect(locateNode(lastArg ?? [], "req-profile")?.parentId).toBe(
      "folder-users",
    );
    expect(locateNode(lastArg ?? [], "req-session")?.parentId).toBe(
      "folder-users",
    );
  });
});
