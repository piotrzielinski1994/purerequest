import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  useWorkspace,
  WorkspaceProvider,
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
        {String(activeRequestId !== null && requestsById.has(activeRequestId))}
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
  // behavior: new request opens a real node as the active tab with method GET
  // and an empty URL.
  it("should open a new request as the active tab with method GET and an empty URL if newRequest is called", async () => {
    const user = userEvent.setup();
    renderProbe("req-profile");

    expect(screen.getByTestId("open-count")).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: /new request/i }));

    expect(screen.getByTestId("open-count")).toHaveTextContent("2");
    expect(screen.getByTestId("active-method")).toHaveTextContent("GET");
    expect(screen.getByTestId("active-url")).toHaveTextContent("[]");
    expect(screen.getByTestId("active-name")).not.toHaveTextContent("none");
  });

  // behavior: each new request is a distinct node/tab.
  it("should open distinct requests if newRequest is called multiple times", async () => {
    const user = userEvent.setup();
    renderProbe("req-profile");

    await user.click(screen.getByRole("button", { name: /new request/i }));
    const firstId = screen.getByTestId("active-id").textContent;

    await user.click(screen.getByRole("button", { name: /new request/i }));
    const secondId = screen.getByTestId("active-id").textContent;

    expect(screen.getByTestId("open-count")).toHaveTextContent("3");
    expect(firstId).not.toBe(secondId);
  });

  // side-effect-contract: a created request resolves through requestsById (it's
  // a real tree node now).
  it("should resolve the created request through requestsById so lookup keeps working", async () => {
    const user = userEvent.setup();
    // No initial active request: nothing is in the index as active yet.
    renderProbe();

    expect(screen.getByTestId("active-id")).toHaveTextContent("none");
    expect(screen.getByTestId("active-in-index")).toHaveTextContent("false");

    await user.click(screen.getByRole("button", { name: /new request/i }));

    // The freshly-created request is the active request AND resolvable by id.
    expect(screen.getByTestId("active-id")).not.toHaveTextContent("none");
    expect(screen.getByTestId("active-in-index")).toHaveTextContent("true");
  });

  // side-effect-contract: closeRequest closes the created request's tab.
  it("should drop the created request from open tabs if closeRequest is called for it", async () => {
    const user = userEvent.setup();
    renderProbe("req-profile");

    await user.click(screen.getByRole("button", { name: /new request/i }));
    expect(screen.getByTestId("open-count")).toHaveTextContent("2");

    await user.click(screen.getByRole("button", { name: /close active/i }));

    expect(screen.getByTestId("open-count")).toHaveTextContent("1");
  });

  // AC-005, TC-005 — side-effect-contract: creating a request deactivates settings.
  it("should deactivate settings if newRequest is called while settings is active", async () => {
    const user = userEvent.setup();
    renderProbe("req-profile");

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    expect(screen.getByTestId("settings-active")).toHaveTextContent("true");

    await user.click(screen.getByRole("button", { name: /new request/i }));

    expect(screen.getByTestId("settings-active")).toHaveTextContent("false");
  });
});
