import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CloseConfirmDialog } from "@/components/workspace/close-confirm-dialog";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { TreeNode } from "@/lib/workspace/model";
import { bodyFixtureTree } from "./fixtures";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

// `requestCloseOthers` is the NEW context action this feature adds. Surfacing it
// through the harness (instead of asserting an internal) keeps the RED failure
// meaningful: the test reads it off the real context value, so a missing action
// fails on "not a function" / undefined call rather than a class-name guess.
type CloseOthersSurface = ReturnType<typeof useWorkspace> & {
  requestCloseOthers: (id: string) => void;
};

function CloseOthersDriver() {
  const ctx = useWorkspace() as CloseOthersSurface;
  const { setRequestUrl, requestCloseOthers, openRequestIds, activeRequestId } =
    ctx;
  return (
    <div>
      <span data-testid="open-ids">{openRequestIds.join(",")}</span>
      <span data-testid="active-id">{activeRequestId ?? "none"}</span>
      <span data-testid="has-action">{typeof requestCloseOthers}</span>
      <button
        type="button"
        onClick={() => setRequestUrl("req-other-body", "https://dirty.test/y")}
      >
        dirty other
      </button>
      <button type="button" onClick={() => requestCloseOthers("req-json-body")}>
        close others of A
      </button>
    </div>
  );
}

function renderDriver(opts?: {
  openIds?: string[];
  onTreeChange?: OnTreeChange;
}) {
  return render(
    <WorkspaceProvider
      tree={bodyFixtureTree}
      initialActiveRequestId="req-other-body"
      initialOpenRequestIds={
        opts?.openIds ?? ["req-json-body", "req-other-body", "req-empty-body"]
      }
      onTreeChange={opts?.onTreeChange}
    >
      <CloseOthersDriver />
      <CloseConfirmDialog />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceProvider requestCloseOthers", () => {
  // AC-007 — behavior: the new context action exists.
  it("should expose requestCloseOthers as a function on the context", () => {
    renderDriver();
    expect(screen.getByTestId("has-action")).toHaveTextContent("function");
  });

  // AC-007, TC-004 — behavior: closing others leaves only the target, active.
  it("should keep only the target tab open and active if requestCloseOthers is called with clean others", async () => {
    const user = userEvent.setup();
    renderDriver();

    expect(screen.getByTestId("open-ids").textContent?.split(",")).toHaveLength(
      3,
    );

    await user.click(
      screen.getByRole("button", { name: /close others of A/i }),
    );

    expect(screen.getByTestId("open-ids")).toHaveTextContent("req-json-body");
    expect(screen.getByTestId("open-ids").textContent?.split(",")).toHaveLength(
      1,
    );
    expect(screen.getByTestId("active-id")).toHaveTextContent("req-json-body");
  });

  // AC-008, TC-005 — behavior: single open tab makes close-others a no-op. (The
  // has-action assertion keeps this RED until the feature exists, so a thrown
  // "not a function" can't masquerade as a passing no-op.)
  it("should not change the open tabs if requestCloseOthers is called with only the target open", async () => {
    const user = userEvent.setup();
    renderDriver({ openIds: ["req-json-body"] });

    expect(screen.getByTestId("has-action")).toHaveTextContent("function");
    expect(screen.getByTestId("open-ids")).toHaveTextContent("req-json-body");

    await user.click(
      screen.getByRole("button", { name: /close others of A/i }),
    );

    expect(screen.getByTestId("open-ids")).toHaveTextContent("req-json-body");
    expect(screen.getByTestId("open-ids").textContent?.split(",")).toHaveLength(
      1,
    );
  });

  // AC-009, TC-006 — behavior: a dirty OTHER tab opens the unsaved-changes dialog
  // (instead of closing immediately).
  it("should open the unsaved-changes dialog if a non-target tab is dirty when closing others", async () => {
    const user = userEvent.setup();
    renderDriver();

    await user.click(screen.getByRole("button", { name: /dirty other/i }));
    await user.click(
      screen.getByRole("button", { name: /close others of A/i }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /unsaved changes/i }),
    ).toBeInTheDocument();
    // names the count of OTHER dirty tabs (1).
    expect(dialog).toHaveTextContent(/1/);
    // tabs are all still open until the user resolves the dialog.
    expect(screen.getByTestId("open-ids").textContent?.split(",")).toHaveLength(
      3,
    );
  });

  // AC-009, TC-006 — side-effect-contract: Discard closes the others, keeps target.
  it("should close the others and keep the target if Discard is clicked on a dirty close-others", async () => {
    const user = userEvent.setup();
    renderDriver();

    await user.click(screen.getByRole("button", { name: /dirty other/i }));
    await user.click(
      screen.getByRole("button", { name: /close others of A/i }),
    );
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /discard/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("open-ids")).toHaveTextContent("req-json-body");
    expect(screen.getByTestId("open-ids").textContent?.split(",")).toHaveLength(
      1,
    );
    expect(screen.getByTestId("active-id")).toHaveTextContent("req-json-body");
  });

  // AC-009, TC-006 — side-effect-contract: Cancel keeps every tab open.
  it("should keep every tab open if Cancel is clicked on a dirty close-others", async () => {
    const user = userEvent.setup();
    renderDriver();

    await user.click(screen.getByRole("button", { name: /dirty other/i }));
    await user.click(
      screen.getByRole("button", { name: /close others of A/i }),
    );
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("open-ids").textContent?.split(",")).toHaveLength(
      3,
    );
  });

  // AC-009, TC-006 — side-effect-contract: Save persists the dirty other, then
  // closes the others (folds only the OTHER tab, never the kept target).
  it("should persist the dirty other and close it if Save is clicked on a dirty close-others", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderDriver({ onTreeChange });

    await user.click(screen.getByRole("button", { name: /dirty other/i }));
    await user.click(
      screen.getByRole("button", { name: /close others of A/i }),
    );
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onTreeChange).toHaveBeenCalledTimes(1);
    const saved = onTreeChange.mock.calls[0][0].find(
      (n) => n.id === "req-other-body",
    );
    expect(saved?.kind === "request" && saved.url).toBe("https://dirty.test/y");
    expect(screen.getByTestId("open-ids")).toHaveTextContent("req-json-body");
    expect(screen.getByTestId("open-ids").textContent?.split(",")).toHaveLength(
      1,
    );
  });
});
