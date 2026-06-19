import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { formatForDisplay } from "@tanstack/hotkeys";

import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";
import { ShortcutsSection } from "@/components/settings/shortcuts-section";
import {
  SHORTCUT_ACTIONS,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";

// jsdom reports a non-mac platform, so Mod records as Control (learnings).
// Recording Control+Y should canonicalize to the "Mod+Y" override.

function renderSection(overrides: ShortcutOverrides = {}) {
  const seeded: Settings = { ...DEFAULT_SETTINGS, shortcuts: overrides };
  const inner = createInMemorySettingsStore(seeded);
  const saveSpy = vi.fn(inner.save);
  const store: SettingsStore = { load: inner.load, save: saveSpy };

  const result = render(
    <HotkeysProvider>
      <SettingsProvider store={store}>
        <ShortcutsSection />
      </SettingsProvider>
    </HotkeysProvider>,
  );

  return { ...result, saveSpy };
}

const TOGGLE_CONSOLE = SHORTCUT_ACTIONS.find((a) => a.id === "toggle-console")!;
const CLOSE_REQUEST = SHORTCUT_ACTIONS.find((a) => a.id === "close-request")!;

describe("ShortcutsSection", () => {
  // AC-006, TC-001 — behavior
  it("should render a row for every in-scope action", async () => {
    renderSection();

    for (const action of SHORTCUT_ACTIONS) {
      expect(await screen.findByText(action.name)).toBeInTheDocument();
    }
  });

  // AC-008 — behavior
  it("should show an Open command palette row in the shortcuts list", async () => {
    renderSection();

    expect(
      await screen.findByText("Open command palette"),
    ).toBeInTheDocument();
  });

  // AC-006 — behavior
  it("should show each action's current binding formatted for display", async () => {
    renderSection();

    const defaultLabel = formatForDisplay(TOGGLE_CONSOLE.defaultHotkey);
    expect(await screen.findByText(defaultLabel)).toBeInTheDocument();
  });

  // AC-006 — behavior
  it("should show the override binding label if an override is set", async () => {
    renderSection({ "toggle-console": "Mod+Y" });

    const overrideLabel = formatForDisplay("Mod+Y");
    expect(await screen.findByText(overrideLabel)).toBeInTheDocument();
  });

  // AC-003, TC-002 — side-effect-contract
  it("should persist the override if a new free combo is recorded for an action", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection();

    const editButton = await screen.findByRole("button", {
      name: new RegExp(`edit.*${TOGGLE_CONSOLE.name}`, "i"),
    });
    await user.click(editButton);

    // Mod+Y is unused by any other action -> free.
    await user.keyboard("{Control>}y{/Control}");

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0];
    expect(persisted.shortcuts["toggle-console"]).toBe("Mod+Y");
  });

  // AC-004, TC-003 — side-effect-contract
  it("should remove the override and restore the default if reset is clicked", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection({ "toggle-console": "Mod+K" });

    const resetButton = await screen.findByRole("button", {
      name: new RegExp(`reset.*${TOGGLE_CONSOLE.name}`, "i"),
    });
    await user.click(resetButton);

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0];
    expect(persisted.shortcuts).not.toHaveProperty("toggle-console");

    expect(
      await screen.findByText(formatForDisplay(TOGGLE_CONSOLE.defaultHotkey)),
    ).toBeInTheDocument();
  });

  // AC-005, TC-004 — behavior
  it("should name the owning action and not persist if a used combo is recorded", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection();

    const editButton = await screen.findByRole("button", {
      name: new RegExp(`edit.*${TOGGLE_CONSOLE.name}`, "i"),
    });
    await user.click(editButton);

    // close-request owns Mod+W by default; recording it for toggle-console conflicts.
    await user.keyboard("{Control>}w{/Control}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(new RegExp(CLOSE_REQUEST.name, "i"));
    expect(saveSpy).not.toHaveBeenCalled();
  });

  // AC-005, AC-006 — behavior
  it("should keep the default binding label if a conflicting combo is recorded", async () => {
    const user = userEvent.setup();
    renderSection();

    const editButton = await screen.findByRole("button", {
      name: new RegExp(`edit.*${TOGGLE_CONSOLE.name}`, "i"),
    });
    await user.click(editButton);
    await user.keyboard("{Control>}w{/Control}");

    // The conflict is blocked, so toggle-console still shows its default binding.
    expect(
      await screen.findByText(formatForDisplay(TOGGLE_CONSOLE.defaultHotkey)),
    ).toBeInTheDocument();
  });
});
