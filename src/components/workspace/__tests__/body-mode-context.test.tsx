import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import type { KeyValue, TreeNode } from "@/lib/workspace/model";
import { bodyFixtureTree, JSON_BODY } from "./fixtures";

// New body-mode surface on the context (spec §5). A probe component reads
// activeRequest.body.active / activeRequest.body.types.form and calls the new
// setRequestBodyMode / setRequestForm actions.
type BodyMode = "json" | "none" | "form" | "multipart";

type BodyModeSurface = ReturnType<typeof useWorkspace> & {
  setRequestBodyMode: (id: string, mode: BodyMode) => void;
  setRequestForm: (id: string, rows: KeyValue[]) => void;
  saveActiveRequest: () => void;
};

const SEED_ROWS: KeyValue[] = [{ key: "a", value: "1" }];

function BodyModeProbe() {
  const ctx = useWorkspace() as BodyModeSurface;
  const {
    setRequestBodyMode,
    setRequestForm,
    saveActiveRequest,
    activeRequest,
    activeRequestId,
    dirtyRequestIds,
  } = ctx;

  const node = activeRequest;

  return (
    <div>
      <span data-testid="active-id">{activeRequestId ?? "none"}</span>
      <span data-testid="active-body">{`[${node?.body.types.json ?? "none"}]`}</span>
      <span data-testid="active-mode">{node?.body.active ?? "absent"}</span>
      <span data-testid="active-form">
        {JSON.stringify(node?.body.types.form ?? [])}
      </span>
      <span data-testid="dirty-ids">
        {[...dirtyRequestIds].sort().join(",") || "clean"}
      </span>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestBodyMode(activeRequestId, "form");
          }
        }}
      >
        set form
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestBodyMode(activeRequestId, "multipart");
          }
        }}
      >
        set multipart
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestBodyMode(activeRequestId, "json");
          }
        }}
      >
        set json
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestForm(activeRequestId, SEED_ROWS);
          }
        }}
      >
        seed rows
      </button>
      <button type="button" onClick={() => saveActiveRequest()}>
        save request
      </button>
    </div>
  );
}

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

function renderProbe(
  initialActiveRequestId = "req-json-body",
  onTreeChange?: OnTreeChange,
) {
  return render(
    <WorkspaceProvider
      tree={bodyFixtureTree}
      initialActiveRequestId={initialActiveRequestId}
      onTreeChange={onTreeChange}
    >
      <BodyModeProbe />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceProvider body mode switching", () => {
  // AC-008, TC-006 - behavior: json text -> form -> set rows -> multipart keeps
  // the shared rows -> back to json keeps the JSON text in its own slot.
  it("should preserve form rows across form<->multipart and the JSON text across json switches", async () => {
    const user = userEvent.setup();
    renderProbe();

    // starts as json with the fixture body.
    expect(screen.getByTestId("active-body")).toHaveTextContent(
      `[${JSON_BODY}]`,
      { normalizeWhitespace: false },
    );

    await user.click(screen.getByRole("button", { name: /set form/i }));
    expect(screen.getByTestId("active-mode")).toHaveTextContent("form");

    await user.click(screen.getByRole("button", { name: /seed rows/i }));
    expect(screen.getByTestId("active-form")).toHaveTextContent(
      JSON.stringify(SEED_ROWS),
    );

    // form -> multipart keeps the shared rows.
    await user.click(screen.getByRole("button", { name: /set multipart/i }));
    expect(screen.getByTestId("active-mode")).toHaveTextContent("multipart");
    expect(screen.getByTestId("active-form")).toHaveTextContent(
      JSON.stringify(SEED_ROWS),
    );

    // back to json: the JSON text is still present in its own slot.
    await user.click(screen.getByRole("button", { name: /set json/i }));
    expect(screen.getByTestId("active-mode")).toHaveTextContent("json");
    expect(screen.getByTestId("active-body")).toHaveTextContent(
      `[${JSON_BODY}]`,
      { normalizeWhitespace: false },
    );
  });
});

describe("WorkspaceProvider body mode dirty", () => {
  // AC-010 - side-effect-contract: changing the body mode marks the request
  // dirty and surfaces its new mode on activeRequest.
  it("should mark the request dirty and reflect the new mode if the body mode is changed", async () => {
    const user = userEvent.setup();
    renderProbe();

    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");

    await user.click(screen.getByRole("button", { name: /set form/i }));

    expect(screen.getByTestId("active-mode")).toHaveTextContent("form");
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("req-json-body");
  });

  // AC-010 - side-effect-contract: editing a form row marks the request dirty.
  // Form rows only apply in form/multipart mode, so switch first, then seed.
  it("should mark the request dirty if a form row is set", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("button", { name: /set form/i }));
    await user.click(screen.getByRole("button", { name: /seed rows/i }));

    expect(screen.getByTestId("active-form")).toHaveTextContent(
      JSON.stringify(SEED_ROWS),
    );
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("req-json-body");
  });

  // AC-010 - side-effect-contract: Mod+S folds the body.active + body.types.form
  // override into the tree handed to onTreeChange and clears the dirty flag.
  it("should persist body.active and body.types.form via the save seam if the request is saved", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe("req-json-body", onTreeChange);

    await user.click(screen.getByRole("button", { name: /set form/i }));
    await user.click(screen.getByRole("button", { name: /seed rows/i }));
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("req-json-body");

    await user.click(screen.getByRole("button", { name: /save request/i }));

    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    const persisted = onTreeChange.mock.calls[0][0];
    const saved = persisted.find(
      (node): node is Extract<TreeNode, { kind: "request" }> =>
        node.kind === "request" && node.id === "req-json-body",
    );
    expect(saved?.body.active).toBe("form");
    expect(saved?.body.types.form).toEqual(SEED_ROWS);
  });
});
