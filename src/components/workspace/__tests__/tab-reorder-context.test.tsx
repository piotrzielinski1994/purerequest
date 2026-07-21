import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContentHeader } from "@/components/workspace/content-header";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
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
    renderProbe(["req-profile", "req-token", "req-session"], "req-profile");

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
    renderProbe(["req-profile", "req-token", "req-session"], "req-profile");

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
    renderProbe(["req-profile", "req-token", "req-session"], "req-profile");

    expect(screen.getByTestId("open-ids").textContent?.split(",")).toHaveLength(
      3,
    );

    await user.click(
      screen.getByRole("button", { name: /reorder swap ends/i }),
    );

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

describe("ContentHeader settings tab is a reorderable tab", () => {
  // The Settings tab lives IN openRequestIds under the synthetic id, so it renders
  // in the same strip and reorders like a request tab.
  it("should add the Settings tab to openRequestIds and render it in the strip", async () => {
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
    expect(
      within(tablist).getByRole("tab", { name: "Settings" }),
    ).toBeInTheDocument();
    // The synthetic settings id is now part of the ordered open-tab list, after
    // the two requests.
    expect(screen.getByTestId("open-ids")).toHaveTextContent(
      "req-profile,req-token,__settings__",
    );
  });

  it("should reorder the Settings tab within the strip like any tab", async () => {
    const user = userEvent.setup();
    function MoveSettingsFirst() {
      const { reorderRequests } = useWorkspace();
      return (
        <button
          type="button"
          onClick={() =>
            reorderRequests(["__settings__", "req-profile", "req-token"])
          }
        >
          settings-first
        </button>
      );
    }
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={["req-profile", "req-token"]}
        initialActiveRequestId="req-profile"
      >
        <ReorderProbe />
        <MoveSettingsFirst />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    await user.click(screen.getByRole("button", { name: /settings-first/i }));

    expect(screen.getByTestId("open-ids")).toHaveTextContent(
      "__settings__,req-profile,req-token",
    );
    // Settings tab is the first tab in the strip now.
    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(within(tablist).getAllByRole("tab")[0]).toHaveAccessibleName(
      /settings/i,
    );
  });
});
