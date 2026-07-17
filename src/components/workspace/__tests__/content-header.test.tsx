import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { ContentHeader } from "@/components/workspace/content-header";
import { ToastProvider } from "@/components/ui/toast";
import { fixtureTree } from "./fixtures";

function EditUrlButton({ id }: { id: string }) {
  const { setRequestUrl } = useWorkspace();
  return (
    <button
      type="button"
      onClick={() => setRequestUrl(id, "https://edited.test")}
    >
      edit url
    </button>
  );
}

describe("ContentHeader", () => {
  // AC-007 — behavior
  it("should make a tab active when it is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-profile"
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    // Open a second tab (token) by selecting it in the tree; profile is already open+active.
    const tree = screen.getByRole("tree", { name: /collection/i });
    await user.click(
      within(tree).getByRole("treeitem", { name: "POST token" }),
    );

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const profileTab = within(tablist).getByRole("tab", { name: "profile" });
    const tokenTab = within(tablist).getByRole("tab", { name: "token" });

    expect(tokenTab).toHaveAttribute("aria-selected", "true");
    expect(profileTab).toHaveAttribute("aria-selected", "false");

    await user.click(profileTab);

    expect(profileTab).toHaveAttribute("aria-selected", "true");
    expect(tokenTab).toHaveAttribute("aria-selected", "false");
  });

  // AC-007, TC-005 — behavior
  it("should remove a tab when its close button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-profile"
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    // Open a second tab so two are present.
    const tree = screen.getByRole("tree", { name: /collection/i });
    await user.click(
      within(tree).getByRole("treeitem", { name: "POST token" }),
    );

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(
      within(tablist).getByRole("tab", { name: "profile" }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole("tab", { name: "token" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close token" }));

    expect(
      within(tablist).queryByRole("tab", { name: "token" }),
    ).not.toBeInTheDocument();
    expect(
      within(tablist).getByRole("tab", { name: "profile" }),
    ).toBeInTheDocument();
  });

  // AC-007, E-3 — behavior
  it("should not open a duplicate tab when an already-open request is reselected", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-token"
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    const tablist = screen.getByRole("tablist", { name: /open requests/i });

    expect(within(tablist).getAllByRole("tab", { name: "token" })).toHaveLength(
      1,
    );

    await user.click(
      within(tree).getByRole("treeitem", { name: "POST token" }),
    );

    expect(within(tablist).getAllByRole("tab", { name: "token" })).toHaveLength(
      1,
    );
  });

  // AC-007, E-4 — behavior
  it("should activate an adjacent tab when the active tab is closed", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-profile"
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    await user.click(
      within(tree).getByRole("treeitem", { name: "POST token" }),
    );

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    // token is now active (last selected); close it -> profile becomes active
    await user.click(screen.getByRole("button", { name: "Close token" }));

    expect(
      within(tablist).getByRole("tab", { name: "profile" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  // AC-007, E-4 — behavior
  it("should leave no active tab when the last open tab is closed", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={[]}
        initialActiveRequestId="req-profile"
      >
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(
      within(tablist).getByRole("tab", { name: "profile" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close profile" }));

    expect(within(tablist).queryByRole("tab")).not.toBeInTheDocument();
  });

  // behavior: opening a config editor deselects the active request tab (the
  // editor, not a request, owns the content area).
  it("should deselect the active request tab when a folder config editor is opened", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-profile"
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const profileTab = within(tablist).getByRole("tab", { name: "profile" });
    expect(profileTab).toHaveAttribute("aria-selected", "true");

    const tree = screen.getByRole("tree", { name: /collection/i });
    const folderRow = within(tree).getByRole("treeitem", { name: "Users" });
    fireEvent.contextMenu(folderRow);
    await user.click(
      await screen.findByRole("menuitem", { name: /^edit$/i }),
    );

    expect(
      within(tablist).getByRole("tab", { name: "profile" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  // behavior: activating a request tab DEACTIVATES the folder config editor but
  // KEEPS its tab open (tabs never self-close - only an explicit close removes a
  // tab), mirroring how the Settings tab stays open when a request is activated.
  it("should keep the folder config editor tab open (just deactivated) when a request tab is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-profile"
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    const folderRow = within(tree).getByRole("treeitem", { name: "Users" });
    fireEvent.contextMenu(folderRow);
    await user.click(
      await screen.findByRole("menuitem", { name: /^edit$/i }),
    );

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const editorTab = within(tablist).getByRole("tab", { name: "Users" });
    expect(editorTab).toHaveAttribute("aria-selected", "true");

    await user.click(within(tablist).getByRole("tab", { name: "profile" }));

    expect(
      within(tablist).getByRole("tab", { name: "profile" }),
    ).toHaveAttribute("aria-selected", "true");
    // the editor tab is still present, just no longer active.
    expect(
      within(tablist).getByRole("tab", { name: "Users" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  // behavior: opening a folder config editor adds its own tab in the tab strip.
  it("should show an editor tab when a folder config editor is opened", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-profile"
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    const folderRow = within(tree).getByRole("treeitem", { name: "Users" });
    fireEvent.contextMenu(folderRow);
    await user.click(
      await screen.findByRole("menuitem", { name: /^edit$/i }),
    );

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const editorTab = within(tablist).getByRole("tab", { name: "Users" });
    expect(editorTab).toHaveAttribute("aria-selected", "true");
  });

  // behavior: a deactivated editor tab can be re-activated by clicking it back
  // (it stayed open in the background while a request was active).
  it("should re-activate the config editor tab when it is clicked after a request tab", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-profile"
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    fireEvent.contextMenu(
      within(tree).getByRole("treeitem", { name: "Users" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /^edit$/i }));

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    // activate the request tab -> editor deactivates but its tab remains.
    await user.click(within(tablist).getByRole("tab", { name: "profile" }));
    expect(
      within(tablist).getByRole("tab", { name: "Users" }),
    ).toHaveAttribute("aria-selected", "false");

    // click the editor tab back -> it re-activates.
    await user.click(within(tablist).getByRole("tab", { name: "Users" }));
    expect(
      within(tablist).getByRole("tab", { name: "Users" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      within(tablist).getByRole("tab", { name: "profile" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  // behavior: the editor tab has a close control that returns to the request view.
  it("should close the editor when the editor tab close button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-profile"
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    const folderRow = within(tree).getByRole("treeitem", { name: "Users" });
    fireEvent.contextMenu(folderRow);
    await user.click(
      await screen.findByRole("menuitem", { name: /^edit$/i }),
    );

    await user.click(
      screen.getByRole("button", { name: /close config editor/i }),
    );

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(
      within(tablist).queryByRole("tab", { name: "Users" }),
    ).not.toBeInTheDocument();
    expect(
      within(tablist).getByRole("tab", { name: "profile" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  // AC-004 - behavior: an unsaved edit renders a dirty marker on the request's tab.
  it("should show an unsaved-changes marker on a tab if the request has a pending edit", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={[]}
        initialActiveRequestId="req-profile"
      >
        <ContentHeader />
        <EditUrlButton id="req-profile" />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(
      within(tablist).queryByLabelText(/unsaved changes/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /edit url/i }));

    expect(
      within(tablist).getByLabelText(/unsaved changes/i),
    ).toBeInTheDocument();
  });

  // behavior: a request tab caps its label width and clips the overflow at rest
  // (jsdom can't measure layout, so we pin the structural contract: the label
  // container carries the width cap + clip, and the text stays on one line).
  it("should cap the tab label width and clip the overflow at rest", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={["req-profile"]}
        initialActiveRequestId="req-profile"
      >
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const container = tablist.querySelector('[data-slot="tab-label"]');
    expect(container).not.toBeNull();
    expect((container as HTMLElement).className).toContain("max-w-40");
    expect((container as HTMLElement).className).toContain("overflow-hidden");

    const text = within(container as HTMLElement).getByText("profile");
    expect(text.className).not.toContain("text-ellipsis");
    expect(text.className).toContain("whitespace-nowrap");
    expect(text.className).toContain("transition-transform");
  });

  // behavior: the editor tab label uses the same capped, scrollable label.
  it("should cap the editor tab label width and clip the overflow at rest", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-profile"
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    fireEvent.contextMenu(
      within(tree).getByRole("treeitem", { name: "Users" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /^edit$/i }));

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const editorTab = within(tablist).getByRole("tab", { name: "Users" });
    const container = editorTab.querySelector('[data-slot="tab-label"]');
    expect(container).not.toBeNull();
    expect((container as HTMLElement).className).toContain("max-w-40");
  });

  // behavior: hovering an overflowing label translates the text by exactly the
  // overflow so its end is revealed; leaving resets it to 0. jsdom reports 0 for
  // scrollWidth/clientWidth, so the measurements are stubbed to force overflow.
  it("should scroll the label by the overflow on hover and reset on leave when the text overflows", () => {
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(100);
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(160);
    try {
      render(
        <WorkspaceProvider
          tree={fixtureTree}
          initialOpenRequestIds={["req-profile"]}
          initialActiveRequestId="req-profile"
        >
          <ContentHeader />
        </WorkspaceProvider>,
      );

      const tablist = screen.getByRole("tablist", { name: /open requests/i });
      const container = tablist.querySelector(
        '[data-slot="tab-label"]',
      ) as HTMLElement;
      const text = within(container).getByText("profile");

      expect(text.style.transform).toBe("translateX(-0px)");

      fireEvent.pointerEnter(container);
      expect(text.style.transform).toBe("translateX(-60px)");
      expect(text.style.transitionDuration).toBe(`${(60 / 90) * 1000}ms`);

      fireEvent.pointerLeave(container);
      expect(text.style.transform).toBe("translateX(-0px)");
    } finally {
      clientWidth.mockRestore();
      scrollWidth.mockRestore();
    }
  });

  // behavior: a label that fits (no overflow) never moves on hover.
  it("should not move the label on hover when the text fits", () => {
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(200);
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(80);
    try {
      render(
        <WorkspaceProvider
          tree={fixtureTree}
          initialOpenRequestIds={["req-profile"]}
          initialActiveRequestId="req-profile"
        >
          <ContentHeader />
        </WorkspaceProvider>,
      );

      const tablist = screen.getByRole("tablist", { name: /open requests/i });
      const container = tablist.querySelector(
        '[data-slot="tab-label"]',
      ) as HTMLElement;
      const text = within(container).getByText("profile");

      fireEvent.pointerEnter(container);
      expect(text.style.transform).toBe("translateX(-0px)");
    } finally {
      clientWidth.mockRestore();
      scrollWidth.mockRestore();
    }
  });

  // AC-007 — behavior
  it("should render a New request control when the header is shown", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={[]}
        initialActiveRequestId="req-profile"
      >
        <ContentHeader />
      </WorkspaceProvider>,
    );

    expect(
      screen.getByRole("button", { name: /new request/i }),
    ).toBeInTheDocument();
  });
});

describe("ContentHeader sticky New-request button (AC-003/004/005)", () => {
  // AC-003/005 — behavior: the `+` must NOT live inside the scrolling tablist, so
  // it can never scroll out of reach. jsdom can't measure overflow, so we pin the
  // structural contract: the tablist is the scroller (carries overflow-x-auto)
  // and the `+` button is not a descendant of it.
  it("should keep the New request button outside the scrolling tablist container", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={["req-profile", "req-token"]}
        initialActiveRequestId="req-profile"
      >
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const plus = screen.getByRole("button", { name: /new request/i });

    expect(plus).toBeInTheDocument();
    // The tablist (cards) is the horizontal scroller (AC-005 relocated here from
    // the outer bar), while the `+` stays outside it - shrink-0 and not a
    // descendant - so it can't scroll out of reach (AC-003/004/005).
    expect((tablist as HTMLElement).className).toContain("overflow-x-auto");
    expect(plus.className).toContain("shrink-0");
    expect(tablist.contains(plus)).toBe(false);
  });

  // The active card overflows the bar by 1px (`-mb-px h-[calc(100%+1px)]` seam
  // trick), which under `overflow-x-auto` turns `overflow-y` into a stray
  // draggable vertical scroll. The strip must clip it (`overflow-y-hidden`).
  it("should clip vertical overflow on the tab strip so it has no stray vertical scroll", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={["req-profile", "req-token"]}
        initialActiveRequestId="req-profile"
      >
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect((tablist as HTMLElement).className).toContain("overflow-y-hidden");
  });
});

describe("ContentHeader tab context menu (AC-006/008)", () => {
  function renderHeader(
    openIds: string[],
    activeId = openIds[0],
  ): ReturnType<typeof userEvent.setup> {
    render(
      <ToastProvider>
        <WorkspaceProvider
          tree={fixtureTree}
          initialOpenRequestIds={openIds}
          initialActiveRequestId={activeId}
        >
          <ContentHeader />
        </WorkspaceProvider>
      </ToastProvider>,
    );
    return userEvent.setup();
  }

  // AC-006, TC-004 — behavior: right-clicking a request tab opens a menu with the
  // three close actions. radix ContextMenu opens under jsdom via
  // fireEvent.contextMenu (proven by tree-row-crud).
  it("should open a context menu with Close, Close other tabs and Close all if a request tab is right-clicked", async () => {
    renderHeader(["req-profile", "req-token"]);

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const profileTab = within(tablist).getByRole("tab", { name: "profile" });
    fireEvent.contextMenu(profileTab);

    expect(
      await screen.findByRole("menuitem", { name: /^close$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /close other tabs/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /close all/i }),
    ).toBeInTheDocument();
  });

  // AC-006/007, TC-004 — behavior: running "Close other tabs" from the menu leaves
  // only the right-clicked tab open and active.
  it("should close every other tab and activate the target if Close other tabs is chosen from a tab's menu", async () => {
    const user = renderHeader(["req-profile", "req-token", "req-session"]);

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const tokenTab = within(tablist).getByRole("tab", { name: "token" });
    fireEvent.contextMenu(tokenTab);

    await user.click(
      await screen.findByRole("menuitem", { name: /close other tabs/i }),
    );

    expect(within(tablist).queryByRole("tab", { name: "profile" })).toBeNull();
    expect(within(tablist).queryByRole("tab", { name: "session" })).toBeNull();
    const survivor = within(tablist).getByRole("tab", { name: "token" });
    expect(survivor).toHaveAttribute("aria-selected", "true");
  });

  // AC-008, TC-005 — behavior: with a single open tab the "Close other tabs" item
  // is disabled.
  it("should disable Close other tabs in the menu if the target is the only open tab", async () => {
    renderHeader(["req-profile"]);

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const profileTab = within(tablist).getByRole("tab", { name: "profile" });
    fireEvent.contextMenu(profileTab);

    const item = await screen.findByRole("menuitem", {
      name: /close other tabs/i,
    });
    const isDisabled =
      item.getAttribute("aria-disabled") === "true" ||
      item.hasAttribute("data-disabled");
    expect(isDisabled).toBe(true);
  });
});
