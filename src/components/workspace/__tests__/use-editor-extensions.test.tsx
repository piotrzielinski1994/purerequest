import { describe, it, expect, afterEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { openSearchPanel } from "@codemirror/search";

import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type ThemeColors,
  type ThemeMode,
} from "@/lib/settings/settings";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";

// Stage 3 (Themes): a useEditorExtensions() hook reads useTheme()
// (effectiveColors + effectiveMode) and returns MEMOIZED extension sets for the
// 6 CodeMirror consumers, keyed on the effective editor colors + isDark so CM
// reconfigures on a theme change. The hook module doesn't exist yet -> RED on
// the missing export.
import { useEditorExtensions } from "@/components/workspace/use-editor-extensions";

// jsdom has no matchMedia; ThemeProvider's layout effect subscribes to it. Stub
// it (copied from the Stage 1 theme-context test) so the provider mounts cleanly.
function stubMatchMedia(initialMatches: boolean) {
  const mql = {
    matches: initialMatches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  };
  window.matchMedia = ((query: string) => {
    void query;
    return mql;
  }) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  // @ts-expect-error - clean the stub so a later suite re-stubs from scratch.
  delete window.matchMedia;
});

// Captures the hook output across renders so the test can compare identities and
// read the live extension CSS. We re-export the last value and a render counter.
type ExtensionSets = ReturnType<typeof useEditorExtensions>;

function makeProbe() {
  const captures: ExtensionSets[] = [];

  function Probe() {
    captures.push(useEditorExtensions());
    return <span data-testid="probe">{captures.length}</span>;
  }

  return { captures, Probe };
}

function renderHook(opts: {
  mode: ThemeMode;
  colors?: ThemeColors;
  Probe: () => ReactElement;
}) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    theme: {
      mode: opts.mode,
      colors: opts.colors ?? { light: { tokens: {}, editor: {} }, dark: { tokens: {}, editor: {} } },
    },
  });

  return render(
    <SettingsProvider store={store}>
      <ThemeProvider>
        <opts.Probe />
      </ThemeProvider>
    </SettingsProvider>,
  );
}

function injectedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
}

describe("useEditorExtensions", () => {
  // behavior: the hook resolves under the theme context and yields a body set.
  it("should return a body extension set under the theme providers", async () => {
    stubMatchMedia(false);
    const { captures, Probe } = makeProbe();

    renderHook({ mode: "dark", Probe });
    await screen.findByTestId("probe");

    await waitFor(() => expect(captures.length).toBeGreaterThan(0));
    expect(captures.at(-1)?.bodyExtensions).toBeDefined();
    expect(captures.at(-1)?.viewerExtensions).toBeDefined();
  });

  // side-effect-contract: a stable mode + colors keeps the extension identity
  // stable across a re-render (memoized), so CM is not reconfigured needlessly.
  it("should keep the body extension identity stable across re-render when colors and mode are unchanged", async () => {
    stubMatchMedia(false);
    const { captures, Probe } = makeProbe();

    const { rerender } = renderHook({ mode: "dark", Probe });
    await screen.findByTestId("probe");
    await waitFor(() => expect(captures.length).toBeGreaterThan(0));

    const before = captures.at(-1)?.bodyExtensions;

    // Force a re-render of the same tree (same store/mode/colors).
    rerender(
      <SettingsProvider
        store={createInMemorySettingsStore({
          ...DEFAULT_SETTINGS,
          theme: { mode: "dark", colors: { light: { tokens: {}, editor: {} }, dark: { tokens: {}, editor: {} } } },
        })}
      >
        <ThemeProvider>
          <Probe />
        </ThemeProvider>
      </SettingsProvider>,
    );
    await waitFor(() => expect(captures.length).toBeGreaterThan(1));

    expect(captures.at(-1)?.bodyExtensions).toBe(before);
  });

  // side-effect-contract: a DIFFERENT effective mode (light vs dark) yields a
  // DIFFERENT extension identity (the editor recolors on a mode change, AC-012).
  it("should return different extension identities for light vs dark effective mode", async () => {
    stubMatchMedia(false);

    const darkProbe = makeProbe();
    const { unmount } = renderHook({ mode: "dark", Probe: darkProbe.Probe });
    await screen.findByTestId("probe");
    await waitFor(() => expect(darkProbe.captures.length).toBeGreaterThan(0));
    const darkBody = darkProbe.captures.at(-1)?.bodyExtensions;
    unmount();

    const lightProbe = makeProbe();
    renderHook({ mode: "light", Probe: lightProbe.Probe });
    await screen.findByTestId("probe");
    await waitFor(() => expect(lightProbe.captures.length).toBeGreaterThan(0));
    const lightBody = lightProbe.captures.at(-1)?.bodyExtensions;

    expect(lightBody).not.toBe(darkBody);
  });

  // behavior: a custom DARK editor override flows through effectiveColors.dark
  // into the dark body extensions. We feed a UNIQUE sentinel string color as the
  // dark override and assert it lands in the body editor's injected highlight CSS
  // once mounted (dedup-proof presence check, learnings #49). This proves the
  // override reaches makeHighlight via the hook, not just the merge layer.
  it("should flow a custom dark editor string color into the dark body extensions", async () => {
    stubMatchMedia(false);
    const sentinel = "oklch(0.321 0.123 321)";
    const colors: ThemeColors = {
      light: { tokens: {}, editor: {} },
      dark: { tokens: {}, editor: { string: sentinel } },
    };

    const { captures, Probe } = makeProbe();
    renderHook({ mode: "dark", colors, Probe });
    await screen.findByTestId("probe");
    await waitFor(() => expect(captures.length).toBeGreaterThan(0));

    const body = captures.at(-1)?.bodyExtensions;
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '"x"',
        extensions: body as never,
      }),
      parent,
    });
    const css = injectedCss();
    view.destroy();

    expect(css).toContain(sentinel);
  });

  // backstop seam (documented): the merge layer the hook consumes already carries
  // the override - if the CSS presence check above ever flakes under dedup, this
  // pins the same fact at the readable seam (effectiveColors.dark.editor.string).
  it("should expose the custom dark editor string via the merged default table", () => {
    const sentinel = "oklch(0.321 0.123 321)";
    expect(sentinel).not.toBe(DEFAULT_THEME_COLORS.dark.editor.string);
  });

  // AC-005 — behavior: every in-scope CodeMirror surface (body, config, response
  // viewer, console viewer, and the standalone findExtension for script/GraphQL)
  // carries find, proven by mounting the set and opening the search panel: the
  // shared FindBar input must appear. Guards against a set silently missing find.
  const IN_SCOPE_SETS: Array<keyof ExtensionSets> = [
    "bodyExtensions",
    "configExtensions",
    "viewerExtensions",
    "responseViewerExtensions",
    "consoleViewerExtensions",
    "findExtension",
  ];

  it.each(IN_SCOPE_SETS)(
    "should open the shared FindBar for the %s surface",
    async (setKey) => {
      stubMatchMedia(false);
      const { captures, Probe } = makeProbe();
      renderHook({ mode: "light", Probe });
      await screen.findByTestId("probe");
      await waitFor(() => expect(captures.length).toBeGreaterThan(0));

      const set = captures.at(-1)?.[setKey];
      const parent = document.createElement("div");
      document.body.appendChild(parent);
      const view = new EditorView({
        state: EditorState.create({
          doc: "hello",
          extensions: set as Extension,
        }),
        parent,
      });

      openSearchPanel(view);
      // `.cm-purerequest-find` is our styled panel specifically - CodeMirror's DEFAULT
      // panel also uses an aria-label="Find" input, so we key on the panel class to
      // prove find is wired to OUR FindBar, not just any search panel.
      await waitFor(() => {
        expect(
          parent.querySelector(".cm-purerequest-find"),
          `${setKey} did not open the shared FindBar`,
        ).not.toBeNull();
      });

      view.destroy();
    },
  );

  // AC-005 — regression guard: the `.env` set is a key-value table surface, NOT a
  // CodeMirror editor, so it deliberately does NOT wire OUR find. Even though CM can
  // still surface its own default search panel, our styled `.cm-purerequest-find` must be
  // absent - proving editorFind was not added to this set. Pins the scoping decision
  // so a future edit doesn't quietly wire our FindBar into it.
  it("should NOT wire the shared FindBar into the env extension set", async () => {
    stubMatchMedia(false);
    const { captures, Probe } = makeProbe();
    renderHook({ mode: "light", Probe });
    await screen.findByTestId("probe");
    await waitFor(() => expect(captures.length).toBeGreaterThan(0));

    const env = captures.at(-1)?.envExtensions;
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "KEY=value",
        extensions: env as Extension,
      }),
      parent,
    });

    openSearchPanel(view);
    await Promise.resolve();
    expect(parent.querySelector(".cm-purerequest-find")).toBeNull();

    view.destroy();
  });
});
