import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { ContentHeader } from "@/components/workspace/content-header";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { ToastProvider } from "@/components/ui/toast";
import { fixtureTree } from "./fixtures";

// Drives the tab strip via a probe (context openSettings/setActiveRequest) so the
// tests don't depend on the global shortcut wiring.
function Probe() {
  const { openSettings } = useWorkspace();
  return (
    <button type="button" onClick={openSettings}>
      probe open settings
    </button>
  );
}

async function renderHeader(openIds: string[] = ["req-profile", "req-token"]) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  render(
    <SettingsProvider store={store}>
      <ToastProvider>
        <WorkspaceProvider
          tree={fixtureTree}
          initialOpenRequestIds={openIds}
          initialActiveRequestId={openIds[0]}
        >
          <ContentHeader />
          <Probe />
        </WorkspaceProvider>
      </ToastProvider>
    </SettingsProvider>,
  );
  await screen.findByRole("tablist", { name: /open requests/i });
}

const tablist = () => screen.getByRole("tablist", { name: /open requests/i });
const openSettings = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /probe open settings/i }));

describe("Settings tab is a real tab (AC-003/004)", () => {
  it("should keep the Settings tab present + deactivated after activating a request tab", async () => {
    const user = userEvent.setup();
    await renderHeader();
    await openSettings(user);

    expect(
      within(tablist()).getByRole("tab", { name: /settings/i }),
    ).toHaveAttribute("aria-selected", "true");

    // Activate the profile request tab.
    await user.click(within(tablist()).getByRole("tab", { name: "profile" }));

    const settingsTab = within(tablist()).getByRole("tab", { name: /settings/i });
    expect(settingsTab).toBeInTheDocument();
    expect(settingsTab).toHaveAttribute("aria-selected", "false");
  });

  it("should re-activate the Settings tab when clicked after a request tab", async () => {
    const user = userEvent.setup();
    await renderHeader();
    await openSettings(user);
    await user.click(within(tablist()).getByRole("tab", { name: "profile" }));

    await user.click(within(tablist()).getByRole("tab", { name: /settings/i }));
    expect(
      within(tablist()).getByRole("tab", { name: /settings/i }),
    ).toHaveAttribute("aria-selected", "true");
  });
});

describe("Settings tab context menu + close (AC-006/007)", () => {
  it("should open a context menu with Close on the Settings tab", async () => {
    const user = userEvent.setup();
    await renderHeader();
    await openSettings(user);

    fireEvent.contextMenu(
      within(tablist()).getByRole("tab", { name: /settings/i }),
    );
    expect(
      await screen.findByRole("menuitem", { name: /^close$/i }),
    ).toBeInTheDocument();
  });

  it("should remove the Settings tab and activate an adjacent tab when its close button is clicked", async () => {
    const user = userEvent.setup();
    await renderHeader(["req-profile"]);
    await openSettings(user);

    await user.click(screen.getByRole("button", { name: /close settings/i }));

    expect(
      within(tablist()).queryByRole("tab", { name: /settings/i }),
    ).toBeNull();
    expect(
      within(tablist()).getByRole("tab", { name: "profile" }),
    ).toHaveAttribute("aria-selected", "true");
  });
});

describe("Settings tab counts as a tab for Close-other (AC-010)", () => {
  it("should enable a request tab's Close other tabs when only Settings is the other tab", async () => {
    const user = userEvent.setup();
    await renderHeader(["req-profile"]);
    await openSettings(user);
    // Now open: [profile, settings]. Right-click profile.
    fireEvent.contextMenu(
      within(tablist()).getByRole("tab", { name: "profile" }),
    );

    const closeOthers = await screen.findByRole("menuitem", {
      name: /close other tabs/i,
    });
    const isDisabled =
      closeOthers.getAttribute("aria-disabled") === "true" ||
      closeOthers.hasAttribute("data-disabled");
    expect(isDisabled).toBe(false);

    await user.click(closeOthers);
    // Settings closed, only profile remains.
    expect(
      within(tablist()).queryByRole("tab", { name: /settings/i }),
    ).toBeNull();
    expect(
      within(tablist()).getByRole("tab", { name: "profile" }),
    ).toBeInTheDocument();
  });
});

describe("Settings tab reorder handle (AC-005)", () => {
  it("should give the Settings tab a keyboard-draggable sortable handle", async () => {
    const user = userEvent.setup();
    await renderHeader();
    await openSettings(user);

    const settingsTab = within(tablist()).getByRole("tab", { name: /settings/i });
    const handle = settingsTab.closest("[aria-roledescription]") as HTMLElement;
    expect(handle).not.toBeNull();
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");

    handle.focus();
    await user.keyboard(" ");
    expect(handle).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Tab chip has no dead click zones (AC-011)", () => {
  it("should activate a request tab when its chip padding (not the label) is clicked", async () => {
    const user = userEvent.setup();
    await renderHeader(["req-profile", "req-token"]);
    // token is active initially? no - profile (openIds[0]) is active.
    const tokenTab = within(tablist()).getByRole("tab", { name: "token" });
    expect(tokenTab).toHaveAttribute("aria-selected", "false");

    // The activate onClick lives on the whole chip (role=tab wrapper), so clicking
    // the tab element itself - not only its inner text - activates it.
    await user.click(tokenTab);
    expect(
      within(tablist()).getByRole("tab", { name: "token" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("should NOT activate when the close button on an inactive tab is clicked", async () => {
    const user = userEvent.setup();
    await renderHeader(["req-profile", "req-token"]);
    // Close the inactive token tab via its X; profile stays active, token gone.
    await user.click(screen.getByRole("button", { name: /close token/i }));

    expect(
      within(tablist()).queryByRole("tab", { name: "token" }),
    ).toBeNull();
    expect(
      within(tablist()).getByRole("tab", { name: "profile" }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
