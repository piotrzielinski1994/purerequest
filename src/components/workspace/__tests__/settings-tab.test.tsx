import { describe, it, expect } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { Main } from "@/components/workspace/main";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { fixtureTree } from "./fixtures";

function renderShell(initialActiveRequestId = "req-profile") {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={["[12:00:00] Ready."]}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId={initialActiveRequestId}
      >
        <SidebarTree />
        <Main />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

async function openSecondTab(user: ReturnType<typeof userEvent.setup>) {
  // profile is open+active; open token as a second tab via the tree.
  const tree = screen.getByRole("tree", { name: /collection/i });
  await user.click(within(tree).getByRole("treeitem", { name: "POST token" }));
}

describe("Request tab cycling via Ctrl+Tab", () => {
  // AC-001, TC-001 — behavior
  it("should activate the next request tab and wrap if Ctrl+Tab is pressed", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await openSecondTab(user);

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const profileTab = within(tablist).getByRole("tab", { name: "profile" });
    const tokenTab = within(tablist).getByRole("tab", { name: "token" });

    // token became active when opened; Ctrl+Tab wraps to profile.
    expect(tokenTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Control>}{Tab}{/Control}");
    expect(profileTab).toHaveAttribute("aria-selected", "true");
    expect(tokenTab).toHaveAttribute("aria-selected", "false");

    await user.keyboard("{Control>}{Tab}{/Control}");
    expect(tokenTab).toHaveAttribute("aria-selected", "true");
    expect(profileTab).toHaveAttribute("aria-selected", "false");
  });

  // AC-001, TC-001 — behavior
  it("should activate the previous request tab and wrap if Ctrl+Shift+Tab is pressed", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await openSecondTab(user);

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const profileTab = within(tablist).getByRole("tab", { name: "profile" });
    const tokenTab = within(tablist).getByRole("tab", { name: "token" });

    // token active; Ctrl+Shift+Tab steps to profile (index 0 -> wraps backwards is profile here).
    await user.keyboard("{Control>}{Shift>}{Tab}{/Shift}{/Control}");
    expect(profileTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Control>}{Shift>}{Tab}{/Shift}{/Control}");
    expect(tokenTab).toHaveAttribute("aria-selected", "true");
  });

  // AC-001, TC-006 — behavior
  it("should not change the active request if Ctrl+Tab fires with a single open tab", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const profileTab = within(tablist).getByRole("tab", { name: "profile" });
    expect(profileTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Control>}{Tab}{/Control}");
    await user.keyboard("{Control>}{Shift>}{Tab}{/Shift}{/Control}");

    expect(profileTab).toHaveAttribute("aria-selected", "true");
    expect(within(tablist).getAllByRole("tab")).toHaveLength(1);
  });
});

describe("Settings as an in-app tab", () => {
  // AC-002, TC-002 — behavior
  it("should preserve open tabs, the active request and expanded folders if settings is opened then closed", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await openSecondTab(user);
    // Re-activate profile so the preserved active request is unambiguous.
    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    await user.click(within(tablist).getByRole("tab", { name: "profile" }));

    const tree = screen.getByRole("tree", { name: /collection/i });
    // OAuth folder is expanded (from initialExpandedIds) so its child request is in the DOM.
    expect(
      within(tree).getByRole("treeitem", { name: "POST token" }),
    ).toBeInTheDocument();

    // Open settings via the hotkey (Mod+Shift+S resolves to Control+Shift+S under jsdom).
    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    expect(
      await screen.findByRole("tablist", { name: /settings sections/i }),
    ).toBeInTheDocument();

    // Close (deactivate) settings via Escape.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("tablist", { name: /settings sections/i }),
      ).not.toBeInTheDocument();
    });

    // Workspace state survived: both request tabs still present.
    expect(
      within(tablist).getByRole("tab", { name: "profile" }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole("tab", { name: "token" }),
    ).toBeInTheDocument();
    // The previously-active request is active again.
    expect(
      within(tablist).getByRole("tab", { name: "profile" }),
    ).toHaveAttribute("aria-selected", "true");
    // The expanded folder is still expanded (its child still in the DOM).
    expect(
      within(tree).getByRole("treeitem", { name: "POST token" }),
    ).toBeInTheDocument();
  });

  // AC-003, TC-003 — behavior
  it("should keep the sidebar tree and console in the DOM and show the shortcuts heading in content if settings is active", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");

    expect(
      await screen.findByRole("tablist", { name: /settings sections/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tree", { name: /collection/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /console/i }),
    ).toBeInTheDocument();
  });

  // AC-003 — behavior
  it("should render a Settings tab with a close control if settings is open", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");

    const settingsTab = await screen.findByRole("tab", { name: /settings/i });
    expect(settingsTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("button", { name: /close settings/i }),
    ).toBeInTheDocument();
  });

  // AC-002 — side-effect-contract
  it("should deactivate settings but keep its tab open if a request tab is clicked", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const settingsTab = within(tablist).getByRole("tab", { name: /settings/i });
    expect(settingsTab).toHaveAttribute("aria-selected", "true");

    await user.click(within(tablist).getByRole("tab", { name: "profile" }));

    // Settings deactivated -> content shows the request, not the shortcuts heading.
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /keyboard shortcuts/i }),
      ).not.toBeInTheDocument();
    });
    // The Settings tab is still present (open), just not active.
    expect(
      within(tablist).getByRole("tab", { name: /settings/i }),
    ).toHaveAttribute("aria-selected", "false");
  });

  // AC-001 — behavior: Settings is a real tab in the ordered list, so Ctrl+Tab
  // cycles onto/off it like any other. From Settings (last), Ctrl+Tab wraps to the
  // first request tab, deactivating Settings.
  it("should cycle off the Settings tab and show a request if Ctrl+Tab fires while settings is active", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await openSecondTab(user);
    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    await user.click(within(tablist).getByRole("tab", { name: "profile" }));

    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    // Settings is now the active tab (last in the list: profile, token, settings).
    expect(
      within(tablist).getByRole("tab", { name: /settings/i }),
    ).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Control>}{Tab}{/Control}");

    // Wrapped to the first tab (profile); Settings deactivated but still present.
    await waitFor(() => {
      expect(
        within(tablist).getByRole("tab", { name: "profile" }),
      ).toHaveAttribute("aria-selected", "true");
    });
    expect(
      within(tablist).getByRole("tab", { name: /settings/i }),
    ).toHaveAttribute("aria-selected", "false");
  });

  // AC-001, AC-009 — behavior: after Esc deactivates Settings (tab stays), the
  // active tab is a request and Ctrl+Shift+Tab keeps cycling requests.
  it("should cycle tabs after settings is deactivated with Escape", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await openSecondTab(user);
    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    await user.click(within(tablist).getByRole("tab", { name: "profile" }));

    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    await screen.findByRole("tablist", { name: /settings sections/i });
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("tablist", { name: /settings sections/i }),
      ).not.toBeInTheDocument();
    });

    // A request tab is active again (Esc returned to the last non-settings tab).
    const active = within(tablist)
      .getAllByRole("tab")
      .find((t) => t.getAttribute("aria-selected") === "true");
    expect(active?.textContent).toMatch(/profile|token/);
    // The Settings tab is still open (Esc only deactivates).
    expect(
      within(tablist).getByRole("tab", { name: /settings/i }),
    ).toBeInTheDocument();
  });
});
