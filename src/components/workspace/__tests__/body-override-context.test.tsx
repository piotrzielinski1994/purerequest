import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { bodyFixtureTree, JSON_BODY, OTHER_BODY } from "./fixtures";

function BodyProbe() {
  const {
    setRequestBody,
    setActiveRequest,
    selectNode,
    newRequest,
    closeRequest,
    closeAllRequests,
    activeRequest,
    activeRequestId,
    openRequestIds,
  } = useWorkspace();

  return (
    <div>
      <span data-testid="active-id">{activeRequestId ?? "none"}</span>
      <span data-testid="active-body">{`[${activeRequest?.body.types.json ?? "none"}]`}</span>
      <span data-testid="open-count">{openRequestIds.length}</span>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestBody(activeRequestId, "EDITED-ACTIVE");
          }
        }}
      >
        edit active body
      </button>
      <button
        type="button"
        onClick={() => setRequestBody("req-json-body", "EDITED-A")}
      >
        edit A body
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
            closeRequest(activeRequestId);
          }
        }}
      >
        close active
      </button>
      <button type="button" onClick={() => closeAllRequests()}>
        close all
      </button>
    </div>
  );
}

function renderProbe(initialActiveRequestId?: string) {
  return render(
    <WorkspaceProvider
      tree={bodyFixtureTree}
      initialActiveRequestId={initialActiveRequestId}
    >
      <BodyProbe />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceProvider setRequestBody", () => {
  // AC-003 — side-effect-contract: setRequestBody overrides the resolved body.
  it("should resolve activeRequest.body to the override if setRequestBody was called", async () => {
    const user = userEvent.setup();
    renderProbe("req-json-body");

    expect(screen.getByTestId("active-body")).toHaveTextContent(
      `[${JSON_BODY}]`,
      { normalizeWhitespace: false },
    );

    await user.click(screen.getByRole("button", { name: /edit active body/i }));

    expect(screen.getByTestId("active-body")).toHaveTextContent(
      "[EDITED-ACTIVE]",
    );
  });

  // AC-006, TC-005 — side-effect-contract: overrides are keyed per request id.
  it("should not change another request's body if one request's body is edited", async () => {
    const user = userEvent.setup();
    renderProbe("req-json-body");

    await user.click(screen.getByRole("button", { name: /edit A body/i }));
    expect(screen.getByTestId("active-body")).toHaveTextContent("[EDITED-A]");

    await user.click(screen.getByRole("button", { name: /activate B/i }));

    // B keeps its own original body, unaffected by A's edit.
    expect(screen.getByTestId("active-id")).toHaveTextContent("req-other-body");
    expect(screen.getByTestId("active-body")).toHaveTextContent(
      `[${OTHER_BODY}]`,
      { normalizeWhitespace: false },
    );
  });

  // AC-003, TC-003 — behavior: edit survives switching active request away and back.
  it("should keep the edited body if the active request is switched away and back", async () => {
    const user = userEvent.setup();
    renderProbe("req-json-body");

    await user.click(screen.getByRole("button", { name: /edit active body/i }));
    expect(screen.getByTestId("active-body")).toHaveTextContent(
      "[EDITED-ACTIVE]",
    );

    await user.click(screen.getByRole("button", { name: /activate B/i }));
    expect(screen.getByTestId("active-id")).toHaveTextContent("req-other-body");

    await user.click(screen.getByRole("button", { name: /activate A/i }));

    expect(screen.getByTestId("active-id")).toHaveTextContent("req-json-body");
    expect(screen.getByTestId("active-body")).toHaveTextContent(
      "[EDITED-ACTIVE]",
    );
  });

  // AC-007, TC-006 — side-effect-contract: a freshly created request's body is
  // editable via setRequestBody and its tab closes cleanly.
  it("should edit a new request's body via setRequestBody and still allow closing its tab", async () => {
    const user = userEvent.setup();
    renderProbe("req-json-body");

    await user.click(screen.getByRole("button", { name: /new request/i }));
    expect(screen.getByTestId("open-count")).toHaveTextContent("2");
    // A new request starts with an empty body.
    expect(screen.getByTestId("active-body")).toHaveTextContent("[]");

    await user.click(screen.getByRole("button", { name: /edit active body/i }));
    expect(screen.getByTestId("active-body")).toHaveTextContent(
      "[EDITED-ACTIVE]",
    );

    await user.click(screen.getByRole("button", { name: /close active/i }));

    // the tab closes; the override does not resurrect it.
    expect(screen.getByTestId("open-count")).toHaveTextContent("1");
    expect(screen.getByTestId("active-id")).toHaveTextContent("req-json-body");
  });

  // AC-006, spec §6 — side-effect-contract: closing a tree request drops its
  // override, so reopening it reverts to the original on-disk body.
  it("should revert to the original body if a tree request is edited, closed, then reopened", async () => {
    const user = userEvent.setup();
    renderProbe("req-json-body");

    await user.click(screen.getByRole("button", { name: /edit active body/i }));
    expect(screen.getByTestId("active-body")).toHaveTextContent(
      "[EDITED-ACTIVE]",
    );

    await user.click(screen.getByRole("button", { name: /close active/i }));
    await user.click(screen.getByRole("button", { name: /open A/i }));

    expect(screen.getByTestId("active-id")).toHaveTextContent("req-json-body");
    expect(screen.getByTestId("active-body")).toHaveTextContent(
      `[${JSON_BODY}]`,
      { normalizeWhitespace: false },
    );
  });

  // spec §5 — side-effect-contract: closeAllRequests clears every override.
  it("should drop all overrides if every request is closed at once", async () => {
    const user = userEvent.setup();
    renderProbe("req-json-body");

    await user.click(screen.getByRole("button", { name: /edit active body/i }));
    await user.click(screen.getByRole("button", { name: /close all/i }));
    expect(screen.getByTestId("active-id")).toHaveTextContent("none");

    await user.click(screen.getByRole("button", { name: /open A/i }));

    expect(screen.getByTestId("active-body")).toHaveTextContent(
      `[${JSON_BODY}]`,
      { normalizeWhitespace: false },
    );
  });
});
