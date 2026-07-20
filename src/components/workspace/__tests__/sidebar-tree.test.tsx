import { describe, it, expect } from "vitest";
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { ContentHeader } from "@/components/workspace/content-header";
import { fixtureTree } from "./fixtures";

describe("SidebarTree", () => {
  // behavior: a writable but empty workspace (onTreeChange wired) shows a
  // create-something prompt, NOT the read-only "set workspacePath" hint.
  it("should show a create hint, not the settings hint, for an empty writable workspace", async () => {
    render(
      <WorkspaceProvider
        tree={[]}
        onTreeChange={() => Promise.resolve({ ok: true })}
      >
        <SidebarTree />
      </WorkspaceProvider>,
    );

    expect(screen.queryByText(/set "workspacePath"/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no requests yet/i)).toBeInTheDocument();
  });

  // behavior: an empty workspace with NO onTreeChange (no path configured) still
  // shows the read-only "set workspacePath" hint.
  it("should show the settings hint for an empty read-only workspace", () => {
    render(
      <WorkspaceProvider tree={[]}>
        <SidebarTree />
      </WorkspaceProvider>,
    );

    expect(screen.getByText(/set "workspacePath"/i)).toBeInTheDocument();
  });

  // AC-004, TC-002 — behavior
  it("should reveal a folder's children when a collapsed folder is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
        <SidebarTree />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    const auth = within(tree).getByRole("treeitem", { name: "Auth" });
    expect(auth).toHaveAttribute("aria-expanded", "false");
    expect(
      within(tree).queryByRole("treeitem", { name: "OAuth" }),
    ).not.toBeInTheDocument();

    await user.click(auth);

    expect(auth).toHaveAttribute("aria-expanded", "true");
    expect(
      within(tree).getByRole("treeitem", { name: "OAuth" }),
    ).toBeInTheDocument();
  });

  // AC-004, TC-002 — behavior
  it("should hide a folder's children when an expanded folder is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth"]}
      >
        <SidebarTree />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    const auth = within(tree).getByRole("treeitem", { name: "Auth" });
    expect(auth).toHaveAttribute("aria-expanded", "true");
    expect(
      within(tree).getByRole("treeitem", { name: "OAuth" }),
    ).toBeInTheDocument();

    await user.click(auth);

    expect(auth).toHaveAttribute("aria-expanded", "false");
    expect(
      within(tree).queryByRole("treeitem", { name: "OAuth" }),
    ).not.toBeInTheDocument();
  });

  // AC-003 — behavior
  it("should show the method badge in a request leaf's label", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
        <SidebarTree />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    expect(
      within(tree).getByRole("treeitem", { name: "GET profile" }),
    ).toBeInTheDocument();
    expect(
      within(tree).getByRole("treeitem", { name: "DELETE session" }),
    ).toBeInTheDocument();
  });

  // AC-003, TC-003 — behavior
  it("should render a request nested three folders deep when its ancestors are expanded", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
      >
        <SidebarTree />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    expect(
      within(tree).getByRole("treeitem", { name: "Auth" }),
    ).toBeInTheDocument();
    expect(
      within(tree).getByRole("treeitem", { name: "OAuth" }),
    ).toBeInTheDocument();
    expect(
      within(tree).getByRole("treeitem", { name: "POST token" }),
    ).toBeInTheDocument();
  });

  // AC-005, TC-003 — behavior
  it("should select a request and open its tab when a request leaf is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    const token = within(tree).getByRole("treeitem", { name: "POST token" });
    expect(token).toHaveAttribute("aria-selected", "false");

    await user.click(token);

    expect(token).toHaveAttribute("aria-selected", "true");

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(
      within(tablist).getByRole("tab", { name: "token" }),
    ).toBeInTheDocument();
  });

  // AC-006, E-2 — behavior
  it("should not open a request tab when a folder is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    await user.click(within(tree).getByRole("treeitem", { name: "Auth" }));

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(within(tablist).queryByRole("tab")).not.toBeInTheDocument();
  });

  // AC-002, AC-008 — render-contract: right-clicking the empty sidebar area (not a
  // row) offers New request / New folder for creating at the workspace root.
  it("should offer New request and New folder when the empty sidebar area is right-clicked", async () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
        <SidebarTree />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    // the empty-area trigger wraps the tree; right-click its container.
    fireEvent.contextMenu(tree.parentElement as HTMLElement);

    expect(
      await screen.findByRole("menuitem", { name: /new request/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /new folder/i }),
    ).toBeInTheDocument();
    // no row-only actions on the empty-area menu.
    expect(
      screen.queryByRole("menuitem", { name: /rename/i }),
    ).not.toBeInTheDocument();
  });

  // AC-008 — render-contract: right-clicking a ROW inside the full tree (a row
  // ContextMenu nested inside the empty-area ContextMenu) shows the ROW menu
  // (Rename/Delete), NOT the empty-area create menu - radix inner-trigger wins.
  it("should show the row menu and not the create menu when a row is right-clicked", async () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
        <SidebarTree />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    fireEvent.contextMenu(
      within(tree).getByRole("treeitem", { name: "GET profile" }),
    );

    expect(
      await screen.findByRole("menuitem", { name: /rename/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /delete/i }),
    ).toBeInTheDocument();
    // the empty-area create items must NOT leak in from the outer menu.
    expect(
      screen.queryByRole("menuitem", { name: /new request/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /new folder/i }),
    ).not.toBeInTheDocument();
  });

  // AC-002 — behavior: choosing "New folder" from the empty-area menu adds a
  // root-level folder.
  it("should create a root folder when New folder is chosen from the empty-area menu", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
        <SidebarTree />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    const rootFoldersBefore = within(tree).getAllByRole("treeitem").length;

    fireEvent.contextMenu(tree.parentElement as HTMLElement);
    await user.click(
      await screen.findByRole("menuitem", { name: /new folder/i }),
    );

    // a new top-level row appears (the freshly created folder, in rename mode).
    expect(within(tree).getAllByRole("treeitem").length).toBeGreaterThan(
      rootFoldersBefore,
    );
  });

  // AC-003 — behavior: a freshly created folder's inline rename input is FOCUSED
  // so the name can be typed immediately (radix menu close must not keep focus).
  it("should focus the rename input of the folder created from the empty-area menu", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
        <SidebarTree />
      </WorkspaceProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    fireEvent.contextMenu(tree.parentElement as HTMLElement);
    await user.click(
      await screen.findByRole("menuitem", { name: /new folder/i }),
    );

    const input = await screen.findByRole("textbox");
    await waitFor(() => expect(input).toHaveFocus());
  });
});
