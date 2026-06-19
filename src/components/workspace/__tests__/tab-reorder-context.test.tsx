import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { ContentHeader } from "@/components/workspace/content-header";
import { fixtureTree } from "./fixtures";

function ReorderProbe() {
  const { openRequestIds, activeRequestId, reorderRequests, openSettings } =
    useWorkspace();

  return (
    <div>
      <span data-testid="open-ids">{openRequestIds.join(",")}</span>
      <span data-testid="active-id">{activeRequestId ?? "none"}</span>
      <button
        type="button"
        onClick={() =>
          reorderRequests(["req-token", "req-session", "req-profile"])
        }
      >
        reorder profile-to-end
      </button>
      <button
        type="button"
        onClick={() =>
          reorderRequests(["req-session", "req-profile", "req-token"])
        }
      >
        reorder swap ends
      </button>
      <button
        type="button"
        onClick={() => reorderRequests(["req-token", "req-profile"])}
      >
        reorder token-first
      </button>
      <button type="button" onClick={openSettings}>
        open settings
      </button>
    </div>
  );
}

function renderProbe(
  initialOpenRequestIds: string[],
  initialActiveRequestId?: string,
  onTabsChange?: (
    openRequestIds: string[],
    activeRequestId: string | null,
  ) => void,
) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialOpenRequestIds={initialOpenRequestIds}
      initialActiveRequestId={initialActiveRequestId}
      onTabsChange={onTabsChange}
    >
      <ReorderProbe />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceProvider reorderRequests", () => {
  // AC-001, TC-001 — behavior
  it("should set openRequestIds to the given permutation if reorderRequests is called", async () => {
    const user = userEvent.setup();
    renderProbe(
      ["req-profile", "req-token", "req-session"],
      "req-profile",
    );

    expect(screen.getByTestId("open-ids")).toHaveTextContent(
      "req-profile,req-token,req-session",
    );

    await user.click(
      screen.getByRole("button", { name: /reorder profile-to-end/i }),
    );

    expect(screen.getByTestId("open-ids")).toHaveTextContent(
      "req-token,req-session,req-profile",
    );
  });

  // AC-002 — behavior: reorder must not change which tab is active.
  it("should keep the same active tab if reorderRequests moves the active tab", async () => {
    const user = userEvent.setup();
    renderProbe(
      ["req-profile", "req-token", "req-session"],
      "req-profile",
    );

    expect(screen.getByTestId("active-id")).toHaveTextContent("req-profile");

    await user.click(
      screen.getByRole("button", { name: /reorder profile-to-end/i }),
    );

    // The reorder must have actually happened (RED until reorderRequests exists)...
    expect(screen.getByTestId("open-ids")).toHaveTextContent(
      "req-token,req-session,req-profile",
    );
    // ...yet the active tab is unchanged even though it moved to the end.
    expect(screen.getByTestId("active-id")).toHaveTextContent("req-profile");
  });

  // AC-002 — behavior: reorder is order-only, never opens or closes tabs.
  it("should not open or close any tab if reorderRequests is called", async () => {
    const user = userEvent.setup();
    renderProbe(
      ["req-profile", "req-token", "req-session"],
      "req-profile",
    );

    expect(screen.getByTestId("open-ids").textContent?.split(",")).toHaveLength(
      3,
    );

    await user.click(screen.getByRole("button", { name: /reorder swap ends/i }));

    // The order changed (RED until reorderRequests exists)...
    expect(screen.getByTestId("open-ids")).toHaveTextContent(
      "req-session,req-profile,req-token",
    );
    // ...but the same three tabs are open - none added, none removed.
    const idsAfter = screen.getByTestId("open-ids").textContent?.split(",");
    expect(idsAfter).toHaveLength(3);
    expect(idsAfter).toEqual(
      expect.arrayContaining(["req-profile", "req-token", "req-session"]),
    );
  });

  // AC-003, TC-002 — side-effect-contract: new order is reported via onTabsChange.
  it("should call onTabsChange with the reordered ids if reorderRequests is called", async () => {
    const user = userEvent.setup();
    const onTabsChange = vi.fn();
    renderProbe(
      ["req-profile", "req-token", "req-session"],
      "req-profile",
      onTabsChange,
    );

    await user.click(
      screen.getByRole("button", { name: /reorder profile-to-end/i }),
    );

    await waitFor(() => {
      expect(onTabsChange).toHaveBeenLastCalledWith(
        ["req-token", "req-session", "req-profile"],
        "req-profile",
      );
    });
  });
});

describe("ContentHeader settings tab vs reorder", () => {
  // AC-004, TC-003 — side-effect-contract: settings tab is not part of openRequestIds.
  it("should keep the Settings tab rendered and out of openRequestIds if request tabs are reordered", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={["req-profile", "req-token"]}
        initialActiveRequestId="req-profile"
      >
        <ReorderProbe />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /open settings/i }));

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(within(tablist).getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    // Before: request tabs are profile, then token (settings tab is separate).
    const requestTabNamesBefore = within(tablist)
      .getAllByRole("tab")
      .map((tab) => tab.textContent)
      .filter((name) => name !== "Settings");
    expect(requestTabNamesBefore).toEqual(["GETprofile", "POSTtoken"]);

    await user.click(screen.getByRole("button", { name: /reorder token-first/i }));

    // The request tabs actually reordered to token, then profile (RED until
    // reorderRequests exists) ...
    const requestTabNamesAfter = within(tablist)
      .getAllByRole("tab")
      .map((tab) => tab.textContent)
      .filter((name) => name !== "Settings");
    expect(requestTabNamesAfter).toEqual(["POSTtoken", "GETprofile"]);
    // ... the Settings tab survives that request-tab reorder ...
    expect(within(tablist).getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    // ... and was never part of the reorderable openRequestIds set.
    expect(screen.getByTestId("open-ids")).not.toHaveTextContent("settings");
    expect(screen.getByTestId("open-ids")).toHaveTextContent("req-token,req-profile");
  });
});
