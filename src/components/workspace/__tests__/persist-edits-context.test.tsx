import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { deserialize, serialize } from "@/lib/workspace/disk-format";
import type { TreeNode } from "@/lib/workspace/model";
import { bodyFixtureTree, jsonBodyRequest } from "./fixtures";

// New persist-edits surface on the context; cast through an augmented type so
// the probe compiles before workspace-context.tsx is extended (RED phase).
type PendingClose = { kind: "one"; id: string } | { kind: "all" } | null;

type ActiveEditor = {
  scope: { kind: "config"; id: string } | { kind: "env" };
  isDirty: boolean;
  save: () => void;
};

type PersistSurface = ReturnType<typeof useWorkspace> & {
  dirtyRequestIds: Set<string>;
  saveActiveRequest: () => void;
  saveActiveEditor: () => boolean;
  registerActiveEditor: (editor: ActiveEditor | null) => void;
  pendingClose: PendingClose;
  requestCloseRequest: (id: string) => void;
  requestCloseAll: () => void;
  confirmPendingClose: () => void;
  cancelPendingClose: () => void;
};

function PersistProbe({ editorSaver }: { editorSaver?: () => void }) {
  const [editorResult, setEditorResult] = useState<boolean | "unset">("unset");
  const ctx = useWorkspace() as PersistSurface;
  const {
    setRequestUrl,
    setRequestMethod,
    setRequestBody,
    setActiveRequest,
    selectNode,
    newRequest,
    activeRequest,
    activeRequestId,
    openRequestIds,
    dirtyRequestIds,
    saveActiveRequest,
    saveActiveEditor,
    registerActiveEditor,
    pendingClose,
    requestCloseRequest,
    requestCloseAll,
    confirmPendingClose,
    cancelPendingClose,
  } = ctx;

  const pendingLabel =
    pendingClose === null
      ? "none"
      : pendingClose.kind === "all"
        ? "all"
        : `one:${pendingClose.id}`;

  return (
    <div>
      <span data-testid="active-id">{activeRequestId ?? "none"}</span>
      <span data-testid="active-url">{`[${activeRequest?.url ?? "none"}]`}</span>
      <span data-testid="active-method">{activeRequest?.method ?? "none"}</span>
      <span data-testid="active-body">{`[${activeRequest?.body.types.json ?? "none"}]`}</span>
      <span data-testid="open-count">{openRequestIds.length}</span>
      <span data-testid="dirty-ids">
        {[...dirtyRequestIds].sort().join(",") || "clean"}
      </span>
      <span data-testid="pending-close">{pendingLabel}</span>
      <span data-testid="last-save-editor-result">{String(editorResult)}</span>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestUrl(activeRequestId, "https://edited.test/path");
          }
        }}
      >
        edit url
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestMethod(activeRequestId, "PUT");
          }
        }}
      >
        edit method
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestBody(activeRequestId, "EDITED-BODY");
          }
        }}
      >
        edit body
      </button>
      <button
        type="button"
        onClick={() => {
          // revert url back to the on-disk fixture value of req-json-body
          if (activeRequestId !== null) {
            setRequestUrl(activeRequestId, jsonBodyRequest.url);
          }
        }}
      >
        revert url
      </button>
      <button type="button" onClick={() => saveActiveRequest()}>
        save request
      </button>
      <button
        type="button"
        onClick={() => {
          setEditorResult(saveActiveEditor());
        }}
      >
        save editor
      </button>
      <button
        type="button"
        onClick={() =>
          registerActiveEditor(
            editorSaver
              ? { scope: { kind: "env" }, isDirty: true, save: editorSaver }
              : null,
          )
        }
      >
        register saver
      </button>
      <button type="button" onClick={() => registerActiveEditor(null)}>
        unregister saver
      </button>
      <button type="button" onClick={() => setActiveRequest("req-json-body")}>
        activate A
      </button>
      <button type="button" onClick={() => setActiveRequest("req-other-body")}>
        activate B
      </button>
      <button type="button" onClick={() => selectNode("req-json-body")}>
        open A
      </button>
      <button type="button" onClick={() => newRequest()}>
        new request
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            requestCloseRequest(activeRequestId);
          }
        }}
      >
        request close active
      </button>
      <button type="button" onClick={() => requestCloseAll()}>
        request close all
      </button>
      <button type="button" onClick={() => confirmPendingClose()}>
        confirm close
      </button>
      <button type="button" onClick={() => cancelPendingClose()}>
        cancel close
      </button>
    </div>
  );
}

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

function renderProbe(
  props: {
    initialActiveRequestId?: string;
    onTreeChange?: OnTreeChange;
    editorSaver?: () => void;
    initialOpenRequestIds?: string[];
  } = {},
) {
  const { editorSaver, ...providerProps } = props;
  return render(
    <WorkspaceProvider tree={bodyFixtureTree} {...providerProps}>
      <PersistProbe editorSaver={editorSaver} />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceProvider saveActiveRequest", () => {
  // AC-001, AC-007, TC-001 - side-effect-contract: a successful save folds the
  // url/method/body override into the tree, clears the override, and persists
  // via onTreeChange; the value survives a tab switch.
  it("should fold url/method/body into the tree and persist if the active request is saved", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ initialActiveRequestId: "req-json-body", onTreeChange });

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    await user.click(screen.getByRole("button", { name: /edit method/i }));
    await user.click(screen.getByRole("button", { name: /edit body/i }));
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("req-json-body");

    await user.click(screen.getByRole("button", { name: /save request/i }));

    // override folded + cleared -> no longer dirty.
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");
    expect(onTreeChange).toHaveBeenCalledTimes(1);

    // value survives switching away and back (now lives in the tree).
    await user.click(screen.getByRole("button", { name: /activate B/i }));
    await user.click(screen.getByRole("button", { name: /activate A/i }));
    expect(screen.getByTestId("active-url")).toHaveTextContent(
      "[https://edited.test/path]",
    );
    expect(screen.getByTestId("active-method")).toHaveTextContent("PUT");
    expect(screen.getByTestId("active-body")).toHaveTextContent(
      "[EDITED-BODY]",
    );
  });

  // AC-001, TC-001 - side-effect-contract: the tree handed to onTreeChange
  // serializes + deserializes back to the edited url/method/body (round-trip).
  it("should persist a tree that round-trips to the edited values if the request is saved", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ initialActiveRequestId: "req-json-body", onTreeChange });

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    await user.click(screen.getByRole("button", { name: /edit method/i }));
    await user.click(screen.getByRole("button", { name: /edit body/i }));
    await user.click(screen.getByRole("button", { name: /save request/i }));

    const persistedTree = onTreeChange.mock.calls[0][0];
    const roundTrip = deserialize(serialize(persistedTree));
    expect(roundTrip.ok).toBe(true);
    if (!roundTrip.ok) {
      throw new Error("expected round-trip to succeed");
    }
    // find the formerly-json-body request by its edited url (id slugs change on
    // re-serialize, so match on the persisted field values instead).
    const collect = (nodes: TreeNode[]): TreeNode[] =>
      nodes.flatMap((node) =>
        node.kind === "folder" ? collect(node.children) : [node],
      );
    const saved = collect(roundTrip.tree).find(
      (node) =>
        node.kind === "request" && node.url === "https://edited.test/path",
    );
    expect(saved).toBeDefined();
    if (saved?.kind !== "request") {
      throw new Error("expected the edited request in the round-tripped tree");
    }
    expect(saved.method).toBe("PUT");
    expect(saved.body.types.json).toBe("EDITED-BODY");
  });

  // AC-007, edge - behavior: with no onTreeChange host the save still folds the
  // edit into the tree in-memory and clears the dirty flag.
  it("should fold the edit in-memory and clear dirty if no onTreeChange is provided", async () => {
    const user = userEvent.setup();
    renderProbe({ initialActiveRequestId: "req-json-body" });

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("req-json-body");

    await user.click(screen.getByRole("button", { name: /save request/i }));

    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");
    await user.click(screen.getByRole("button", { name: /activate B/i }));
    await user.click(screen.getByRole("button", { name: /activate A/i }));
    expect(screen.getByTestId("active-url")).toHaveTextContent(
      "[https://edited.test/path]",
    );
  });

  // AC-007, TC-008 - side-effect-contract: a failed disk write keeps the edit
  // in the tree (no longer dirty) and appends the console line.
  it("should append the console line and clear dirty if onTreeChange fails", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi
      .fn<OnTreeChange>()
      .mockResolvedValue({ ok: false, error: "EACCES" });
    render(
      <WorkspaceProvider
        tree={bodyFixtureTree}
        initialActiveRequestId="req-json-body"
        consoleLines={[]}
        onTreeChange={onTreeChange}
      >
        <PersistProbe />
        <ConsoleProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    await user.click(screen.getByRole("button", { name: /save request/i }));

    // in-memory edit kept, dot clears (in-memory is the source of truth).
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");
    expect(
      await screen.findByText(/failed to persist edits: EACCES/i),
    ).toBeInTheDocument();
  });

  // behavior: new request opens a SESSION DRAFT (no disk write on create). The
  // fresh draft is clean; an edit dirties it; saving promotes it to disk (the
  // first write) and clears the dot.
  it("should open a clean draft on new request, dirty it on edit, and persist on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe({ initialActiveRequestId: "req-json-body", onTreeChange });

    await user.click(screen.getByRole("button", { name: /new request/i }));
    // nothing written on create (draft only).
    expect(onTreeChange).not.toHaveBeenCalled();
    const newId = screen.getByTestId("active-id").textContent ?? "";
    // a freshly created draft has no pending override -> not dirty.
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    // editing it now makes it dirty.
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent(newId);

    await user.click(screen.getByRole("button", { name: /save request/i }));
    // save promotes the draft to disk (first write) and it is clean again.
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");
  });
});

describe("WorkspaceProvider dirtyRequestIds", () => {
  // AC-004, TC-003 - behavior: reverting an edit back to the on-disk value
  // clears the dirty flag (override equals base => not dirty).
  it("should drop a request from the dirty set if its edit is reverted to the base value", async () => {
    const user = userEvent.setup();
    renderProbe({ initialActiveRequestId: "req-json-body" });

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("req-json-body");

    await user.click(screen.getByRole("button", { name: /revert url/i }));
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");
  });

  // AC-004 - behavior: only the edited saved request appears in the dirty set.
  it("should include only the edited saved request in the dirty set", async () => {
    const user = userEvent.setup();
    renderProbe({ initialActiveRequestId: "req-json-body" });

    await user.click(screen.getByRole("button", { name: /edit body/i }));

    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("req-json-body");
    expect(screen.getByTestId("dirty-ids")).not.toHaveTextContent(
      "req-other-body",
    );
  });
});

describe("WorkspaceProvider saveActiveEditor precedence flag", () => {
  // AC-002, AC-003, TC-002 - behavior: saveActiveEditor returns false when no
  // editor-saver is registered, true when one is.
  it("should return false if no editor-saver is registered and true if one is", async () => {
    const user = userEvent.setup();
    const editorSaver = vi.fn();
    renderProbe({ initialActiveRequestId: "req-json-body", editorSaver });

    await user.click(screen.getByRole("button", { name: /save editor/i }));
    expect(screen.getByTestId("last-save-editor-result")).toHaveTextContent(
      "false",
    );
    expect(editorSaver).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "register saver" }));
    await user.click(screen.getByRole("button", { name: /save editor/i }));

    expect(screen.getByTestId("last-save-editor-result")).toHaveTextContent(
      "true",
    );
    expect(editorSaver).toHaveBeenCalledTimes(1);
  });
});

describe("WorkspaceProvider close interception", () => {
  // AC-005, TC-006 - behavior: closing a clean request closes it immediately
  // (no pending-close dialog state set).
  it("should close immediately and set no pending-close if the active request is clean", async () => {
    const user = userEvent.setup();
    renderProbe({
      initialActiveRequestId: "req-json-body",
      initialOpenRequestIds: ["req-json-body", "req-other-body"],
    });

    expect(screen.getByTestId("open-count")).toHaveTextContent("2");

    await user.click(
      screen.getByRole("button", { name: /request close active/i }),
    );

    expect(screen.getByTestId("pending-close")).toHaveTextContent("none");
    expect(screen.getByTestId("open-count")).toHaveTextContent("1");
  });

  // AC-005, TC-004 - behavior: closing a dirty request sets pendingClose and
  // does NOT close the tab yet.
  it("should set pendingClose and keep the tab if the active request is dirty", async () => {
    const user = userEvent.setup();
    renderProbe({
      initialActiveRequestId: "req-json-body",
      initialOpenRequestIds: ["req-json-body", "req-other-body"],
    });

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    await user.click(
      screen.getByRole("button", { name: /request close active/i }),
    );

    expect(screen.getByTestId("pending-close")).toHaveTextContent(
      "one:req-json-body",
    );
    // tab still open.
    expect(screen.getByTestId("open-count")).toHaveTextContent("2");
  });

  // AC-005, TC-005 - side-effect-contract: confirmPendingClose closes the tab
  // and clears pendingClose.
  it("should close the tab and clear pendingClose if a pending one-close is confirmed", async () => {
    const user = userEvent.setup();
    renderProbe({
      initialActiveRequestId: "req-json-body",
      initialOpenRequestIds: ["req-json-body", "req-other-body"],
    });

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    await user.click(
      screen.getByRole("button", { name: /request close active/i }),
    );
    expect(screen.getByTestId("pending-close")).toHaveTextContent(
      "one:req-json-body",
    );

    await user.click(screen.getByRole("button", { name: /confirm close/i }));

    expect(screen.getByTestId("pending-close")).toHaveTextContent("none");
    expect(screen.getByTestId("open-count")).toHaveTextContent("1");
  });

  // AC-005, TC-004 - side-effect-contract: cancelPendingClose keeps the tab,
  // keeps the edit, and clears pendingClose.
  it("should keep the tab and its edit and clear pendingClose if the pending close is cancelled", async () => {
    const user = userEvent.setup();
    renderProbe({
      initialActiveRequestId: "req-json-body",
      initialOpenRequestIds: ["req-json-body", "req-other-body"],
    });

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    await user.click(
      screen.getByRole("button", { name: /request close active/i }),
    );

    await user.click(screen.getByRole("button", { name: /cancel close/i }));

    expect(screen.getByTestId("pending-close")).toHaveTextContent("none");
    expect(screen.getByTestId("open-count")).toHaveTextContent("2");
    // edit intact + still dirty.
    expect(screen.getByTestId("active-url")).toHaveTextContent(
      "[https://edited.test/path]",
    );
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("req-json-body");
  });

  // AC-006, TC-007 - behavior: requestCloseAll with a dirty tab sets a kind:"all"
  // pending close instead of closing immediately.
  it("should set a kind:all pending close if any open request is dirty when closing all", async () => {
    const user = userEvent.setup();
    renderProbe({
      initialActiveRequestId: "req-json-body",
      initialOpenRequestIds: ["req-json-body", "req-other-body"],
    });

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    await user.click(
      screen.getByRole("button", { name: /request close all/i }),
    );

    expect(screen.getByTestId("pending-close")).toHaveTextContent("all");
    // nothing closed yet.
    expect(screen.getByTestId("open-count")).toHaveTextContent("2");
  });

  // AC-006 - behavior: requestCloseAll with no dirty tab closes everything
  // immediately (no dialog).
  it("should close all immediately if no open request is dirty when closing all", async () => {
    const user = userEvent.setup();
    renderProbe({
      initialActiveRequestId: "req-json-body",
      initialOpenRequestIds: ["req-json-body", "req-other-body"],
    });

    await user.click(
      screen.getByRole("button", { name: /request close all/i }),
    );

    expect(screen.getByTestId("pending-close")).toHaveTextContent("none");
    expect(screen.getByTestId("open-count")).toHaveTextContent("0");
  });

  // AC-008 (tree-crud) - behavior: a freshly created request is clean (already on
  // disk), so closing it opens NO pending-close dialog and the tab just closes.
  it("should close a freshly created request immediately with no pending close", async () => {
    const user = userEvent.setup();
    renderProbe({ initialActiveRequestId: "req-json-body" });

    await user.click(screen.getByRole("button", { name: /new request/i }));
    expect(screen.getByTestId("active-id")).not.toHaveTextContent(/draft-/);

    await user.click(
      screen.getByRole("button", { name: /request close active/i }),
    );

    expect(screen.getByTestId("pending-close")).toHaveTextContent("none");
    // back to the previously open request; the new tab is gone.
    expect(screen.getByTestId("active-id")).toHaveTextContent("req-json-body");
  });

  // AC-008, AC-011 - behavior: editing a freshly created request makes it dirty,
  // so closing it then prompts to confirm (guards against silent loss).
  it("should prompt to confirm if an edited new request is closed", async () => {
    const user = userEvent.setup();
    renderProbe({ initialActiveRequestId: "req-json-body" });

    await user.click(screen.getByRole("button", { name: /new request/i }));
    const newId = screen.getByTestId("active-id").textContent ?? "";
    await user.click(screen.getByRole("button", { name: /edit url/i }));

    await user.click(
      screen.getByRole("button", { name: /request close active/i }),
    );

    expect(screen.getByTestId("pending-close")).toHaveTextContent(
      `one:${newId}`,
    );
  });

  // AC-006, edge - behavior: confirming a kind:all pending close closes every tab.
  it("should close every tab and clear pendingClose if a pending all-close is confirmed", async () => {
    const user = userEvent.setup();
    renderProbe({
      initialActiveRequestId: "req-json-body",
      initialOpenRequestIds: ["req-json-body", "req-other-body"],
    });

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    await user.click(
      screen.getByRole("button", { name: /request close all/i }),
    );
    await user.click(screen.getByRole("button", { name: /confirm close/i }));

    expect(screen.getByTestId("pending-close")).toHaveTextContent("none");
    expect(screen.getByTestId("open-count")).toHaveTextContent("0");
  });
});

function ConsoleProbe() {
  const { consoleLines } = useWorkspace();
  return (
    <ul>
      {consoleLines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
}
