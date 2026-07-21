import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Main } from "@/components/workspace/main";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type ThemeMode } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { createFakeHttpClient } from "./fake-http-client";
import { fixtureTree } from "./fixtures";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

const mockToast = vi.mocked(toast);

// jsdom has no matchMedia; the ThemeProvider subscribes to it.
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

function renderMain(mode: ThemeMode) {
  stubMatchMedia(false);
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    theme: { ...DEFAULT_SETTINGS.theme, mode },
  });
  return render(
    <SettingsProvider store={store}>
      <ThemeProvider>
        <WorkspaceProvider
          tree={fixtureTree}
          httpClient={createFakeHttpClient()}
        >
          <Main />
        </WorkspaceProvider>
      </ThemeProvider>
    </SettingsProvider>,
  );
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  // @ts-expect-error - drop the stub between tests.
  delete window.matchMedia;
});

describe("toggle-theme shortcut", () => {
  // behavior: the default Mod+Shift+L cycles light -> dark, applying .dark live.
  it("should cycle from light to dark and add the dark class if the toggle-theme hotkey fires", async () => {
    const user = userEvent.setup();
    renderMain("light");
    await screen.findByRole("region", { name: /console/i });

    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // jsdom maps Mod -> Control (non-mac test platform), per learnings #11.
    await user.keyboard("{Control>}{Shift>}l{/Shift}{/Control}");

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });

  // behavior: the toggle shows a toast naming the chosen mode (so a System->Dark
  // switch on an already-dark OS is still legible).
  it("should show a toast naming the chosen mode if the toggle-theme hotkey fires", async () => {
    const user = userEvent.setup();
    renderMain("light");
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}{Shift>}l{/Shift}{/Control}");

    await waitFor(() => {
      expect(
        mockToast.mock.calls.some((c) => /theme: dark/i.test(String(c[0]))),
      ).toBe(true);
    });
  });
});
