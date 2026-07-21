import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type ThemeMode } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { ThemeProvider, useTheme } from "@/lib/theme/theme-context";

// Stage 1 — Themes feature. The ThemeProvider mounts INSIDE a SettingsProvider,
// reads settings.theme.mode, and as a side effect toggles the `dark` class on
// document.documentElement for the effective mode. Under "system" it follows a
// stubbed matchMedia and reacts live to a dispatched `change` event (AC-003).

// jsdom has no matchMedia — install a controllable stub per test.
type MediaListener = (event: { matches: boolean }) => void;

function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<MediaListener>();
  const mql = {
    matches: initialMatches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: MediaListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: MediaListener) => {
      listeners.delete(listener);
    },
    // legacy API some implementations call
    addListener: (listener: MediaListener) => listeners.add(listener),
    removeListener: (listener: MediaListener) => listeners.delete(listener),
    dispatchEvent: () => true,
  };

  window.matchMedia = ((query: string) => {
    void query;
    return mql;
  }) as unknown as typeof window.matchMedia;

  return {
    /** Flip the OS preference and fire a `change` to all subscribers. */
    setPrefersDark(matches: boolean) {
      mql.matches = matches;
      for (const listener of listeners) {
        listener({ matches });
      }
    },
  };
}

// Reads the resolved effective mode through context so we can assert it too.
function ThemeProbe() {
  const { mode, effectiveMode } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="effective-mode">{effectiveMode}</span>
    </div>
  );
}

function renderWithMode(mode: ThemeMode) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    theme: { ...DEFAULT_SETTINGS.theme, mode },
  });

  return render(
    <SettingsProvider store={store}>
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    </SettingsProvider>,
  );
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  // @ts-expect-error — clean the stub so a later suite re-stubs from scratch.
  delete window.matchMedia;
});

describe("ThemeProvider", () => {
  // AC-001 — side-effect-contract
  it("should NOT put the dark class on the html element if mode is light", async () => {
    stubMatchMedia(true); // OS prefers dark, but explicit light must win.
    document.documentElement.classList.add("dark"); // start dirty to prove removal

    renderWithMode("light");

    expect(await screen.findByTestId("effective-mode")).toHaveTextContent(
      "light",
    );
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  // AC-002 — side-effect-contract
  it("should put the dark class on the html element if mode is dark", async () => {
    stubMatchMedia(false); // OS prefers light, but explicit dark must win.

    renderWithMode("dark");

    expect(await screen.findByTestId("effective-mode")).toHaveTextContent(
      "dark",
    );
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });

  // AC-003 — side-effect-contract
  it("should put the dark class if mode is system and the OS prefers dark", async () => {
    stubMatchMedia(true);

    renderWithMode("system");

    expect(await screen.findByTestId("effective-mode")).toHaveTextContent(
      "dark",
    );
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });

  // AC-003 — side-effect-contract
  it("should NOT put the dark class if mode is system and the OS prefers light", async () => {
    stubMatchMedia(false);

    renderWithMode("system");

    expect(await screen.findByTestId("effective-mode")).toHaveTextContent(
      "light",
    );
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  // AC-003 — side-effect-contract
  it("should flip the dark class live if the OS preference changes while system", async () => {
    const media = stubMatchMedia(false);

    renderWithMode("system");

    // Starts light (OS prefers light under system).
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    // OS flips to dark — the provider must react to the dispatched change with
    // no remount/reload.
    act(() => {
      media.setPrefersDark(true);
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    // And back to light again.
    act(() => {
      media.setPrefersDark(false);
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  // AC-003 / edge case (no matchMedia) — side-effect-contract (optional fallback)
  it("should fall back to light under system if matchMedia is absent", async () => {
    // Deliberately do NOT stub matchMedia for this case.
    renderWithMode("system");

    expect(await screen.findByTestId("effective-mode")).toHaveTextContent(
      "light",
    );
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  // AC-013 (mode half) — behavior
  it("should expose the chosen mode and the resolved effective mode via useTheme", async () => {
    stubMatchMedia(true);

    renderWithMode("system");

    expect(await screen.findByTestId("mode")).toHaveTextContent("system");
    expect(screen.getByTestId("effective-mode")).toHaveTextContent("dark");
  });
});
