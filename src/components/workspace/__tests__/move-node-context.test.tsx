import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { TreeNode } from "@/lib/workspace/model";
import { fixtureTree } from "./fixtures";

function findFolderChildren(
  nodes: TreeNode[],
  folderId: string,
): TreeNode[] | null {
  for (const node of nodes) {
    if (node.kind !== "folder") {
      continue;
    }
    if (node.id === folderId) {
      return node.children;
    }
    const nested = findFolderChildren(node.children, folderId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

type ProbeMove = { dragId: string; parentId: string | null; index: number };

function MoveProbe({ move }: { move: ProbeMove }) {
  const {
    tree,
    consoleLines,
    expandedFolderIds,
    selectedNodeId,
    openRequestIds,
    activeRequestId,
    moveNode,
    selectNode,
    toggleFolder,
  } = useWorkspace();

  const rootIds = tree.map((node) => node.id).join(",");
  const usersChildren = findFolderChildren(tree, "folder-users") ?? [];
  const usersChildIds = usersChildren.map((node) => node.id).join(",");
  const oauthChildren = findFolderChildren(tree, "folder-oauth") ?? [];
  const oauthChildIds = oauthChildren.map((node) => node.id).join(",");

  return (
    <div>
      <span data-testid="root-ids">{`[${rootIds}]`}</span>
      <span data-testid="users-child-ids">{`[${usersChildIds}]`}</span>
      <span data-testid="oauth-child-ids">{`[${oauthChildIds}]`}</span>
      <span data-testid="open-ids">{`[${openRequestIds.join(",")}]`}</span>
      <span data-testid="active-id">{activeRequestId ?? "none"}</span>
      <span data-testid="selected-id">{selectedNodeId ?? "none"}</span>
      <span data-testid="users-expanded">
        {String(expandedFolderIds.has("folder-users"))}
      </span>
      <span data-testid="console">{consoleLines.join("\n")}</span>
      <button
        type="button"
        onClick={() =>
          moveNode(move.dragId, {
            parentId: move.parentId,
            index: move.index,
          })
        }
      >
        do move
      </button>
      <button type="button" onClick={() => selectNode("req-session")}>
        select session
      </button>
      <button type="button" onClick={() => selectNode("folder-auth")}>
        select auth folder
      </button>
      <button type="button" onClick={() => toggleFolder("folder-users")}>
        toggle users folder
      </button>
      <button
        type="button"
        onClick={() =>
          moveNode("req-profile", { parentId: "folder-oauth", index: 0 })
        }
      >
        legal control move
      </button>
    </div>
  );
}

type WorkspaceProviderProps = Parameters<typeof WorkspaceProvider>[0];

type RenderOptions = {
  move: ProbeMove;
  onTreeChange?: WorkspaceProviderProps["onTreeChange"];
  initialExpandedIds?: string[];
};

function renderProbe({
  move,
  onTreeChange,
  initialExpandedIds,
}: RenderOptions) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      onTreeChange={onTreeChange}
      initialExpandedIds={initialExpandedIds}
    >
      <MoveProbe move={move} />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceProvider moveNode", () => {
  // AC-005 (via provider) — behavior
  it("should reparent a root request into a folder if moveNode targets that folder", async () => {
    const user = userEvent.setup();
    renderProbe({
      move: { dragId: "req-session", parentId: "folder-users", index: 0 },
    });

    expect(screen.getByTestId("root-ids")).toHaveTextContent(
      "[folder-auth,folder-users,req-profile,req-session]",
    );
    expect(screen.getByTestId("users-child-ids")).toHaveTextContent(
      "[req-profile]",
    );

    await user.click(screen.getByRole("button", { name: /do move/i }));

    expect(screen.getByTestId("users-child-ids")).toHaveTextContent(
      "[req-session,req-profile]",
    );
    expect(screen.getByTestId("root-ids")).toHaveTextContent(
      "[folder-auth,folder-users,req-profile]",
    );
  });

  // AC-012 — behavior: an open + active tab survives a reparent.
  it("should keep a reparented request open and active if it was the active tab", async () => {
    const user = userEvent.setup();
    renderProbe({
      move: { dragId: "req-session", parentId: "folder-users", index: 0 },
    });

    await user.click(screen.getByRole("button", { name: /select session/i }));
    expect(screen.getByTestId("open-ids")).toHaveTextContent("[req-session]");
    expect(screen.getByTestId("active-id")).toHaveTextContent("req-session");

    await user.click(screen.getByRole("button", { name: /do move/i }));

    // Positive proof the move ran (so the preservation checks below are real).
    expect(screen.getByTestId("users-child-ids")).toHaveTextContent(
      "[req-session,req-profile]",
    );
    expect(screen.getByTestId("open-ids")).toHaveTextContent("[req-session]");
    expect(screen.getByTestId("active-id")).toHaveTextContent("req-session");
  });

  // AC-012 — behavior: expanded folders are preserved across a move.
  it("should keep a folder expanded if a request is moved into it", async () => {
    const user = userEvent.setup();
    renderProbe({
      move: { dragId: "req-session", parentId: "folder-users", index: 0 },
      initialExpandedIds: ["folder-users"],
    });

    expect(screen.getByTestId("users-expanded")).toHaveTextContent("true");

    await user.click(screen.getByRole("button", { name: /do move/i }));

    expect(screen.getByTestId("users-expanded")).toHaveTextContent("true");
    // Sanity: the move actually happened so the assertion above is meaningful.
    expect(screen.getByTestId("users-child-ids")).toHaveTextContent(
      "[req-session,req-profile]",
    );
  });

  // AC-012 — behavior: selection is preserved when an unrelated node moves.
  it("should keep the current selection if an unrelated node is moved", async () => {
    const user = userEvent.setup();
    renderProbe({
      move: { dragId: "req-session", parentId: "folder-users", index: 0 },
    });

    await user.click(
      screen.getByRole("button", { name: /select auth folder/i }),
    );
    expect(screen.getByTestId("selected-id")).toHaveTextContent("folder-auth");

    await user.click(screen.getByRole("button", { name: /do move/i }));

    expect(screen.getByTestId("selected-id")).toHaveTextContent("folder-auth");
    // Sanity: the unrelated move actually happened.
    expect(screen.getByTestId("users-child-ids")).toHaveTextContent(
      "[req-session,req-profile]",
    );
  });

  // AC-010 — side-effect-contract: persistence hook fires once with the new tree.
  it("should call onTreeChange once with the new tree if a move changes the tree", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn().mockResolvedValue({ ok: true });
    renderProbe({
      move: { dragId: "req-session", parentId: "folder-users", index: 0 },
      onTreeChange,
    });

    await user.click(screen.getByRole("button", { name: /do move/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalledTimes(1));
    const nextTree = onTreeChange.mock.calls[0][0] as TreeNode[];
    expect(
      findFolderChildren(nextTree, "folder-users")?.map((n) => n.id),
    ).toEqual(["req-session", "req-profile"]);
  });

  // no-op — behavior: an illegal move leaves the tree untouched and skips persistence.
  it("should not change the tree or call onTreeChange if the move is illegal", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn().mockResolvedValue({ ok: true });
    renderProbe({
      // Dropping folder-auth into folder-oauth, which is its own descendant.
      move: { dragId: "folder-auth", parentId: "folder-oauth", index: 0 },
      onTreeChange,
    });

    const rootBefore = screen.getByTestId("root-ids").textContent;
    const oauthBefore = screen.getByTestId("oauth-child-ids").textContent;

    await user.click(screen.getByRole("button", { name: /do move/i }));

    expect(screen.getByTestId("root-ids")).toHaveTextContent(
      "[folder-auth,folder-users,req-profile,req-session]",
    );
    expect(screen.getByTestId("oauth-child-ids")).toHaveTextContent(
      "[req-token]",
    );
    expect(screen.getByTestId("root-ids").textContent).toBe(rootBefore);
    expect(screen.getByTestId("oauth-child-ids").textContent).toBe(oauthBefore);
    expect(onTreeChange).not.toHaveBeenCalled();

    // Positive proof moveNode is wired: a legal control move DOES change the
    // tree (so the no-op above is a real no-op, not a thrown/missing action).
    await user.click(
      screen.getByRole("button", { name: /legal control move/i }),
    );
    expect(screen.getByTestId("oauth-child-ids")).toHaveTextContent(
      "[req-profile,req-token]",
    );
  });

  // AC-013 — side-effect-contract: a failed persist keeps the in-memory move and logs it.
  it("should keep the in-memory move and log the failure if onTreeChange rejects the move", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "disk boom" });
    renderProbe({
      move: { dragId: "req-session", parentId: "folder-users", index: 0 },
      onTreeChange,
    });

    await user.click(screen.getByRole("button", { name: /do move/i }));

    // In-memory move still holds despite the persistence failure.
    expect(screen.getByTestId("users-child-ids")).toHaveTextContent(
      "[req-session,req-profile]",
    );

    await waitFor(() => {
      const console = screen.getByTestId("console").textContent ?? "";
      expect(console).toMatch(/failed to persist/i);
      expect(console).toContain("disk boom");
    });
  });
});
