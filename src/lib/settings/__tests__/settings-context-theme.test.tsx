import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type SettingsStore } from "@/lib/settings/settings";
import { SettingsProvider, useSettings } from "@/lib/settings/settings-context";

// Stage 1 — Themes feature. saveThemeMode persists the chosen mode through the
// store (AC-004) and exposes it on settings.theme.mode.

function ThemeModeProbe() {
  const { settings, saveThemeMode } = useSettings();

  return (
    <div>
      <span data-testid="mode">{settings.theme.mode}</span>
      <button type="button" onClick={() => saveThemeMode("dark")}>
        set dark
      </button>
      <button type="button" onClick={() => saveThemeMode("light")}>
        set light
      </button>
    </div>
  );
}

describe("SettingsProvider theme mode", () => {
  // AC-004 — behavior
  it("should set settings.theme.mode if saveThemeMode is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ThemeModeProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("mode")).toHaveTextContent("system");

    await user.click(screen.getByRole("button", { name: /set dark/i }));

    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("dark");
    });
  });

  // AC-004 — side-effect-contract
  it("should persist the mode via store.save if saveThemeMode is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <ThemeModeProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("mode");

    await user.click(screen.getByRole("button", { name: /set dark/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
    expect(saveSpy.mock.calls[0][0].theme.mode).toBe("dark");
  });

  // AC-004, TC-001 — side-effect-contract
  it("should round-trip a saved mode through the store to a fresh provider", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore({
      ...DEFAULT_SETTINGS,
      theme: { ...DEFAULT_SETTINGS.theme, mode: "system" },
    });

    const first = render(
      <SettingsProvider store={store}>
        <ThemeModeProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("mode");
    await user.click(screen.getByRole("button", { name: /set dark/i }));
    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("dark");
    });

    first.unmount();

    // A fresh provider over the same store must restore the dark choice.
    render(
      <SettingsProvider store={store}>
        <ThemeModeProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("mode")).toHaveTextContent("dark");
  });
});
