import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { fixtureTree } from "./fixtures";

function TabsProbe() {
  const {
    openRequestIds,
    activeRequestId,
    selectNode,
    closeRequest,
    newRequest,
  } = useWorkspace();

  return (
    <div>
      <span data-testid="open-ids">{openRequestIds.join(",")}</span>
      <span data-testid="active-id">{activeRequestId ?? "none"}</span>
      <button type="button" onClick={() => selectNode("req-session")}>
        open session
      </button>
      <button type="button" onClick={() => closeRequest("req-profile")}>
        close profile
      </button>
      <button type="button" onClick={() => newRequest()}>
        new draft
      </button>
    </div>
  );
}

describe("WorkspaceProvider open-tab restore", () => {
  it("should restore the open tabs from initialOpenRequestIds present in the tree", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={["req-profile", "req-token"]}
      >
        <TabsProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("open-ids")).toHaveTextContent(
      "req-profile,req-token",
    );
    expect(screen.getByTestId("active-id")).toHaveTextContent("req-profile");
  });

  it("should drop restored ids that are not in the current tree", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={["req-profile", "req-gone"]}
      >
        <TabsProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("open-ids")).toHaveTextContent("req-profile");
    expect(screen.getByTestId("open-ids")).not.toHaveTextContent("req-gone");
  });
});

describe("WorkspaceProvider open-tab persistence", () => {
  it("should call onTabsChange with the open ids and active id when a tab is opened", async () => {
    const user = userEvent.setup();
    const onTabsChange = vi.fn();

    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={["req-profile"]}
        onTabsChange={onTabsChange}
      >
        <TabsProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /open session/i }));

    await waitFor(() => {
      expect(onTabsChange).toHaveBeenLastCalledWith(
        ["req-profile", "req-session"],
        "req-session",
      );
    });
  });

  it("should not include in-memory drafts in the persisted open ids", async () => {
    const user = userEvent.setup();
    const onTabsChange = vi.fn();

    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={["req-profile"]}
        onTabsChange={onTabsChange}
      >
        <TabsProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /new draft/i }));

    await waitFor(() => {
      const [ids, active] = onTabsChange.mock.calls.at(-1)!;
      expect(ids).toEqual(["req-profile"]);
      expect(active).toBeNull();
    });
  });

  it("should persist the remaining ids when a tab is closed", async () => {
    const user = userEvent.setup();
    const onTabsChange = vi.fn();

    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={["req-profile", "req-token"]}
        onTabsChange={onTabsChange}
      >
        <TabsProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /close profile/i }));

    await waitFor(() => {
      const [ids] = onTabsChange.mock.calls.at(-1)!;
      expect(ids).toEqual(["req-token"]);
    });
  });

  it("should not call onTabsChange on the initial restore render", () => {
    const onTabsChange = vi.fn();

    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={["req-profile"]}
        onTabsChange={onTabsChange}
      >
        <TabsProbe />
      </WorkspaceProvider>,
    );

    expect(onTabsChange).not.toHaveBeenCalled();
  });
});
