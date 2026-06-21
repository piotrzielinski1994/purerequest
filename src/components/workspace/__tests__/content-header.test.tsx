import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { ContentHeader } from "@/components/workspace/content-header";
import { fixtureTree } from "./fixtures";

function OpenEnvButton() {
  const { openEnvEditor } = useWorkspace();
  return (
    <button type="button" onClick={openEnvEditor}>
      open env
    </button>
  );
}

function EditUrlButton({ id }: { id: string }) {
  const { setRequestUrl } = useWorkspace();
  return (
    <button type="button" onClick={() => setRequestUrl(id, "https://edited.test")}>
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
    await user.click(within(tree).getByRole("treeitem", { name: "POST token" }));

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
    await user.click(within(tree).getByRole("treeitem", { name: "POST token" }));

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(within(tablist).getByRole("tab", { name: "profile" })).toBeInTheDocument();
    expect(within(tablist).getByRole("tab", { name: "token" })).toBeInTheDocument();

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

    expect(within(tablist).getAllByRole("tab", { name: "token" })).toHaveLength(1);

    await user.click(within(tree).getByRole("treeitem", { name: "POST token" }));

    expect(within(tablist).getAllByRole("tab", { name: "token" })).toHaveLength(1);
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
    await user.click(within(tree).getByRole("treeitem", { name: "POST token" }));

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
    expect(within(tablist).getByRole("tab", { name: "profile" })).toBeInTheDocument();

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
    await user.click(within(folderRow).getByRole("button", { name: /edit config/i }));

    expect(
      within(tablist).getByRole("tab", { name: "profile" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  // behavior: activating a request tab leaves the folder config editor.
  it("should leave the folder config editor when a request tab is clicked", async () => {
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
    await user.click(within(folderRow).getByRole("button", { name: /edit config/i }));

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    await user.click(within(tablist).getByRole("tab", { name: "profile" }));

    expect(
      within(tablist).getByRole("tab", { name: "profile" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      within(tablist).queryByRole("tab", { name: /config/i }),
    ).not.toBeInTheDocument();
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
    await user.click(within(folderRow).getByRole("button", { name: /edit config/i }));

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const editorTab = within(tablist).getByRole("tab", { name: /config/i });
    expect(editorTab).toHaveAttribute("aria-selected", "true");
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
    await user.click(within(folderRow).getByRole("button", { name: /edit config/i }));

    await user.click(screen.getByRole("button", { name: /close config editor/i }));

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(
      within(tablist).queryByRole("tab", { name: /config/i }),
    ).not.toBeInTheDocument();
    expect(
      within(tablist).getByRole("tab", { name: "profile" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  // behavior: opening the .env editor adds a distinct .env tab.
  it("should show a .env tab when the env editor is opened", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={[]}
        initialActiveRequestId="req-profile"
        envText="TOKEN=seed"
      >
        <ContentHeader />
        <button type="button" onClick={() => {}}>
          noop
        </button>
        <OpenEnvButton />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /open env/i }));

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(
      within(tablist).getByRole("tab", { name: /\.env/i }),
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
