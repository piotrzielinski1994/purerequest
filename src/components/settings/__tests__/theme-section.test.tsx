import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeSection } from "@/components/settings/theme-section";
import { createFakeHttpClient } from "@/components/workspace/__tests__/fake-http-client";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsStore,
  type ThemeMode,
} from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { ThemeProvider } from "@/lib/theme/theme-context";

// Stage 1 — Themes feature. The Theme section is a mode selector (light / dark /
// system). Selecting a mode saves it (saveThemeMode / useTheme().setMode) and the
// current mode reflects as the selected control.

// jsdom has no matchMedia; the ThemeProvider subscribes to it, so stub it.
function stubMatchMedia(matches = false) {
  window.matchMedia = ((query: string) => {
    void query;
    return {
      matches,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    };
  }) as unknown as typeof window.matchMedia;
}

function renderSection(mode: ThemeMode = "system") {
  stubMatchMedia(false);
  const seeded: Settings = {
    ...DEFAULT_SETTINGS,
    theme: { ...DEFAULT_SETTINGS.theme, mode },
  };
  const inner = createInMemorySettingsStore(seeded);
  const saveSpy = vi.fn(inner.save);
  const store: SettingsStore = { load: inner.load, save: saveSpy };

  const result = render(
    <SettingsProvider store={store}>
      <ThemeProvider>
        <WorkspaceProvider httpClient={createFakeHttpClient()}>
          <ThemeSection />
        </WorkspaceProvider>
      </ThemeProvider>
    </SettingsProvider>,
  );

  return { ...result, saveSpy };
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  // @ts-expect-error — drop the stub between tests.
  delete window.matchMedia;
});

describe("ThemeSection", () => {
  // AC-004 — behavior
  it("should render a Light, Dark, and System control", async () => {
    renderSection();

    expect(
      await screen.findByRole("button", { name: /light/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /system/i })).toBeInTheDocument();
  });

  // AC-002, AC-004 — side-effect-contract
  it("should persist theme.mode dark if Dark is selected", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection("system");

    const dark = await screen.findByRole("button", { name: /dark/i });
    await user.click(dark);

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0];
    expect(persisted.theme.mode).toBe("dark");
  });

  // AC-001, AC-004 — side-effect-contract
  it("should persist theme.mode light if Light is selected", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection("dark");

    const light = await screen.findByRole("button", { name: /light/i });
    await user.click(light);

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0];
    expect(persisted.theme.mode).toBe("light");
  });

  // AC-004 — behavior
  it("should mark the current mode as the selected control", async () => {
    renderSection("dark");

    const dark = await screen.findByRole("button", { name: /dark/i });
    await waitFor(() => {
      expect(dark).toHaveAttribute("aria-pressed", "true");
    });
  });

  // AC-002 — side-effect-contract
  it("should apply dark live to the html element if Dark is selected", async () => {
    const user = userEvent.setup();
    renderSection("light");

    const dark = await screen.findByRole("button", { name: /dark/i });
    await user.click(dark);

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });
});
