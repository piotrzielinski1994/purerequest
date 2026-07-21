import { EditorView } from "@codemirror/view";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { BodyEditor } from "@/components/workspace/body-editor";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type ThemeColors,
  type ThemeMode,
} from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { ThemeProvider, useTheme } from "@/lib/theme/theme-context";

// Stage 3 (Themes), AC-012: switching the active mode re-themes the open editors
// LIVE, WITHOUT remounting the editor - the open document recolors in place.
// BodyEditor now sources its extensions from useEditorExtensions() (the theme
// hook), so it must be rendered under SettingsProvider + ThemeProvider. This test
// lives in its OWN file because the CM save/dispatch path is flaky under
// full-suite contention (learnings #139); isolating it keeps the flip
// deterministic.

// jsdom has no matchMedia; ThemeProvider subscribes to it. Stub it (copied from
// the Stage 1 theme-context test) so the provider mounts cleanly.
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

// A control that flips the theme mode through the real context so the flip goes
// through the same path the Settings UI uses (no remount of BodyEditor).
function ModeFlipper() {
  const { setMode } = useTheme();
  return (
    <button type="button" onClick={() => setMode("light")}>
      to light
    </button>
  );
}

function Harness() {
  const [value, setValue] = useState('{\n  "known": "seed-value"\n}');
  return (
    <>
      <BodyEditor value={value} onChange={setValue} />
      <ModeFlipper />
    </>
  );
}

function renderBody(initialMode: ThemeMode, colors?: ThemeColors) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    theme: {
      mode: initialMode,
      colors: colors ?? {
        light: { tokens: {}, editor: {} },
        dark: { tokens: {}, editor: {} },
      },
    },
  });
  return render(
    <SettingsProvider store={store}>
      <ThemeProvider>
        <Harness />
      </ThemeProvider>
    </SettingsProvider>,
  );
}

function liveView(): EditorView {
  const editorEl = document.querySelector<HTMLElement>(".cm-editor");
  if (!editorEl) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(editorEl);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view;
}

describe("BodyEditor follows the theme", () => {
  // AC-010/AC-011 - behavior: BodyEditor sources its highlight from the theme
  // hook, so a custom DARK editor `string` override reaches its injected CSS.
  // This is the assertion that ties this file to the Stage-3 WIRING: the current
  // BodyEditor uses module-const Darcula and ignores theme overrides, so the
  // sentinel is absent (RED) until BodyEditor consumes useEditorExtensions(). A
  // unique sentinel makes the presence check dedup-proof (learnings #49).
  it("should apply a custom dark editor string color sourced from the theme", async () => {
    stubMatchMedia(false);
    const sentinel = "oklch(0.414 0.114 414)";
    renderBody("dark", {
      light: { tokens: {}, editor: {} },
      dark: { tokens: {}, editor: { string: sentinel } },
    });

    await waitFor(() =>
      expect(document.querySelector(".cm-editor")).not.toBeNull(),
    );

    const css = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");

    expect(css).toContain(sentinel);
  });

  // AC-012 - behavior: flipping the mode while a body is open recolors the editor
  // in place; the live document survives (no remount). We do NOT assert the
  // injected background color dark-vs-light: CM themes are global StyleModule
  // rules deduped across the run (learnings #49), so a pixel/color read isn't a
  // reliable signal. Doc survival + a single, still-mounted .cm-editor IS.
  it("should preserve the open document when the mode flips dark -> light", async () => {
    stubMatchMedia(false);
    renderBody("dark");

    await waitFor(() =>
      expect(document.querySelector(".cm-editor")).not.toBeNull(),
    );

    // Seed a known edit through the live view (jsdom can't type into the
    // contentEditable - learnings #46/#130).
    await act(async () => {
      liveView().dispatch({ changes: { from: 0, insert: "// edited\n" } });
    });
    const before = liveView().state.doc.toString();
    expect(before).toContain("// edited");
    expect(before).toContain("seed-value");

    // Flip the mode through the context (the editor must recolor, not remount).
    await act(async () => {
      screen.getByRole("button", { name: /to light/i }).click();
    });

    await waitFor(() =>
      expect(document.documentElement.classList.contains("dark")).toBe(false),
    );

    // Exactly one editor still mounted, and its document is unchanged.
    expect(document.querySelectorAll(".cm-editor").length).toBe(1);
    expect(liveView().state.doc.toString()).toBe(before);
  });

  // AC-010 - side-effect-contract: under light mode the body editor must NOT
  // inject a solid white wrapper background (the chrome stays transparent, the
  // light-flash gotcha #49 stays avoided). Mirror body-editor-theme.test.tsx's
  // bare-class wrapper-rule read. NOTE: this is a best-effort secondary check -
  // the bare-class white rule may be polluted by an unrelated earlier render, so
  // a failure here is informative, not a primary signal.
  it("should not inject a solid white editor-wrapper background under light mode", async () => {
    stubMatchMedia(false);
    renderBody("light");

    await waitFor(() =>
      expect(document.querySelector(".cm-editor")).not.toBeNull(),
    );

    const css = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");
    const bareWhite = css
      .split("}")
      .filter((rule) => !/\.cm-/.test(rule))
      .some((rule) =>
        /\{[^{]*background-color:\s*(#fff\b|#ffffff|white)\b/i.test(rule),
      );

    expect(bareWhite).toBe(false);
  });
});
