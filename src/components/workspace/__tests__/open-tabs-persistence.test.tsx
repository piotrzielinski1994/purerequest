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
    closeAllRequests,
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
      <button type="button" onClick={() => closeAllRequests()}>
        close all
      </button>
      <button type="button" onClick={() => newRequest()}>
        new request
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

  it("should persist a fresh DRAFT tab's id so it can be restored on restart", async () => {
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

    await user.click(screen.getByRole("button", { name: /new request/i }));

    // A new request is a draft (id `new-<n>`) kept in settings, so its open-tab id
    // IS persisted and becomes the active tab - it restores after a restart.
    await waitFor(() => {
      const [ids, active] = onTabsChange.mock.calls.at(-1)!;
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe("req-profile");
      expect(ids[1]).toMatch(/^new-/);
      expect(active).toBe(ids[1]);
    });
  });

  it("should clear all open tabs and persist an empty list when closeAllRequests is called", async () => {
    const user = userEvent.setup();
    const onTabsChange = vi.fn();

    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={["req-profile", "req-token", "req-session"]}
        onTabsChange={onTabsChange}
      >
        <TabsProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /close all/i }));

    expect(screen.getByTestId("open-ids")).toHaveTextContent("");
    expect(screen.getByTestId("active-id")).toHaveTextContent("none");
    await waitFor(() => {
      expect(onTabsChange).toHaveBeenLastCalledWith([], null);
    });
  });

  it("should also drop a freshly-created request tab when closeAllRequests is called", async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={["req-profile"]}
      >
        <TabsProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /new request/i }));
    expect(screen.getByTestId("open-ids")).not.toHaveTextContent("");

    await user.click(screen.getByRole("button", { name: /close all/i }));

    expect(screen.getByTestId("open-ids")).toHaveTextContent("");
    expect(screen.getByTestId("active-id")).toHaveTextContent("none");
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
