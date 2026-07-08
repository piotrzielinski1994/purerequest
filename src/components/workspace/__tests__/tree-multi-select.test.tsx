import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { ContentHeader } from "@/components/workspace/content-header";
import { fixtureTree } from "./fixtures";

//   v Auth
//      v OAuth ...
//   > Users
//   GET profile
//   DELETE session
// With Auth/OAuth/Users collapsed, the visible selectable rows in order are:
//   Auth, Users, GET profile, DELETE session.
function renderTree(expanded: string[] = []) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialExpandedIds={expanded}>
      <SidebarTree />
      <ContentHeader />
    </WorkspaceProvider>,
  );
}

const isSelected = (name: string) =>
  screen.getByRole("treeitem", { name }).getAttribute("aria-selected") ===
  "true";

describe("sidebar multi-select clicking", () => {
  // AC-001 - behavior (Cmd/Ctrl+click adds a second row to the selection)
  it("should add a row to the selection when it is Cmd/Ctrl-clicked", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(screen.getByRole("treeitem", { name: "Auth" }));
    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("treeitem", { name: "Users" }));
    await user.keyboard("{/Meta}");

    expect(isSelected("Auth")).toBe(true);
    expect(isSelected("Users")).toBe(true);
  });

  // AC-001 - behavior (a second Cmd/Ctrl+click on a selected row removes it)
  it("should remove a row from the selection when it is Cmd/Ctrl-clicked again", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(screen.getByRole("treeitem", { name: "Auth" }));
    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("treeitem", { name: "Users" }));
    await user.click(screen.getByRole("treeitem", { name: "Users" }));
    await user.keyboard("{/Meta}");

    expect(isSelected("Users")).toBe(false);
  });

  // AC-002 - behavior (Shift+click selects the contiguous range over the visible rows)
  it("should select the range from the anchor to the Shift-clicked row", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(screen.getByRole("treeitem", { name: "Auth" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("treeitem", { name: "GET profile" }));
    await user.keyboard("{/Shift}");

    // visible order: Auth, Users, GET profile -> all three in range.
    expect(isSelected("Auth")).toBe(true);
    expect(isSelected("Users")).toBe(true);
    expect(isSelected("GET profile")).toBe(true);
    expect(isSelected("DELETE session")).toBe(false);
  });

  // AC-003 - behavior (a plain click resets the selection to that single row)
  it("should reset the selection to a single row on a plain click", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("treeitem", { name: "Auth" }));
    await user.click(screen.getByRole("treeitem", { name: "Users" }));
    await user.keyboard("{/Meta}");
    // now {Auth, Users} selected; a plain click on DELETE session resets.
    await user.click(screen.getByRole("treeitem", { name: "DELETE session" }));

    expect(isSelected("Auth")).toBe(false);
    expect(isSelected("Users")).toBe(false);
    expect(isSelected("DELETE session")).toBe(true);
  });

  // AC-004 - behavior (a modifier click adjusts only the selection - no tab opens)
  it("should not open a request tab when a request is Cmd/Ctrl-clicked", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("treeitem", { name: "DELETE session" }));
    await user.keyboard("{/Meta}");

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(within(tablist).queryByRole("tab")).not.toBeInTheDocument();
    expect(isSelected("DELETE session")).toBe(true);
  });

  // AC-004 - behavior (a modifier click on a folder does not toggle its expansion)
  it("should not toggle a folder's expansion when it is Cmd/Ctrl-clicked", async () => {
    const user = userEvent.setup();
    renderTree();

    const auth = screen.getByRole("treeitem", { name: "Auth" });
    expect(auth).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("{Meta>}");
    await user.click(auth);
    await user.keyboard("{/Meta}");

    expect(auth).toHaveAttribute("aria-expanded", "false");
    expect(isSelected("Auth")).toBe(true);
  });
});
