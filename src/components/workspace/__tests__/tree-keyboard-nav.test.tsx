import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { ContentHeader } from "@/components/workspace/content-header";
import { ToastProvider } from "@/components/ui/toast";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { fixtureTree } from "./fixtures";

//   v Auth
//      v OAuth
//         POST token
//   > Users            (folder, child: GET profile)
//   GET profile        (root leaf)
//   DELETE session     (root leaf)
// Fully expanded, the visible row order is:
//   Auth, OAuth, POST token, Users, <profile-in-Users>, GET profile, DELETE session.

function Probe() {
  const { beginRename } = useWorkspace();
  return (
    <button type="button" onClick={() => beginRename("req-profile")}>
      begin rename profile
    </button>
  );
}

async function renderTree(
  expanded: string[] = ["folder-auth", "folder-oauth"],
  shortcuts: (typeof DEFAULT_SETTINGS)["shortcuts"] = {},
) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts,
  });
  const result = render(
    <SettingsProvider store={store}>
      <ToastProvider>
        <WorkspaceProvider tree={fixtureTree} initialExpandedIds={expanded}>
          <SidebarTree />
          <ContentHeader />
          <Probe />
        </WorkspaceProvider>
      </ToastProvider>
    </SettingsProvider>,
  );
  // SettingsProvider renders null until its async store.load resolves; wait for
  // the tree before any synchronous row() lookup.
  await screen.findByRole("tree", { name: /collection/i });
  return result;
}

const row = (name: string) => screen.getByRole("treeitem", { name });
const isSelected = (name: string) =>
  row(name).getAttribute("aria-selected") === "true";

describe("tree keyboard navigation (AC-001)", () => {
  it("should move focus and selection down if ArrowDown on a focused row", async () => {
    const user = userEvent.setup();
    await renderTree();

    const auth = row("Auth");
    auth.focus();
    await user.keyboard("{ArrowDown}");

    expect(row("OAuth")).toHaveFocus();
    expect(isSelected("OAuth")).toBe(true);
  });

  it("should move focus back up if ArrowUp", async () => {
    const user = userEvent.setup();
    await renderTree();

    row("OAuth").focus();
    await user.keyboard("{ArrowUp}");

    expect(row("Auth")).toHaveFocus();
  });

  it("should be a no-op if ArrowUp on the first row", async () => {
    const user = userEvent.setup();
    await renderTree();

    const auth = row("Auth");
    auth.focus();
    await user.keyboard("{ArrowUp}");

    expect(auth).toHaveFocus();
  });

  it("should skip a collapsed folder's children if ArrowDown", async () => {
    const user = userEvent.setup();
    await renderTree([]); // all collapsed: visible = Auth, Users, profile, session

    const auth = row("Auth");
    auth.focus();
    await user.keyboard("{ArrowDown}");

    expect(row("Users")).toHaveFocus();
  });
});

describe("tree keyboard activate/toggle (AC-002)", () => {
  it("should open a request tab if Enter on a request row", async () => {
    const user = userEvent.setup();
    await renderTree();

    row("POST token").focus();
    await user.keyboard("{Enter}");

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(
      within(tablist).getByRole("tab", { name: "token" }),
    ).toBeInTheDocument();
  });

  it("should toggle a folder if Enter on an expanded folder row", async () => {
    const user = userEvent.setup();
    await renderTree();

    const auth = row("Auth");
    expect(auth).toHaveAttribute("aria-expanded", "true");
    auth.focus();
    await user.keyboard("{Enter}");

    expect(row("Auth")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("tree keyboard expand/collapse arrows (AC-003)", () => {
  it("should expand a collapsed folder if ArrowRight", async () => {
    const user = userEvent.setup();
    await renderTree([]);

    const auth = row("Auth");
    expect(auth).toHaveAttribute("aria-expanded", "false");
    auth.focus();
    await user.keyboard("{ArrowRight}");

    expect(row("Auth")).toHaveAttribute("aria-expanded", "true");
  });

  it("should move focus to the first child if ArrowRight on an expanded folder", async () => {
    const user = userEvent.setup();
    await renderTree();

    row("Auth").focus();
    await user.keyboard("{ArrowRight}");

    expect(row("OAuth")).toHaveFocus();
  });

  it("should collapse an expanded folder if ArrowLeft", async () => {
    const user = userEvent.setup();
    await renderTree();

    row("Auth").focus();
    await user.keyboard("{ArrowLeft}");

    expect(row("Auth")).toHaveAttribute("aria-expanded", "false");
  });

  it("should move focus to the parent if ArrowLeft on a child leaf", async () => {
    const user = userEvent.setup();
    await renderTree();

    // POST token is a leaf inside OAuth; ArrowLeft moves focus up to OAuth.
    row("POST token").focus();
    await user.keyboard("{ArrowLeft}");
    expect(row("OAuth")).toHaveFocus();
  });
});

describe("tree keyboard Home/End (AC-004)", () => {
  it("should focus the first visible row if Home", async () => {
    const user = userEvent.setup();
    await renderTree();

    row("DELETE session").focus();
    await user.keyboard("{Home}");

    expect(row("Auth")).toHaveFocus();
  });

  it("should focus the last visible row if End", async () => {
    const user = userEvent.setup();
    await renderTree();

    row("Auth").focus();
    await user.keyboard("{End}");

    expect(row("DELETE session")).toHaveFocus();
  });
});

describe("tree keyboard shift-range (AC-005)", () => {
  it("should extend the selection to the next row if Shift+ArrowDown", async () => {
    const user = userEvent.setup();
    await renderTree();

    // Click a request row to set the selection anchor (a folder click would
    // toggle it); Shift+ArrowDown then ranges from the anchor to the next row.
    await user.click(row("GET profile"));
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");

    expect(isSelected("GET profile")).toBe(true);
    expect(isSelected("DELETE session")).toBe(true);
  });
});

describe("tree roving tabindex (AC-006)", () => {
  it("should keep exactly one tree row in the Tab order", async () => {
    await renderTree();

    const tree = screen.getByRole("tree", { name: /collection/i });
    const tabbable = within(tree)
      .getAllByRole("treeitem")
      .filter((el) => el.getAttribute("tabindex") === "0");

    expect(tabbable).toHaveLength(1);
  });

  it("should move the tabbable row to follow the selection", async () => {
    const user = userEvent.setup();
    await renderTree();

    row("Auth").focus();
    await user.keyboard("{ArrowDown}"); // select OAuth

    expect(row("OAuth")).toHaveAttribute("tabindex", "0");
    expect(row("Auth")).toHaveAttribute("tabindex", "-1");
  });
});

describe("tree keyboard alt-move (AC-007)", () => {
  const treeIds = () =>
    screen
      .getByRole("tree", { name: /collection/i })
      .querySelectorAll('[role="treeitem"]');

  it("should reorder a root node down among its siblings if Alt+ArrowDown", async () => {
    const user = userEvent.setup();
    await renderTree([]); // collapsed: root rows visible = Auth, Users, profile, session

    // GET profile (root) Alt+ArrowDown past DELETE session.
    const profile = row("GET profile");
    profile.focus();
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");

    // After the move, the visible root order should list session before profile.
    const names = Array.from(treeIds()).map(
      (el) => el.getAttribute("aria-label") ?? el.textContent ?? "",
    );
    const sessionIdx = names.findIndex((n) => n.includes("session"));
    const profileIdx = names.findIndex((n) => n.includes("profile"));
    expect(sessionIdx).toBeLessThan(profileIdx);
  });

  it("should be a no-op if Alt+ArrowUp on the first root sibling", async () => {
    const user = userEvent.setup();
    await renderTree([]);

    const before = Array.from(treeIds()).map((el) =>
      el.getAttribute("aria-label"),
    );
    row("Auth").focus();
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    const after = Array.from(treeIds()).map((el) =>
      el.getAttribute("aria-label"),
    );

    expect(after).toEqual(before);
  });
});

describe("tree context-menu key (AC-008)", () => {
  it("should open the row context menu if Shift+F10 is pressed on a focused row", async () => {
    const user = userEvent.setup();
    await renderTree();

    const profile = row("GET profile");
    profile.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");

    expect(
      await screen.findByRole("menuitem", { name: /rename/i }),
    ).toBeInTheDocument();
  });

  it("should open the row context menu if the ContextMenu key is pressed on a focused row", async () => {
    const user = userEvent.setup();
    await renderTree();

    const profile = row("GET profile");
    profile.focus();
    await user.keyboard("{ContextMenu}");

    expect(
      await screen.findByRole("menuitem", { name: /rename/i }),
    ).toBeInTheDocument();
  });

  it("should close the row context menu if Escape is pressed", async () => {
    const user = userEvent.setup();
    await renderTree();

    const profile = row("GET profile");
    profile.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(
      await screen.findByRole("menuitem", { name: /rename/i }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("menuitem", { name: /rename/i }),
    ).not.toBeInTheDocument();
  });

  it("should let the open menu own arrow keys, not the tree (no double-handle)", async () => {
    const user = userEvent.setup();
    await renderTree();

    await user.click(row("GET profile"));
    fireEvent.contextMenu(row("GET profile"));
    await screen.findByRole("menuitem", { name: /rename/i });

    // The menu is a focus-trapped portal that aria-hides the tree, so ArrowDown
    // moves the menu highlight (a menuitem gains focus) and the tree's own
    // key handler never sees the key. The menu stays open, and the highlighted
    // element is a menuitem - never a treeitem.
    await user.keyboard("{ArrowDown}");

    expect(
      screen.getByRole("menuitem", { name: /rename/i }),
    ).toBeInTheDocument();
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
  });
});

describe("tree keyboard suppressed during rename (AC-011)", () => {
  it("should not move tree selection if ArrowDown is pressed inside the rename input", async () => {
    const user = userEvent.setup();
    await renderTree();

    await user.click(
      screen.getByRole("button", { name: /begin rename profile/i }),
    );
    const input = await screen.findByRole("textbox", { name: /rename/i });
    input.focus();

    await user.keyboard("{ArrowDown}");

    // The rename input keeps focus; no treeitem stole it.
    expect(input).toHaveFocus();
  });
});

describe("tree keyboard reconfigurable bindings", () => {
  it("should move focus with a rebound tree-nav-down key (custom binding honoured end-to-end)", async () => {
    const user = userEvent.setup();
    // Rebind next-row from ArrowDown to a custom combo.
    await renderTree(["folder-auth", "folder-oauth"], {
      "tree-nav-down": ["Mod+ArrowDown"],
    });

    const auth = row("Auth");
    auth.focus();

    // The old default no longer navigates.
    await user.keyboard("{ArrowDown}");
    expect(row("Auth")).toHaveFocus();

    // The custom binding does (Mod = Ctrl in the vitest/windows env).
    await user.keyboard("{Control>}{ArrowDown}{/Control}");
    expect(row("OAuth")).toHaveFocus();
  });
});
