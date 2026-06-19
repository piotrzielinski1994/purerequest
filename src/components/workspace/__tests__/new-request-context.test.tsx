import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { fixtureTree } from "./fixtures";

function NewRequestProbe() {
  const {
    newRequest,
    closeRequest,
    openRequestIds,
    activeRequestId,
    activeRequest,
    requestsById,
    isSettingsActive,
    openSettings,
  } = useWorkspace();

  return (
    <div>
      <span data-testid="open-count">{openRequestIds.length}</span>
      <span data-testid="active-id">{activeRequestId ?? "none"}</span>
      <span data-testid="active-method">{activeRequest?.method ?? "none"}</span>
      <span data-testid="active-url">{`[${activeRequest?.url ?? "none"}]`}</span>
      <span data-testid="active-name">{activeRequest?.name ?? "none"}</span>
      <span data-testid="settings-active">{String(isSettingsActive)}</span>
      <span data-testid="active-in-index">
        {String(
          activeRequestId !== null && requestsById.has(activeRequestId),
        )}
      </span>
      <button type="button" onClick={() => newRequest()}>
        new request
      </button>
      <button type="button" onClick={openSettings}>
        open settings
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            closeRequest(activeRequestId);
          }
        }}
      >
        close active
      </button>
    </div>
  );
}

function renderProbe(initialActiveRequestId?: string) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialActiveRequestId={initialActiveRequestId}
    >
      <NewRequestProbe />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceProvider newRequest", () => {
  // AC-004, TC-004 — behavior
  it("should open a draft as the active tab with method GET and an empty URL if newRequest is called", async () => {
    const user = userEvent.setup();
    renderProbe("req-profile");

    expect(screen.getByTestId("open-count")).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: /new request/i }));

    expect(screen.getByTestId("open-count")).toHaveTextContent("2");
    expect(screen.getByTestId("active-method")).toHaveTextContent("GET");
    expect(screen.getByTestId("active-url")).toHaveTextContent("[]");
    expect(screen.getByTestId("active-name")).not.toHaveTextContent("none");
  });

  // AC-004, TC-004 — behavior
  it("should open distinct drafts if newRequest is called multiple times", async () => {
    const user = userEvent.setup();
    renderProbe("req-profile");

    await user.click(screen.getByRole("button", { name: /new request/i }));
    const firstDraftId = screen.getByTestId("active-id").textContent;

    await user.click(screen.getByRole("button", { name: /new request/i }));
    const secondDraftId = screen.getByTestId("active-id").textContent;

    expect(screen.getByTestId("open-count")).toHaveTextContent("3");
    expect(firstDraftId).not.toBe(secondDraftId);
  });

  // AC-004 — side-effect-contract: drafts resolve through requestsById like tree requests.
  it("should resolve the draft through requestsById so lookup keeps working", async () => {
    const user = userEvent.setup();
    // No initial active request: nothing is in the index as active yet.
    renderProbe();

    expect(screen.getByTestId("active-id")).toHaveTextContent("none");
    expect(screen.getByTestId("active-in-index")).toHaveTextContent("false");

    await user.click(screen.getByRole("button", { name: /new request/i }));

    // The freshly-opened draft is the active request AND resolvable by id.
    expect(screen.getByTestId("active-id")).not.toHaveTextContent("none");
    expect(screen.getByTestId("active-in-index")).toHaveTextContent("true");
  });

  // AC-004 — side-effect-contract: closeRequest must work for a draft.
  it("should drop the draft from open tabs if closeRequest is called for it", async () => {
    const user = userEvent.setup();
    renderProbe("req-profile");

    await user.click(screen.getByRole("button", { name: /new request/i }));
    expect(screen.getByTestId("open-count")).toHaveTextContent("2");

    await user.click(screen.getByRole("button", { name: /close active/i }));

    expect(screen.getByTestId("open-count")).toHaveTextContent("1");
  });

  // AC-005, TC-005 — side-effect-contract: opening a draft deactivates settings.
  it("should deactivate settings if newRequest is called while settings is active", async () => {
    const user = userEvent.setup();
    renderProbe("req-profile");

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    expect(screen.getByTestId("settings-active")).toHaveTextContent("true");

    await user.click(screen.getByRole("button", { name: /new request/i }));

    expect(screen.getByTestId("settings-active")).toHaveTextContent("false");
  });
});
