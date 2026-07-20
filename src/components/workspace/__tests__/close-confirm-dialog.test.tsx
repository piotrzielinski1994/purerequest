import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { CloseConfirmDialog } from "@/components/workspace/close-confirm-dialog";
import type { TreeNode } from "@/lib/workspace/model";
import { bodyFixtureTree } from "./fixtures";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

type CloseSurface = ReturnType<typeof useWorkspace> & {
  requestCloseRequest: (id: string) => void;
  requestCloseAll: () => void;
};

// Drives the close interception so the dialog has a non-null pendingClose to
// render; mirrors how other component tests trigger context actions via buttons.
function CloseDriver() {
  const ctx = useWorkspace() as CloseSurface;
  const {
    setRequestUrl,
    requestCloseRequest,
    requestCloseAll,
    openRequestIds,
  } = ctx;
  return (
    <div>
      <span data-testid="open-count">{openRequestIds.length}</span>
      <button
        type="button"
        onClick={() => setRequestUrl("req-json-body", "https://dirty.test/x")}
      >
        dirty A
      </button>
      <button
        type="button"
        onClick={() => setRequestUrl("req-other-body", "https://dirty.test/y")}
      >
        dirty B
      </button>
      <button
        type="button"
        onClick={() => requestCloseRequest("req-json-body")}
      >
        close-one A
      </button>
      <button type="button" onClick={() => requestCloseAll()}>
        close-every tab
      </button>
    </div>
  );
}

function renderDialog(onTreeChange?: OnTreeChange) {
  return render(
    <WorkspaceProvider
      tree={bodyFixtureTree}
      initialActiveRequestId="req-json-body"
      initialOpenRequestIds={["req-json-body", "req-other-body"]}
      onTreeChange={onTreeChange}
    >
      <CloseDriver />
      <CloseConfirmDialog />
    </WorkspaceProvider>,
  );
}

describe("CloseConfirmDialog", () => {
  // AC-005 - behavior: the dialog stays hidden until a dirty close is requested.
  it("should not render the dialog if there is no pending close", () => {
    renderDialog();

    expect(
      screen.queryByRole("dialog", { name: /unsaved changes/i }),
    ).not.toBeInTheDocument();
  });

  // AC-005, TC-004 - behavior: requesting to close a dirty request shows the
  // dialog titled "Unsaved changes" naming that request.
  it("should show the dialog naming the request if a dirty single close is pending", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: /dirty A/i }));
    await user.click(screen.getByRole("button", { name: /close-one A/i }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /unsaved changes/i }),
    ).toBeInTheDocument();
    // body mentions the dirty request's name (json-body).
    expect(dialog).toHaveTextContent(/json-body/i);
  });

  // AC-005, TC-004 - side-effect-contract: Cancel dismisses the dialog and keeps
  // the tab open.
  it("should close the dialog and keep the tab if Cancel is clicked", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: /dirty A/i }));
    await user.click(screen.getByRole("button", { name: /close-one A/i }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // both tabs still open.
    expect(screen.getByTestId("open-count")).toHaveTextContent("2");
  });

  // AC-005, TC-005 - side-effect-contract: Discard closes the tab and dismisses
  // the dialog.
  it("should close the tab and dismiss the dialog if Discard is clicked", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: /dirty A/i }));
    await user.click(screen.getByRole("button", { name: /close-one A/i }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /discard/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("open-count")).toHaveTextContent("1");
  });

  // AC-006, TC-007 - behavior: a pending close-all dialog mentions the count of
  // dirty requests.
  it("should show the dirty-request count if a close-all is pending", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: /dirty A/i }));
    await user.click(screen.getByRole("button", { name: /dirty B/i }));
    await user.click(screen.getByRole("button", { name: /close-every tab/i }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /unsaved changes/i }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/2/);
  });

  // AC-006, TC-007 - side-effect-contract: Discard on a close-all closes every tab.
  it("should close every tab if Discard is clicked on a pending close-all", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: /dirty A/i }));
    await user.click(screen.getByRole("button", { name: /close-every tab/i }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /discard/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("open-count")).toHaveTextContent("0");
  });

  // behavior: Save in the popup persists the dirty request, then closes the tab.
  it("should persist the edit and close the tab if Save is clicked", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderDialog(onTreeChange);

    await user.click(screen.getByRole("button", { name: /dirty A/i }));
    await user.click(screen.getByRole("button", { name: /close-one A/i }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /save/i }));

    // persisted the folded url override + closed the tab.
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    const saved = onTreeChange.mock.calls[0][0].find(
      (n) => n.id === "req-json-body",
    );
    expect(saved?.kind === "request" && saved.url).toBe("https://dirty.test/x");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("open-count")).toHaveTextContent("1");
  });

  // behavior: a close-all Save folds every dirty request into one tree write.
  it("should persist all dirty requests in one write if Save is clicked on close-all", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderDialog(onTreeChange);

    await user.click(screen.getByRole("button", { name: /dirty A/i }));
    await user.click(screen.getByRole("button", { name: /dirty B/i }));
    await user.click(screen.getByRole("button", { name: /close-every tab/i }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onTreeChange).toHaveBeenCalledTimes(1);
    const tree = onTreeChange.mock.calls[0][0];
    const a = tree.find((n) => n.id === "req-json-body");
    const b = tree.find((n) => n.id === "req-other-body");
    expect(a?.kind === "request" && a.url).toBe("https://dirty.test/x");
    expect(b?.kind === "request" && b.url).toBe("https://dirty.test/y");
    expect(screen.getByTestId("open-count")).toHaveTextContent("0");
  });
});
