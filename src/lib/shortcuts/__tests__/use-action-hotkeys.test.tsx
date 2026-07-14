import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import type { ReactNode } from "react";

import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { useActionHotkeys } from "@/lib/shortcuts/use-action-hotkeys";
import {
  type ShortcutActionId,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";

// jsdom reports a non-mac platform, so the lib resolves Mod -> Control (learnings).
// We therefore fire Control+J to trigger the "Mod+J" toggle-console default.

function Harness({
  handlers,
}: {
  handlers: Partial<Record<ShortcutActionId, () => void>>;
}) {
  useActionHotkeys(handlers);
  return (
    <div>
      <span data-testid="ready">ready</span>
      <input data-testid="text-input" aria-label="some field" />
    </div>
  );
}

function renderHarness(
  handlers: Partial<Record<ShortcutActionId, () => void>>,
  overrides: ShortcutOverrides = {},
) {
  const seeded: Settings = { ...DEFAULT_SETTINGS, shortcuts: overrides };
  const store = createInMemorySettingsStore(seeded);
  return render(
    <HotkeysProvider>
      <SettingsProvider store={store}>
        <Harness handlers={handlers} />
      </SettingsProvider>
    </HotkeysProvider>,
  );
}

function withProviders(children: ReactNode, overrides: ShortcutOverrides = {}) {
  const seeded: Settings = { ...DEFAULT_SETTINGS, shortcuts: overrides };
  const store = createInMemorySettingsStore(seeded);
  return (
    <HotkeysProvider>
      <SettingsProvider store={store}>{children}</SettingsProvider>
    </HotkeysProvider>
  );
}

describe("useActionHotkeys", () => {
  // AC-002, TC-001 — behavior
  it("should run the handler if the action's effective hotkey is pressed", async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();

    renderHarness({ "toggle-console": toggle });
    await screen.findByTestId("ready");

    await user.keyboard("{Control>}j{/Control}");

    expect(toggle).toHaveBeenCalledTimes(1);
  });

  // AC-002, TC-002 — behavior
  it("should run the handler on the overridden hotkey if an override is set", async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();

    renderHarness({ "toggle-console": toggle }, { "toggle-console": ["Mod+K"] });
    await screen.findByTestId("ready");

    await user.keyboard("{Control>}k{/Control}");

    expect(toggle).toHaveBeenCalledTimes(1);
  });

  // AC-002, TC-002 — behavior: every binding in a multi-binding list fires.
  it("should run the handler on each bound hotkey if the action has several", async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();

    renderHarness(
      { "toggle-console": toggle },
      { "toggle-console": ["Mod+J", "Mod+K"] },
    );
    await screen.findByTestId("ready");

    await user.keyboard("{Control>}j{/Control}");
    await user.keyboard("{Control>}k{/Control}");

    expect(toggle).toHaveBeenCalledTimes(2);
  });

  // AC-004, TC-004 — behavior: a disabled ([]) action never fires.
  it("should not run the handler if the action is disabled with an empty list", async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();

    renderHarness({ "toggle-console": toggle }, { "toggle-console": [] });
    await screen.findByTestId("ready");

    await user.keyboard("{Control>}j{/Control}");

    expect(toggle).not.toHaveBeenCalled();
  });

  // AC-008, TC-006 — behavior: bare-key bindings stay suppressed while typing.
  it("should not run a bare-key handler if focus is in a text input", async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();

    renderHarness({ "toggle-console": toggle }, { "toggle-console": ["p"] });
    await screen.findByTestId("ready");

    await user.click(screen.getByTestId("text-input"));
    await user.keyboard("p");

    expect(toggle).not.toHaveBeenCalled();
  });

  // behavior: Mod/Ctrl combos DO fire while typing so the palette/save/send
  // shortcuts keep working inside the URL field and the config editor.
  it("should run a Mod-combo handler even if focus is in a text input", async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();

    renderHarness({ "toggle-console": toggle });
    await screen.findByTestId("ready");

    await user.click(screen.getByTestId("text-input"));
    await user.keyboard("{Control>}j{/Control}");

    expect(toggle).toHaveBeenCalledTimes(1);
  });

  // AC-002 — behavior
  it("should not register an action whose handler is not supplied", async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();

    // Only toggle-console is handled; close-request (Mod+W) is not.
    renderHarness({ "toggle-console": toggle });
    await screen.findByTestId("ready");

    await user.keyboard("{Control>}w{/Control}");

    expect(toggle).not.toHaveBeenCalled();
  });

  // AC-009, TC-007 — behavior
  it("should not throw if a guarded handler is a no-op when there is nothing to act on", async () => {
    const user = userEvent.setup();
    // A handler that guards on "no open request" and simply returns.
    const closeRequest = vi.fn(() => undefined);

    function GuardedHarness() {
      useActionHotkeys({ "close-request": closeRequest });
      return <span data-testid="ready">ready</span>;
    }

    render(withProviders(<GuardedHarness />));
    await screen.findByTestId("ready");

    await expect(user.keyboard("{Control>}w{/Control}")).resolves.not.toThrow();
    expect(closeRequest).toHaveBeenCalledTimes(1);
  });
});
