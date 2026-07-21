import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { deserialize, serialize } from "@/lib/workspace/disk-format";
import type { RequestNode, TreeNode } from "@/lib/workspace/model";
import type { MoveTarget } from "@/lib/workspace/move";
import { fixtureTree } from "./fixtures";

// The tree-crud surface on the context, narrowed onto the existing value for the
// probe below.
type PendingDelete = { ids: string[] } | null;

type CrudSurface = ReturnType<typeof useWorkspace> & {
  renamingNodeId: string | null;
  beginRename: (id: string) => void;
  commitRename: (id: string, name: string) => void;
  cancelRename: () => void;
  newFolder: (target?: MoveTarget) => void;
  duplicateNode: (id: string) => void;
  pendingDelete: PendingDelete;
  requestDeleteNode: (id: string) => void;
  confirmPendingDelete: () => void;
  cancelPendingDelete: () => void;
  newRequest: (target?: MoveTarget) => void;
};

const collect = (nodes: TreeNode[]): TreeNode[] =>
  nodes.flatMap((node) =>
    node.kind === "folder" ? [node, ...collect(node.children)] : [node],
  );

function CrudProbe() {
  const ctx = useWorkspace() as CrudSurface;
  const {
    tree,
    expandedFolderIds,
    selectedNodeId,
    activeRequestId,
    openRequestIds,
    renamingNodeId,
    pendingDelete,
    setRequestUrl,
    setRequestMethod,
    selectNode,
    clearSelection,
    setActiveRequest,
    closeRequest,
    newRequest,
    newFolder,
    saveActiveRequest,
    beginRename,
    commitRename,
    cancelRename,
    duplicateNode,
    requestDeleteNode,
    confirmPendingDelete,
    cancelPendingDelete,
    selectInTree,
    selectedIds,
  } = ctx;

  const treeNodes = collect(tree);
  const requestNodes = treeNodes.filter(
    (node): node is RequestNode => node.kind === "request",
  );
  const folderCount = treeNodes.length - requestNodes.length;

  return (
    <div>
      <span data-testid="active-id">{activeRequestId ?? "none"}</span>
      <span data-testid="selected-id">{selectedNodeId ?? "none"}</span>
      <span data-testid="open-count">{openRequestIds.length}</span>
      <span data-testid="open-ids">{openRequestIds.join(",") || "none"}</span>
      <span data-testid="request-count">{requestNodes.length}</span>
      <span data-testid="folder-count">{folderCount}</span>
      <span data-testid="tree-ids">
        {treeNodes.map((node) => node.id).join(",")}
      </span>
      <span data-testid="tree-names">
        {treeNodes.map((node) => node.name).join(",")}
      </span>
      <span data-testid="renaming-id">{renamingNodeId ?? "none"}</span>
      <span data-testid="pending-delete">
        {pendingDelete ? pendingDelete.ids.join(",") : "none"}
      </span>
      <span data-testid="selected-ids">
        {[...selectedIds].sort().join(",") || "none"}
      </span>
      <span data-testid="has-actions">
        {[
          typeof commitRename === "function",
          typeof duplicateNode === "function",
          typeof newFolder === "function",
          typeof beginRename === "function",
          typeof requestDeleteNode === "function",
        ].every(Boolean)
          ? "yes"
          : "no"}
      </span>
      <span data-testid="expanded-ids">
        {[...expandedFolderIds].sort().join(",") || "none"}
      </span>

      <button type="button" onClick={() => newRequest()}>
        new request root
      </button>
      <button
        type="button"
        onClick={() => newRequest({ parentId: "folder-users", index: 0 })}
      >
        new request in users
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestUrl(activeRequestId, "https://created.test/path");
            setRequestMethod(activeRequestId, "POST");
          }
        }}
      >
        edit active request
      </button>
      <button type="button" onClick={() => saveActiveRequest()}>
        save active
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            closeRequest(activeRequestId);
          }
        }}
      >
        close active tab
      </button>
      <button type="button" onClick={() => newFolder()}>
        new folder root
      </button>
      <button
        type="button"
        onClick={() => newFolder({ parentId: "folder-users", index: 0 })}
      >
        new folder in users
      </button>
      <button type="button" onClick={() => selectNode("folder-users")}>
        select users folder
      </button>
      <button type="button" onClick={() => clearSelection()}>
        clear selection
      </button>
      <button type="button" onClick={() => setActiveRequest("req-profile")}>
        activate profile
      </button>
      <button type="button" onClick={() => beginRename("req-profile")}>
        begin rename profile
      </button>
      <button
        type="button"
        onClick={() => commitRename("req-profile", "renamed-profile")}
      >
        commit rename profile
      </button>
      <button
        type="button"
        onClick={() => commitRename("folder-users", "Renamed Users")}
      >
        commit rename users folder
      </button>
      <button type="button" onClick={() => commitRename("req-profile", "   ")}>
        commit blank rename
      </button>
      <button type="button" onClick={() => cancelRename()}>
        cancel rename
      </button>
      <button
        type="button"
        onClick={() => {
          if (renamingNodeId !== null) {
            commitRename(renamingNodeId, "My New Folder");
          }
        }}
      >
        commit rename current
      </button>
      <button type="button" onClick={() => duplicateNode("req-profile")}>
        duplicate profile
      </button>
      <button type="button" onClick={() => duplicateNode("folder-users")}>
        duplicate users folder
      </button>
      <button type="button" onClick={() => requestDeleteNode("req-session")}>
        delete session request
      </button>
      <button type="button" onClick={() => requestDeleteNode("folder-empty")}>
        delete empty folder
      </button>
      <button type="button" onClick={() => requestDeleteNode("folder-auth")}>
        delete auth folder
      </button>
      <button type="button" onClick={() => confirmPendingDelete()}>
        confirm delete
      </button>
      <button type="button" onClick={() => cancelPendingDelete()}>
        cancel delete
      </button>
      <button
        type="button"
        onClick={() => {
          selectInTree("folder-users", "replace");
          selectInTree("folder-empty", "toggle");
        }}
      >
        multi-select two folders
      </button>
      <button type="button" onClick={() => requestDeleteNode("folder-users")}>
        delete users folder
      </button>
    </div>
  );
}

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

// fixtureTree has no empty folder; add one so the immediate-delete path
// (empty folder -> no dialog) is exercisable.
const emptyFolder: TreeNode = {
  kind: "folder",
  id: "folder-empty",
  name: "Empty",
  config: {},
  children: [],
};
const crudTree: TreeNode[] = [...fixtureTree, emptyFolder];

function renderProbe(
  props: {
    onTreeChange?: OnTreeChange;
    initialActiveRequestId?: string;
    initialOpenRequestIds?: string[];
    initialExpandedIds?: string[];
    initialDraftTabs?: {
      id: string;
      request: RequestNode;
      placement: { parentId: string | null; index: number };
    }[];
  } = {},
) {
  return render(
    <WorkspaceProvider tree={crudTree} {...props}>
      <CrudProbe />
      <ConsoleProbe />
    </WorkspaceProvider>,
  );
}

function ConsoleProbe() {
  const { consoleLines } = useWorkspace();
  return (
    <ul data-testid="console">
      {consoleLines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
}

describe("WorkspaceProvider create request (draft)", () => {
  // behavior: "+"/new request opens a SESSION DRAFT tab - nothing is written to
  // disk (no onTreeChange) and the request is not added to the sidebar tree. It is
  // only the active + selected open tab, focused on its URL input.
  it("should open a draft tab without persisting anything to disk", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    const requestsBefore = Number(
      screen.getByTestId("request-count").textContent ?? "0",
    );

    await user.click(screen.getByRole("button", { name: /new request root/i }));

    // NOT persisted (draft only, no disk write).
    expect(onTreeChange).not.toHaveBeenCalled();
    // NOT added to the sidebar tree.
    expect(screen.getByTestId("request-count")).toHaveTextContent(
      String(requestsBefore),
    );
    // it IS the active + selected open tab, and not in the renaming state.
    const activeId = screen.getByTestId("active-id").textContent ?? "";
    expect(activeId).not.toBe("none");
    expect(screen.getByTestId("open-ids").textContent).toContain(activeId);
    expect(screen.getByTestId("selected-id")).toHaveTextContent(activeId);
    expect(screen.getByTestId("renaming-id")).toHaveTextContent("none");
  });

  // behavior: closing an unedited draft tab discards it - still nothing on disk.
  it("should discard an unedited draft and never write it to disk on close", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    await user.click(screen.getByRole("button", { name: /new request root/i }));
    const activeId = screen.getByTestId("active-id").textContent ?? "";
    await user.click(screen.getByRole("button", { name: /close active tab/i }));

    expect(onTreeChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("open-ids").textContent).not.toContain(activeId);
  });

  // behavior: a draft is promoted to the tree + disk only on save, at its
  // placement (the selected folder), carrying the edits.
  it("should promote the draft into the selected folder on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    await user.click(
      screen.getByRole("button", { name: /select users folder/i }),
    );
    await user.click(screen.getByRole("button", { name: /new request root/i }));
    const activeId = screen.getByTestId("active-id").textContent ?? "";
    await user.click(
      screen.getByRole("button", { name: /edit active request/i }),
    );
    await user.click(screen.getByRole("button", { name: /save active/i }));

    // one disk write, on save (not on create).
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    const persisted = onTreeChange.mock.calls[0][0];
    const usersFolder = collect(persisted).find(
      (node) => node.kind === "folder" && node.id === "folder-users",
    );
    if (usersFolder?.kind !== "folder") {
      throw new Error("expected the Users folder");
    }
    const created = usersFolder.children.find((node) => node.id === activeId);
    expect(created).toBeDefined();
    expect(created?.kind === "request" && created.url).toBe(
      "https://created.test/path",
    );
    expect(created?.kind === "request" && created.method).toBe("POST");
  });

  // behavior: with nothing selected, an edited draft promotes to the workspace root.
  it("should promote the draft to the workspace root if nothing is selected", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    await user.click(screen.getByRole("button", { name: /new request root/i }));
    const activeId = screen.getByTestId("active-id").textContent ?? "";
    await user.click(
      screen.getByRole("button", { name: /edit active request/i }),
    );
    await user.click(screen.getByRole("button", { name: /save active/i }));

    const persisted = onTreeChange.mock.calls[0][0];
    // present at the ROOT level (not nested in a folder).
    expect(persisted.some((node) => node.id === activeId)).toBe(true);
  });

  // behavior: a persisted draft tab is restored as an open tab on mount (survives
  // an app restart) without appearing in the sidebar tree.
  it("should restore a persisted draft tab on mount as an open tab", () => {
    const draftRequest: RequestNode = {
      kind: "request",
      id: "new-99",
      name: "untitled",
      method: "GET",
      url: "",
      body: {
        active: "json",
        types: {
          json: "",
          form: [],
          multipart: [],
          graphql: { query: "", variables: "" },
        },
      },
      params: { path: [], query: [] },
      config: {},
    };
    renderProbe({
      initialDraftTabs: [
        {
          id: "new-99",
          request: draftRequest,
          placement: { parentId: null, index: 0 },
        },
      ],
      initialOpenRequestIds: ["new-99"],
      initialActiveRequestId: "new-99",
    });

    // it is an open + active tab...
    expect(screen.getByTestId("open-ids").textContent).toContain("new-99");
    expect(screen.getByTestId("active-id")).toHaveTextContent("new-99");
    // ...but NOT a sidebar tree node.
    expect(screen.getByTestId("tree-ids").textContent).not.toContain("new-99");
  });

  // behavior: a draft created with an explicit folder target promotes into that
  // folder on save regardless of selection.
  it("should promote the draft into the explicit target folder on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    await user.click(
      screen.getByRole("button", { name: /new request in users/i }),
    );
    const activeId = screen.getByTestId("active-id").textContent ?? "";
    await user.click(
      screen.getByRole("button", { name: /edit active request/i }),
    );
    await user.click(screen.getByRole("button", { name: /save active/i }));

    const persisted = onTreeChange.mock.calls[0][0];
    const usersFolder = persisted.find(
      (node) => node.kind === "folder" && node.id === "folder-users",
    );
    if (usersFolder?.kind !== "folder") {
      throw new Error("expected the users folder");
    }
    expect(usersFolder.children.some((node) => node.id === activeId)).toBe(
      true,
    );
  });

  // behavior: a RESTORED draft (edits baked into its request, no live override, so
  // not "dirty") still promotes to disk on save - a draft is inherently unsaved.
  it("should promote a restored draft on save even without a live edit", async () => {
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    const draftRequest: RequestNode = {
      kind: "request",
      id: "new-77",
      name: "restored",
      method: "POST",
      url: "https://restored.test/x",
      body: {
        active: "json",
        types: {
          json: "",
          form: [],
          multipart: [],
          graphql: { query: "", variables: "" },
        },
      },
      params: { path: [], query: [] },
      config: {},
    };
    const user = userEvent.setup();
    renderProbe({
      onTreeChange,
      initialDraftTabs: [
        {
          id: "new-77",
          request: draftRequest,
          placement: { parentId: null, index: 0 },
        },
      ],
      initialOpenRequestIds: ["new-77"],
      initialActiveRequestId: "new-77",
    });

    // not dirty (no override), yet save must still write it to disk.
    await user.click(screen.getByRole("button", { name: /save active/i }));

    expect(onTreeChange).toHaveBeenCalledTimes(1);
    const persisted = onTreeChange.mock.calls[0][0];
    const created = persisted.find((node) => node.id === "new-77");
    expect(created?.kind === "request" && created.url).toBe(
      "https://restored.test/x",
    );
  });
});

describe("WorkspaceProvider newFolder (AC-003, TC-003)", () => {
  // AC-003, TC-003 - side-effect-contract: newFolder inserts a folder, persists,
  // expands + selects the parent target, and enters inline rename on the folder.
  it("should insert a folder inside the target, expand+select it, and begin rename", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    const foldersBefore = Number(
      screen.getByTestId("folder-count").textContent ?? "0",
    );

    await user.click(
      screen.getByRole("button", { name: /new folder in users/i }),
    );

    expect(onTreeChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("folder-count")).toHaveTextContent(
      String(foldersBefore + 1),
    );
    // parent folder is expanded so the new child is visible.
    expect(screen.getByTestId("expanded-ids").textContent).toContain(
      "folder-users",
    );
    // the new folder is selected and in the renaming state (same id).
    const selected = screen.getByTestId("selected-id").textContent ?? "";
    expect(selected).not.toBe("none");
    expect(selected).not.toBe("folder-users");
    expect(screen.getByTestId("renaming-id")).toHaveTextContent(selected);
  });

  // AC-003, TC-003 - side-effect-contract: committing the inline rename of the
  // freshly created folder persists it under the new name; the round-trip
  // reproduces it.
  it("should persist the new folder under the committed name (round-trip)", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    await user.click(screen.getByRole("button", { name: /new folder root/i }));
    const newId = screen.getByTestId("renaming-id").textContent ?? "";
    expect(newId).not.toBe("none");
    // newFolder already persisted once (folder.json written on create).
    expect(onTreeChange).toHaveBeenCalledTimes(1);

    // commit the inline rename on the just-created folder (read from
    // renamingNodeId), which persists again under the new name.
    await user.click(
      screen.getByRole("button", { name: /commit rename current/i }),
    );

    expect(onTreeChange).toHaveBeenCalledTimes(2);
    const persisted = onTreeChange.mock.calls[1][0];
    const roundTrip = deserialize(serialize(persisted));
    expect(roundTrip.ok).toBe(true);
    if (!roundTrip.ok) {
      throw new Error("expected round-trip to succeed");
    }
    expect(
      collect(roundTrip.tree).some(
        (node) => node.kind === "folder" && node.name === "My New Folder",
      ),
    ).toBe(true);
    // renaming state cleared after the commit.
    expect(screen.getByTestId("renaming-id")).toHaveTextContent("none");
  });
});

describe("WorkspaceProvider rename (AC-004, TC-004/005/006)", () => {
  // AC-004, TC-004 - side-effect-contract: commitRename writes via onTreeChange
  // and renames the node.
  it("should rename the node and persist if a non-blank name is committed", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    await user.click(
      screen.getByRole("button", { name: /commit rename profile/i }),
    );

    expect(onTreeChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("tree-names").textContent).toContain(
      "renamed-profile",
    );
    // renaming state is cleared after a commit.
    expect(screen.getByTestId("renaming-id")).toHaveTextContent("none");
  });

  // AC-004 - behavior: beginRename sets renamingNodeId; cancelRename clears it
  // with no write.
  it("should set renamingNodeId on begin and clear it on cancel without writing", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    await user.click(
      screen.getByRole("button", { name: /begin rename profile/i }),
    );
    expect(screen.getByTestId("renaming-id")).toHaveTextContent("req-profile");

    await user.click(screen.getByRole("button", { name: /cancel rename/i }));
    expect(screen.getByTestId("renaming-id")).toHaveTextContent("none");
    expect(onTreeChange).not.toHaveBeenCalled();
  });

  // AC-004, TC-005 - behavior: a blank/whitespace rename is rejected (no write,
  // name unchanged).
  it("should not write or change the name if a blank rename is committed", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    // RED guard: the crud actions must be wired for this no-op to be meaningful
    // (else it passes trivially because commitRename doesn't exist).
    expect(screen.getByTestId("has-actions")).toHaveTextContent("yes");

    await user.click(
      screen.getByRole("button", { name: /commit blank rename/i }),
    );

    expect(onTreeChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("tree-names").textContent).toContain("profile");
  });

  // AC-004, TC-006 - side-effect-contract: a folder rename persists and the
  // round-tripped tree keeps the renamed folder + its descendant.
  it("should rename a folder and round-trip the new name with descendants", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    await user.click(
      screen.getByRole("button", { name: /commit rename users folder/i }),
    );

    expect(onTreeChange).toHaveBeenCalledTimes(1);
    const persisted = onTreeChange.mock.calls[0][0];
    const roundTrip = deserialize(serialize(persisted));
    expect(roundTrip.ok).toBe(true);
    if (!roundTrip.ok) {
      throw new Error("expected round-trip to succeed");
    }
    const renamed = collect(roundTrip.tree).find(
      (node) => node.kind === "folder" && node.name === "Renamed Users",
    );
    expect(renamed?.kind).toBe("folder");
    if (renamed?.kind !== "folder") {
      throw new Error("expected the renamed folder");
    }
    // its descendant (profile request) survives the path rewrite.
    expect(renamed.children.some((node) => node.kind === "request")).toBe(true);
  });
});

describe("WorkspaceProvider delete immediate (AC-005, TC-007/008)", () => {
  // AC-005, TC-007 - side-effect-contract: deleting an open request removes it,
  // closes its tab, sets no pendingDelete, and persists.
  it("should remove a request immediately, close its tab, and persist with no pending delete", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({
      onTreeChange,
      initialActiveRequestId: "req-session",
      initialOpenRequestIds: ["req-session"],
    });

    expect(screen.getByTestId("open-count")).toHaveTextContent("1");

    await user.click(
      screen.getByRole("button", { name: /delete session request/i }),
    );

    expect(screen.getByTestId("pending-delete")).toHaveTextContent("none");
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    // tab closed.
    expect(screen.getByTestId("open-count")).toHaveTextContent("0");
    // gone from the tree.
    expect(screen.getByTestId("tree-ids").textContent).not.toContain(
      "req-session",
    );
  });

  // AC-005, TC-008 - side-effect-contract: deleting an empty folder removes it
  // immediately (no dialog), persists.
  it("should remove an empty folder immediately with no pending delete", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    await user.click(
      screen.getByRole("button", { name: /delete empty folder/i }),
    );

    expect(screen.getByTestId("pending-delete")).toHaveTextContent("none");
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("tree-ids").textContent).not.toContain(
      "folder-empty",
    );
  });
});

describe("WorkspaceProvider delete non-empty folder (AC-006, TC-009/010)", () => {
  // AC-006, TC-009 - side-effect-contract: deleting a non-empty folder sets
  // pendingDelete (dialog) without writing; confirm removes the folder + every
  // descendant and closes their tabs.
  it("should set pendingDelete then remove the folder and descendants on confirm", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    // folder-auth contains folder-oauth -> req-token; open that request.
    renderProbe({
      onTreeChange,
      initialActiveRequestId: "req-token",
      initialOpenRequestIds: ["req-token"],
      initialExpandedIds: ["folder-auth", "folder-oauth"],
    });

    await user.click(
      screen.getByRole("button", { name: /delete auth folder/i }),
    );

    // dialog state set, NOTHING written yet, tab still open.
    expect(screen.getByTestId("pending-delete")).toHaveTextContent(
      "folder-auth",
    );
    expect(onTreeChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("open-count")).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: /confirm delete/i }));

    expect(screen.getByTestId("pending-delete")).toHaveTextContent("none");
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    // folder + descendants gone.
    expect(screen.getByTestId("tree-ids").textContent).not.toContain(
      "folder-auth",
    );
    expect(screen.getByTestId("tree-ids").textContent).not.toContain(
      "req-token",
    );
    // the descendant request's tab is closed.
    expect(screen.getByTestId("open-count")).toHaveTextContent("0");
  });

  // AC-006, TC-010 - side-effect-contract: cancelling the pending delete keeps
  // everything (no write).
  it("should keep the folder and write nothing if the pending delete is cancelled", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    await user.click(
      screen.getByRole("button", { name: /delete auth folder/i }),
    );
    expect(screen.getByTestId("pending-delete")).toHaveTextContent(
      "folder-auth",
    );

    await user.click(screen.getByRole("button", { name: /cancel delete/i }));

    expect(screen.getByTestId("pending-delete")).toHaveTextContent("none");
    expect(onTreeChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("tree-ids").textContent).toContain("folder-auth");
  });
});

describe("WorkspaceProvider multi-select delete", () => {
  // side-effect-contract: with several folders multi-selected, deleting one of
  // them targets the WHOLE selection - the confirm dialog lists every selected id
  // and confirm removes them all (not just the clicked one).
  it("should mark the whole selection for delete when a selected node is deleted", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    await user.click(
      screen.getByRole("button", { name: /multi-select two folders/i }),
    );
    expect(screen.getByTestId("selected-ids")).toHaveTextContent(
      "folder-empty,folder-users",
    );

    await user.click(
      screen.getByRole("button", { name: /delete users folder/i }),
    );

    // dialog carries BOTH selected folders (folder-users is non-empty, so a dialog
    // is shown rather than an immediate delete).
    const pending = screen.getByTestId("pending-delete").textContent ?? "";
    expect(pending).toContain("folder-users");
    expect(pending).toContain("folder-empty");
    expect(onTreeChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /confirm delete/i }));

    expect(onTreeChange).toHaveBeenCalledTimes(1);
    const treeIds = screen.getByTestId("tree-ids").textContent ?? "";
    expect(treeIds).not.toContain("folder-users");
    expect(treeIds).not.toContain("folder-empty");
    // an unselected sibling folder survives.
    expect(treeIds).toContain("folder-auth");
  });

  // side-effect-contract: deleting a node that is NOT part of the current
  // selection targets only that node (the selection is irrelevant).
  it("should delete only the clicked node when it is not in the selection", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    // select an unrelated node, then delete a different (empty) folder.
    await user.click(
      screen.getByRole("button", { name: /select users folder/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /delete empty folder/i }),
    );

    // empty folder deletes immediately (no dialog), users folder survives.
    expect(screen.getByTestId("pending-delete")).toHaveTextContent("none");
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    const treeIds = screen.getByTestId("tree-ids").textContent ?? "";
    expect(treeIds).not.toContain("folder-empty");
    expect(treeIds).toContain("folder-users");
  });
});

describe("WorkspaceProvider duplicateNode (AC-007, TC-008/009)", () => {
  // AC-007, TC-009 - side-effect-contract: duplicating a REQUEST inserts a copy
  // after the original, persists, and opens+activates the copy tab.
  it("should insert a request copy after the original, persist, and activate the copy", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    const requestsBefore = Number(
      screen.getByTestId("request-count").textContent ?? "0",
    );

    await user.click(
      screen.getByRole("button", { name: /duplicate profile/i }),
    );

    expect(onTreeChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("request-count")).toHaveTextContent(
      String(requestsBefore + 1),
    );
    // a "<name> copy" request now exists.
    expect(screen.getByTestId("tree-names").textContent).toContain(
      "profile copy",
    );
    // the copy is the active tab (a fresh, non-draft id, not the original).
    const activeId = screen.getByTestId("active-id").textContent ?? "";
    expect(activeId).not.toBe("none");
    expect(activeId).not.toBe("req-profile");
    expect(screen.getByTestId("open-ids").textContent).toContain(activeId);
  });

  // AC-007, TC-008 - side-effect-contract: duplicating a FOLDER persists once,
  // inserts a "<name> copy" folder, selects + expands the copy, and opens NO tab
  // (the previously-active request tab is left untouched).
  it("should duplicate a folder: persist once, select+expand the copy, and open no tab", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    // an unrelated request tab is active; duplicating a folder must not change it.
    renderProbe({
      onTreeChange,
      initialActiveRequestId: "req-session",
      initialOpenRequestIds: ["req-session"],
    });

    const foldersBefore = Number(
      screen.getByTestId("folder-count").textContent ?? "0",
    );

    await user.click(
      screen.getByRole("button", { name: /duplicate users folder/i }),
    );

    // persisted exactly once.
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    // one more folder in the tree, named "Users copy".
    expect(screen.getByTestId("folder-count")).toHaveTextContent(
      String(foldersBefore + 1),
    );
    expect(screen.getByTestId("tree-names").textContent).toContain(
      "Users copy",
    );

    // find the copy's fresh id from the persisted tree.
    const persisted = onTreeChange.mock.calls[0][0];
    const copy = collect(persisted).find(
      (node) => node.kind === "folder" && node.name === "Users copy",
    );
    if (!copy) {
      throw new Error("expected a 'Users copy' folder");
    }
    // the copy is selected + expanded.
    expect(screen.getByTestId("selected-id")).toHaveTextContent(copy.id);
    expect(screen.getByTestId("expanded-ids").textContent).toContain(copy.id);

    // NO request tab was opened: the active tab is still the unrelated request.
    expect(screen.getByTestId("active-id")).toHaveTextContent("req-session");
    expect(screen.getByTestId("open-count")).toHaveTextContent("1");
  });
});

describe("WorkspaceProvider persist failure (AC-010, TC-015)", () => {
  // AC-010, TC-015 - side-effect-contract: a {ok:false} write keeps the change
  // in the tree and appends a "[workspace] failed to persist <label>" line.
  it("should keep the change and append a failed-to-persist console line if the write fails", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi
      .fn<OnTreeChange>()
      .mockResolvedValue({ ok: false, error: "EACCES" });
    renderProbe({ onTreeChange });

    await user.click(
      screen.getByRole("button", { name: /duplicate profile/i }),
    );

    // in-memory change kept.
    expect(screen.getByTestId("tree-names").textContent).toContain(
      "profile copy",
    );
    // the failed-to-persist line is appended.
    expect(await screen.findByText(/failed to persist/i)).toBeInTheDocument();
  });

  // AC-010, spec §6 - side-effect-contract: with NO onTreeChange (browser dev,
  // no Tauri host) an op still folds into the in-memory tree (and no
  // failed-to-persist line is logged).
  it("should fold the change into the in-memory tree if there is no onTreeChange", async () => {
    const user = userEvent.setup();
    // no onTreeChange prop -> the in-session branch.
    renderProbe({});

    await user.click(
      screen.getByRole("button", { name: /duplicate profile/i }),
    );

    // the copy exists in-memory.
    expect(screen.getByTestId("tree-names").textContent).toContain(
      "profile copy",
    );
    // nothing failed (no persistence attempted).
    expect(screen.queryByText(/failed to persist/i)).not.toBeInTheDocument();
  });
});
