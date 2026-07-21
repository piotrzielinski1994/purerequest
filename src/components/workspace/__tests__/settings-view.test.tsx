import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SettingsView } from "@/components/workspace/settings-view";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import type { SettingsSection } from "@/lib/settings/settings";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { fixtureTree } from "./fixtures";

async function renderSettings(section?: SettingsSection) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
    settingsSection: section,
  });
  const result = render(
    <SettingsProvider store={store}>
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
        <SettingsView />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
  await screen.findByRole("tablist", { name: /settings sections/i });
  return { store, ...result };
}

describe("SettingsView sub-tabs (AC-001)", () => {
  it("should render a Theme / Env / Shortcuts section tablist", async () => {
    await renderSettings();
    const tablist = screen.getByRole("tablist", { name: /settings sections/i });
    expect(
      within(tablist).getByRole("tab", { name: /theme/i }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole("tab", { name: /env/i }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole("tab", { name: /shortcut/i }),
    ).toBeInTheDocument();
  });

  it("should show the Theme section by default and hide the Shortcuts body", async () => {
    await renderSettings();
    // Theme body marker (the mode selector heading/text).
    expect(screen.getByText(/choose the app appearance/i)).toBeInTheDocument();
    // Shortcuts body should not be mounted while Theme is active.
    expect(screen.queryByText(/keyboard shortcuts/i)).not.toBeInTheDocument();
  });

  it("should switch to the Shortcuts section when its tab is clicked (AC-001)", async () => {
    const user = userEvent.setup();
    await renderSettings();
    await user.click(screen.getByRole("tab", { name: /shortcut/i }));

    expect(screen.getByText(/keyboard shortcuts/i)).toBeInTheDocument();
    // Theme body no longer shown.
    expect(
      screen.queryByText(/choose the app appearance/i),
    ).not.toBeInTheDocument();
  });

  it("should open on the persisted section (AC-002)", async () => {
    await renderSettings("shortcuts");
    expect(screen.getByText(/keyboard shortcuts/i)).toBeInTheDocument();
  });

  it("should persist the chosen section via the settings store (AC-002)", async () => {
    const user = userEvent.setup();
    const { store } = await renderSettings();
    await user.click(screen.getByRole("tab", { name: /env/i }));

    const saved = await store.load();
    expect(saved.settingsSection).toBe("env");
  });

  it("should fall back to Theme for an invalid persisted section", async () => {
    // An out-of-range value is normalised to "theme" on load.
    const store = createInMemorySettingsStore({
      ...DEFAULT_SETTINGS,
      // @ts-expect-error deliberately invalid persisted value
      settingsSection: "bogus",
    });
    render(
      <SettingsProvider store={store}>
        <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
          <SettingsView />
        </WorkspaceProvider>
      </SettingsProvider>,
    );
    await screen.findByRole("tablist", { name: /settings sections/i });
    expect(screen.getByText(/choose the app appearance/i)).toBeInTheDocument();
  });
});
