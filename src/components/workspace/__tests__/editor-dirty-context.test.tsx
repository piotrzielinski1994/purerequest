import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import type { TreeNode } from "@/lib/workspace/model";
import { bodyFixtureTree } from "./fixtures";

type ActiveEditor = {
  scope: { kind: "config"; id: string } | { kind: "env" };
  isDirty: boolean;
  canSave: boolean;
  save: () => void;
  commitToTree?: (tree: TreeNode[]) => TreeNode[];
};

type EditorSurface = ReturnType<typeof useWorkspace> & {
  registerActiveEditor: (editor: ActiveEditor | null) => void;
  saveActiveEditor: () => boolean;
  editorDirty: boolean;
  requestCloseEditor: () => void;
  requestCloseRequest: (id: string) => void;
  confirmPendingClose: () => void;
  savePendingClose: () => void;
  cancelPendingClose: () => void;
};

// Drives the editor channel directly (a real CodeMirror editor can't be typed
// into under jsdom - learnings.md). Registers/clears an ActiveEditor descriptor
// and reads back the derived dirty surface, mirroring the provider probe pattern.
function EditorProbe({ save = () => {} }: { save?: () => void }) {
  const ctx = useWorkspace() as EditorSurface;
  const {
    registerActiveEditor,
    saveActiveEditor,
    editorDirty,
    dirtyRequestIds,
    pendingClose,
    editTarget,
    requestCloseEditor,
    requestCloseRequest,
    confirmPendingClose,
    savePendingClose,
    cancelPendingClose,
  } = ctx;

  const pendingLabel = pendingClose === null ? "none" : pendingClose.kind;

  return (
    <div>
      <span data-testid="editor-dirty">{String(editorDirty)}</span>
      <span data-testid="dirty-ids">
        {[...dirtyRequestIds].sort().join(",") || "clean"}
      </span>
      <span data-testid="pending-close">{pendingLabel}</span>
      <span data-testid="edit-target">{editTarget?.kind ?? "none"}</span>
      <button
        type="button"
        onClick={() =>
          registerActiveEditor({
            scope: { kind: "config", id: "req-json-body" },
            isDirty: true,
            canSave: true,
            save,
            commitToTree: (tree) =>
              tree.map((node) =>
                node.id === "req-json-body" && node.kind === "request"
                  ? { ...node, url: "https://committed.test" }
                  : node,
              ),
          })
        }
      >
        register dirty config
      </button>
      <button
        type="button"
        onClick={() =>
          registerActiveEditor({
            scope: { kind: "config", id: "req-json-body" },
            isDirty: false,
            canSave: true,
            save,
          })
        }
      >
        register clean config
      </button>
      <button
        type="button"
        onClick={() =>
          registerActiveEditor({
            scope: { kind: "env" },
            isDirty: true,
            canSave: true,
            save,
          })
        }
      >
        register dirty env
      </button>
      <button type="button" onClick={() => registerActiveEditor(null)}>
        unmount editor
      </button>
      <button type="button" onClick={() => saveActiveEditor()}>
        save editor
      </button>
      <button type="button" onClick={() => requestCloseEditor()}>
        close editor
      </button>
      <button
        type="button"
        onClick={() => requestCloseRequest("req-json-body")}
      >
        close request A
      </button>
      <button type="button" onClick={() => confirmPendingClose()}>
        confirm close
      </button>
      <button type="button" onClick={() => savePendingClose()}>
        save pending close
      </button>
      <button type="button" onClick={() => cancelPendingClose()}>
        cancel close
      </button>
    </div>
  );
}

function renderProbe(
  save?: () => void,
  onTreeChange?: (
    tree: TreeNode[],
  ) => Promise<{ ok: true } | { ok: false; error: string }>,
) {
  return render(
    <WorkspaceProvider
      tree={bodyFixtureTree}
      initialActiveRequestId="req-json-body"
      initialOpenRequestIds={["req-json-body"]}
      onTreeChange={onTreeChange}
    >
      <EditorProbe save={save} />
    </WorkspaceProvider>,
  );
}

describe("editor dirtiness (config + .env)", () => {
  // AC-009 - behavior: a mounted, dirty request-config editor marks its request dirty.
  it("should mark the request dirty if its config editor is dirty", async () => {
    const user = userEvent.setup();
    renderProbe();

    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");

    await user.click(
      screen.getByRole("button", { name: /register dirty config/i }),
    );

    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("req-json-body");
  });

  // AC-009 - behavior: a clean config editor leaves the request clean.
  it("should not mark the request dirty if its config editor matches the saved config", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(
      screen.getByRole("button", { name: /register clean config/i }),
    );

    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");
    expect(screen.getByTestId("editor-dirty")).toHaveTextContent("false");
  });

  // AC-009 - behavior: unmounting the editor clears the derived dirtiness.
  it("should clear the request dirty flag if the dirty config editor unmounts", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(
      screen.getByRole("button", { name: /register dirty config/i }),
    );
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("req-json-body");

    await user.click(screen.getByRole("button", { name: /unmount editor/i }));
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");
  });

  // AC-010 - behavior: a dirty .env editor exposes editorDirty (drives the .env tab dot).
  it("should report editorDirty if the .env editor is dirty", async () => {
    const user = userEvent.setup();
    renderProbe();

    expect(screen.getByTestId("editor-dirty")).toHaveTextContent("false");

    await user.click(
      screen.getByRole("button", { name: /register dirty env/i }),
    );

    expect(screen.getByTestId("editor-dirty")).toHaveTextContent("true");
  });

  // AC-013 - behavior: saveActiveEditor invokes the registered editor's save and
  // returns true; false when none is mounted.
  it("should run the active editor save and return true, false when none mounted", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    renderProbe(save);

    await user.click(screen.getByRole("button", { name: /save editor/i }));
    expect(save).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: /register dirty config/i }),
    );
    await user.click(screen.getByRole("button", { name: /save editor/i }));
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("editor close interception", () => {
  // AC-011 - behavior: closing a dirty editor prompts to confirm (kind:editor).
  it("should prompt to confirm if a dirty editor is closed", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(
      screen.getByRole("button", { name: /register dirty env/i }),
    );
    await user.click(screen.getByRole("button", { name: /close editor/i }));

    expect(screen.getByTestId("pending-close")).toHaveTextContent("editor");
  });

  // AC-011 - behavior: closing a clean editor does not prompt.
  it("should not prompt if a clean editor is closed", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(
      screen.getByRole("button", { name: /register clean config/i }),
    );
    await user.click(screen.getByRole("button", { name: /close editor/i }));

    expect(screen.getByTestId("pending-close")).toHaveTextContent("none");
  });

  // AC-012 - behavior: closing a request whose config editor is dirty prompts to confirm.
  it("should prompt to confirm if a request with a dirty config editor is closed", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(
      screen.getByRole("button", { name: /register dirty config/i }),
    );
    await user.click(screen.getByRole("button", { name: /close request A/i }));

    expect(screen.getByTestId("pending-close")).toHaveTextContent("one");
  });
});

describe("editor popup save (savePendingClose)", () => {
  // AC-011 - behavior: popup Save on a dirty .env editor runs its save() and
  // closes the editor (env has no commitToTree - it writes envText directly).
  it("should run save() and close the editor if the .env popup save is used", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    renderProbe(save);

    await user.click(
      screen.getByRole("button", { name: /register dirty env/i }),
    );
    // simulate the editor being the open content view.
    await user.click(screen.getByRole("button", { name: /close editor/i }));
    expect(screen.getByTestId("pending-close")).toHaveTextContent("editor");

    await user.click(
      screen.getByRole("button", { name: /save pending close/i }),
    );

    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("pending-close")).toHaveTextContent("none");
  });

  // AC-011 - behavior: popup Save on a dirty config editor folds its
  // commitToTree into one persisted write.
  it("should commit the config editor to the tree if the editor popup save is used", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi
      .fn<
        (
          tree: TreeNode[],
        ) => Promise<{ ok: true } | { ok: false; error: string }>
      >()
      .mockResolvedValue({ ok: true });
    renderProbe(undefined, onTreeChange);

    await user.click(
      screen.getByRole("button", { name: /register dirty config/i }),
    );
    await user.click(screen.getByRole("button", { name: /close editor/i }));

    await user.click(
      screen.getByRole("button", { name: /save pending close/i }),
    );

    expect(onTreeChange).toHaveBeenCalledTimes(1);
    const saved = onTreeChange.mock.calls[0][0].find(
      (n) => n.id === "req-json-body",
    );
    expect(saved?.kind === "request" && saved.url).toBe(
      "https://committed.test",
    );
    expect(screen.getByTestId("pending-close")).toHaveTextContent("none");
  });
});
