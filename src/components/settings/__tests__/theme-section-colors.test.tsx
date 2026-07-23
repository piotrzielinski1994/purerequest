import { EditorView } from "@codemirror/view";
import { applyDefaults } from "@pziel/pureui";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeSection } from "@/components/settings/theme-section";
import { createFakeHttpClient } from "@/components/workspace/__tests__/fake-http-client";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type ThemeColors,
} from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";

// Stage 2 - Themes feature. The ThemeSection now renders a raw-JSON color editor
// seeded with the FULL effective color set (every app + editor token, both
// modes), reusing the existing RawJsonEditor (exported from config-editor.tsx,
// which registers itself with the workspace's active-editor channel). Editing it
// to a new primary and saving calls setColors / saveThemeColors with the SPARSE
// diff; invalid JSON blocks the save (popupCanSave false).
//
// RawJsonEditor commits via the workspace save channel, so the surface mounts
// under WorkspaceProvider; the save is driven through saveActiveEditor (the
// Mod+S path), NOT the hotkey, mirroring the config/request-settings tests
// (learnings #44 / #139). Kept in its own file (CM flake, #139).

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

function EditorHarness() {
  const { saveActiveEditor, popupCanSave } = useWorkspace();
  return (
    <div>
      <button type="button" onClick={saveActiveEditor}>
        fire shortcut
      </button>
      <span data-testid="popup-can-save">{String(popupCanSave)}</span>
    </div>
  );
}

function liveDoc(): string {
  const el = document.querySelector<HTMLElement>(".cm-editor");
  if (!el) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(el);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view.state.doc.toString();
}

// Dispatch inside act so the onChange -> setText -> re-register-descriptor
// update flushes BEFORE the test fires save - else the save reads the stale seed
// descriptor (the CM-dispatch/Mod+S timing flake class, docs/learnings.md #139).
async function setDoc(text: string) {
  const view = EditorView.findFromDOM(
    document.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  await act(async () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  });
}

function renderSection(overrides: ThemeColors = DEFAULT_SETTINGS.theme.colors) {
  stubMatchMedia(false);
  const seeded: Settings = {
    ...DEFAULT_SETTINGS,
    theme: { mode: "light", colors: overrides },
  };
  const store = createInMemorySettingsStore(seeded);
  return render(
    <SettingsProvider store={store}>
      <ThemeProvider>
        <WorkspaceProvider httpClient={createFakeHttpClient()}>
          <EditorHarness />
          <ThemeSection />
        </WorkspaceProvider>
      </ThemeProvider>
    </SettingsProvider>,
  );
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("style");
  // @ts-expect-error - drop the stub between tests.
  delete window.matchMedia;
});

describe("ThemeSection color editor", () => {
  // AC-009 - behavior: the editor seeds with the FULL effective color set (every
  // token, override-or-default, both modes), so all tokens are discoverable.
  it("should seed the editor with the full effective color set", async () => {
    renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const seeded = JSON.parse(liveDoc()) as ThemeColors;
    const full = applyDefaults(
      DEFAULT_SETTINGS.theme.colors,
      DEFAULT_THEME_COLORS,
    );
    expect(seeded).toEqual(full);
  });

  // AC-005, AC-009 - side-effect-contract: editing a token to a new value then
  // saving persists ONLY the diff (sparse) to theme.colors.
  it("should persist the sparse diff if a token is edited and saved", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore({
      ...DEFAULT_SETTINGS,
      theme: { mode: "light", colors: DEFAULT_SETTINGS.theme.colors },
    });
    const saved: Settings[] = [];
    const store = {
      load: inner.load,
      save: (s: Settings) => {
        saved.push(s);
        return inner.save(s);
      },
    };
    stubMatchMedia(false);
    render(
      <SettingsProvider store={store}>
        <ThemeProvider>
          <WorkspaceProvider httpClient={createFakeHttpClient()}>
            <EditorHarness />
            <ThemeSection />
          </WorkspaceProvider>
        </ThemeProvider>
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    // start from the full effective set, override the light primary to red.
    const full = applyDefaults(
      DEFAULT_SETTINGS.theme.colors,
      DEFAULT_THEME_COLORS,
    );
    const edited: ThemeColors = {
      ...full,
      light: {
        ...full.light,
        tokens: { ...full.light.tokens, primary: "oklch(0.55 0.22 27)" },
      },
    };
    await setDoc(JSON.stringify(edited, null, 2));
    await user.click(screen.getByRole("button", { name: /fire shortcut/i }));

    await waitFor(() => {
      expect(saved.length).toBeGreaterThan(0);
    });
    const persisted = saved.at(-1)!.theme.colors;
    // ONLY the diff is stored - the primary override, nothing else.
    expect(persisted.light.tokens.primary).toBe("oklch(0.55 0.22 27)");
    expect(persisted.light.tokens.background).toBeUndefined();
  });

  // AC-008 - side-effect-contract: editing a token BACK to its built-in default
  // and saving drops it from the stored diff (per-token reset).
  it("should drop an override edited back to the default on save", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore({
      ...DEFAULT_SETTINGS,
      theme: {
        mode: "light",
        colors: {
          light: { tokens: { primary: "oklch(0.55 0.22 27)" }, editor: {} },
          dark: { tokens: {}, editor: {} },
        },
      },
    });
    const saved: Settings[] = [];
    const store = {
      load: inner.load,
      save: (s: Settings) => {
        saved.push(s);
        return inner.save(s);
      },
    };
    stubMatchMedia(false);
    render(
      <SettingsProvider store={store}>
        <ThemeProvider>
          <WorkspaceProvider httpClient={createFakeHttpClient()}>
            <EditorHarness />
            <ThemeSection />
          </WorkspaceProvider>
        </ThemeProvider>
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    // re-seed editor with light primary set BACK to the built-in default.
    const full = applyDefaults(
      {
        light: { tokens: { primary: "oklch(0.55 0.22 27)" }, editor: {} },
        dark: { tokens: {}, editor: {} },
      },
      DEFAULT_THEME_COLORS,
    );
    const resetToDefault: ThemeColors = {
      ...full,
      light: {
        ...full.light,
        tokens: {
          ...full.light.tokens,
          primary: DEFAULT_THEME_COLORS.light.tokens.primary,
        },
      },
    };
    await setDoc(JSON.stringify(resetToDefault, null, 2));
    await user.click(screen.getByRole("button", { name: /fire shortcut/i }));

    await waitFor(() => {
      expect(saved.length).toBeGreaterThan(0);
    });
    const persisted = saved.at(-1)!.theme.colors;
    expect(persisted.light.tokens.primary).toBeUndefined();
  });

  // AC-009 - side-effect-contract: malformed JSON blocks the save (popupCanSave
  // false), consistent with the other raw-JSON editors.
  it("should block saving if the color JSON is malformed", async () => {
    renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    await setDoc("{ not json");

    await waitFor(() => {
      expect(screen.getByTestId("popup-can-save")).toHaveTextContent("false");
    });
  });

  // AC-009 - side-effect-contract: a structurally-wrong shape (missing the
  // {light,dark} sections) also blocks the save.
  it("should block saving if the color JSON is the wrong shape", async () => {
    renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    await setDoc(JSON.stringify({ light: { tokens: {} } }));

    await waitFor(() => {
      expect(screen.getByTestId("popup-can-save")).toHaveTextContent("false");
    });
  });

  // AC-009 - behavior: valid color JSON keeps the editor saveable.
  it("should keep saving enabled if the color JSON is valid", async () => {
    renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const full = applyDefaults(
      DEFAULT_SETTINGS.theme.colors,
      DEFAULT_THEME_COLORS,
    );
    await setDoc(JSON.stringify(full, null, 2));

    await waitFor(() => {
      expect(screen.getByTestId("popup-can-save")).toHaveTextContent("true");
    });
  });
});
