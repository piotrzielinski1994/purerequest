import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { formatForDisplay } from "@tanstack/hotkeys";

import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { ShortcutsSection } from "@/components/settings/shortcuts-section";
import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";

function renderSection() {
  const store = createInMemorySettingsStore({ ...DEFAULT_SETTINGS });
  return render(
    <HotkeysProvider>
      <SettingsProvider store={store}>
        <ShortcutsSection />
      </SettingsProvider>
    </HotkeysProvider>,
  );
}

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("ShortcutsSection new actions", () => {
  // AC-007, TC-007 — behavior
  it("should render rows for toggle-sidebar, new-request and open-workspace", async () => {
    renderSection();

    const ids: ShortcutActionId[] = [
      "toggle-sidebar",
      "new-request",
      "open-workspace",
    ];

    for (const id of ids) {
      const action = findAction(id);
      expect(action).toBeDefined();
      expect(await screen.findByText(action!.name)).toBeInTheDocument();
    }
  });

  // AC-007, TC-007 — behavior
  it("should show the formatted default bindings for the new actions", async () => {
    renderSection();

    // Wait for the async settings load before reading labels.
    await screen.findByRole("heading", { name: /keyboard shortcuts/i });

    expect(screen.getByText(formatForDisplay("Mod+B"))).toBeInTheDocument();
    expect(screen.getByText(formatForDisplay("Mod+T"))).toBeInTheDocument();
    expect(screen.getByText(formatForDisplay("Mod+O"))).toBeInTheDocument();
  });
});
