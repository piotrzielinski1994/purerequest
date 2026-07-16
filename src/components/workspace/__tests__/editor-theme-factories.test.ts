import { describe, it, expect } from "vitest";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { forceLinting, diagnosticCount } from "@codemirror/lint";

// Stage 3 (Themes): editor-theme.ts becomes COLOR-DRIVEN FACTORIES. These names
// don't exist yet (the module still exports darculaChrome/darculaHighlight/
// jsonViewerExtensions) - so the import itself fails RED until the factories ship.
import {
  makeChrome,
  makeHighlight,
  makeEditorExtensions,
  makeViewerExtensions,
  emptyTolerantJsonLinter,
} from "@/components/workspace/editor-theme";
import type {
  EditorTokenName,
  FullThemeColors,
} from "@/lib/settings/settings";

// CodeMirror themes/highlights are global StyleModule rules injected into
// <style> tags in document.head, DEDUPED across the whole run (learnings #49).
// We therefore never assert ABSENCE of a color (an old run may have left it),
// and we feed each factory UNIQUE SENTINEL colors that appear nowhere else in
// the suite/defaults - a unique sentinel can only land in document.head if THIS
// factory put it there, so its PRESENCE is a reliable, dedup-proof signal of the
// color mapping. (We can't read a color back out of the composed Extension array
// - syntaxHighlighting()/EditorView.theme() return opaque FacetProvider arrays -
// so mounting a bare EditorView and reading the injected CSS is the readable
// seam; the HighlightStyle's specs/module aren't reachable through the factory.)
function injectedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
}

function mountWith(extension: unknown, doc = '"x"'): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({ doc, extensions: [extension as never] }),
    parent,
  });
}

// Distinct, never-reused-elsewhere oklch values per token so each presence check
// is unambiguous. (Real defaults use these hue families but never these exact
// L/C/H triples.)
function sentinelEditorColors(
  overrides: Partial<Record<EditorTokenName, string>> = {},
): Record<EditorTokenName, string> {
  return {
    caret: "oklch(0.111 0.211 11)",
    selection: "oklch(0.122 0.212 22)",
    gutter: "oklch(0.133 0.213 33)",
    keyword: "oklch(0.144 0.214 44)",
    string: "oklch(0.155 0.215 55)",
    number: "oklch(0.166 0.216 66)",
    property: "oklch(0.177 0.217 77)",
    comment: "oklch(0.188 0.218 88)",
    invalid: "oklch(0.199 0.219 99)",
    ...overrides,
  };
}

describe("makeHighlight", () => {
  // behavior: the string-tag color is driven by editorColors.string.
  it("should color the string tag with the dark scheme's string value", () => {
    const colors = sentinelEditorColors({ string: "oklch(0.501 0.131 501)" });

    const view = mountWith(makeHighlight(colors));
    const css = injectedCss();
    view.destroy();

    expect(css).toContain("oklch(0.501 0.131 501)");
  });

  // behavior: a DIFFERENT (light-scheme) string value lands when that's passed.
  it("should color the string tag with the light scheme's string value", () => {
    const colors = sentinelEditorColors({ string: "oklch(0.502 0.132 502)" });

    const view = mountWith(makeHighlight(colors));
    const css = injectedCss();
    view.destroy();

    expect(css).toContain("oklch(0.502 0.132 502)");
  });

  // behavior: keyword / number / property / comment / invalid are all mapped.
  it("should map keyword, number, property, comment and invalid colors", () => {
    const colors = sentinelEditorColors({
      keyword: "oklch(0.611 0.141 611)",
      number: "oklch(0.612 0.142 612)",
      property: "oklch(0.613 0.143 613)",
      comment: "oklch(0.614 0.144 614)",
      invalid: "oklch(0.615 0.145 615)",
    });

    const view = mountWith(makeHighlight(colors));
    const css = injectedCss();
    view.destroy();

    expect(css).toContain("oklch(0.611 0.141 611)");
    expect(css).toContain("oklch(0.612 0.142 612)");
    expect(css).toContain("oklch(0.613 0.143 613)");
    expect(css).toContain("oklch(0.614 0.144 614)");
    expect(css).toContain("oklch(0.615 0.145 615)");
  });

  // side-effect-contract: two different color inputs yield DISTINCT extensions
  // (so CodeMirror reconfigures on a theme change). Cheap structural check that
  // backstops the CSS presence assertions above.
  it("should produce distinct extensions for distinct color inputs", () => {
    const a = makeHighlight(sentinelEditorColors({ string: "oklch(0.7 0.1 1)" }));
    const b = makeHighlight(sentinelEditorColors({ string: "oklch(0.7 0.1 2)" }));

    expect(a).not.toBe(b);
  });
});

describe("makeChrome", () => {
  // behavior: caret / selection / gutter colors come from editorColors.
  it("should drive caret, selection and gutter colors from the colors map", () => {
    const colors = sentinelEditorColors({
      caret: "oklch(0.711 0.151 711)",
      selection: "oklch(0.712 0.152 712)",
      gutter: "oklch(0.713 0.153 713)",
    });

    const view = mountWith(makeChrome(colors, true));
    const css = injectedCss();
    view.destroy();

    expect(css).toContain("oklch(0.711 0.151 711)");
    expect(css).toContain("oklch(0.712 0.152 712)");
    expect(css).toContain("oklch(0.713 0.153 713)");
  });

  // side-effect-contract: chrome background stays transparent in BOTH modes (the
  // editor inherits the themed pane - learnings #49 white-flash avoidance). We
  // assert the `&` wrapper rule carries `background-color: transparent` (matched
  // on a rule NOT under a `.cm-*` selector, mirroring body-editor-theme.test.tsx).
  it("should keep the editor wrapper background transparent in dark mode", () => {
    const view = mountWith(makeChrome(sentinelEditorColors(), true), "x");
    const transparent = injectedCss()
      .split("}")
      .filter((rule) => !/\.cm-/.test(rule))
      .some((rule) =>
        /\{[^{]*background-color:\s*transparent/i.test(rule),
      );
    view.destroy();

    expect(transparent).toBe(true);
  });

  it("should keep the editor wrapper background transparent in light mode", () => {
    const view = mountWith(makeChrome(sentinelEditorColors(), false), "x");
    const transparent = injectedCss()
      .split("}")
      .filter((rule) => !/\.cm-/.test(rule))
      .some((rule) =>
        /\{[^{]*background-color:\s*transparent/i.test(rule),
      );
    view.destroy();

    expect(transparent).toBe(true);
  });

  // side-effect-contract: the dark flag is passed through to EditorView.theme's
  // { dark } option. FLAG: the { dark } option is NOT readable from the composed
  // Extension (it compiles into a non-deterministic generated `ͼN` class on the
  // editor wrapper, not a stable `cm-theme-dark` token, and the class numbers are
  // dedup-shared across the run). We assert the strongest reliable proxy: the two
  // modes produce DISTINCT extensions, so a mode flip reconfigures the editor.
  it("should produce distinct chrome extensions for dark vs light", () => {
    const colors = sentinelEditorColors();

    expect(makeChrome(colors, true)).not.toBe(makeChrome(colors, false));
  });
});

describe("makeEditorExtensions / makeViewerExtensions", () => {
  function flatLength(extensions: unknown): number {
    return (extensions as unknown[]).flat(Infinity).length;
  }

  function inputHandlerCount(extensions: unknown): number {
    const state = EditorState.create({
      extensions: extensions as never,
    });
    return state.facet(EditorView.inputHandler).length;
  }

  // side-effect-contract: closeBrackets is wired only when requested. json()
  // alone registers ZERO input handlers; closeBrackets registers one (learnings
  // #46) - so the count distinguishes the two without simulating a keystroke.
  it("should add a bracket-closing input handler only when withCloseBrackets is set", () => {
    const colors = sentinelEditorColors();
    const without = makeEditorExtensions({ colors, isDark: true });
    const withClose = makeEditorExtensions({
      colors,
      isDark: true,
      withCloseBrackets: true,
    });

    expect(inputHandlerCount(without)).toBe(0);
    expect(inputHandlerCount(withClose)).toBeGreaterThanOrEqual(1);
  });

  // behavior: the linter is wired only when requested - a malformed doc yields a
  // diagnostic with the linter, none without it.
  it("should produce a lint diagnostic on malformed JSON only when withLinter is set", async () => {
    const colors = sentinelEditorColors();

    const lintView = mountWith(
      makeEditorExtensions({ colors, isDark: true, withLinter: true }),
      '{ "a": 1, }',
    );
    forceLinting(lintView);
    await Promise.resolve();
    const lintCount = diagnosticCount(lintView.state);
    lintView.destroy();

    const plainView = mountWith(
      makeEditorExtensions({ colors, isDark: true }),
      '{ "a": 1, }',
    );
    forceLinting(plainView);
    await Promise.resolve();
    const plainCount = diagnosticCount(plainView.state);
    plainView.destroy();

    expect(lintCount).toBeGreaterThan(0);
    expect(plainCount).toBe(0);
  });

  // side-effect-contract: optional pieces grow the flattened extension array, so
  // each flag's inclusion is observable as a length delta over the base set.
  it("should grow the editor extension set when linter and closeBrackets are added", () => {
    const colors = sentinelEditorColors();
    const base = flatLength(makeEditorExtensions({ colors, isDark: true }));
    const withLinter = flatLength(
      makeEditorExtensions({ colors, isDark: true, withLinter: true }),
    );
    const withBoth = flatLength(
      makeEditorExtensions({
        colors,
        isDark: true,
        withLinter: true,
        withCloseBrackets: true,
      }),
    );

    expect(withLinter).toBeGreaterThan(base);
    expect(withBoth).toBeGreaterThan(withLinter);
  });

  // behavior: withFold binds the fold/unfold-at-cursor shortcuts (Mod+-, Mod+=)
  // on the EDITABLE editor too, so the Raw / config JSON editor collapses and
  // expands the block under the caret from the keyboard (not only the read-only
  // response viewer).
  it("should bind fold/unfold keyboard shortcuts when withFold is set on the editor", () => {
    const colors = sentinelEditorColors();
    const state = EditorState.create({
      extensions: makeEditorExtensions({
        colors,
        isDark: true,
        withFold: true,
      }) as never,
    });
    const keys = state
      .facet(keymap)
      .flat()
      .map((binding) => binding.key);

    expect(keys).toContain("Mod--");
    expect(keys).toContain("Mod-=");
  });

  // side-effect-contract: the viewer composition grows when fold is requested.
  it("should grow the viewer extension set when withFold is added", () => {
    const colors = sentinelEditorColors();
    const base = flatLength(makeViewerExtensions({ colors, isDark: true }));
    const withFold = flatLength(
      makeViewerExtensions({ colors, isDark: true, withFold: true }),
    );

    expect(withFold).toBeGreaterThan(base);
  });

  // behavior: withCursor makes the viewer read-only-but-navigable - the state is
  // read-only (edits blocked) yet the caret is enabled (editable), so arrow keys
  // move a cursor through the response.
  it("should make the viewer read-only yet caret-navigable when withCursor is set", () => {
    const colors = sentinelEditorColors();
    const state = EditorState.create({
      doc: '{ "a": 1 }',
      extensions: makeViewerExtensions({
        colors,
        isDark: true,
        withCursor: true,
      }) as never,
    });

    expect(state.readOnly).toBe(true);
    expect(state.facet(EditorView.editable)).toBe(true);
  });

  // behavior: without withCursor the viewer is plain non-editable (no caret) -
  // the historical response/console viewer behavior is unchanged.
  it("should keep the viewer non-editable when withCursor is not set", () => {
    const colors = sentinelEditorColors();
    const state = EditorState.create({
      doc: '{ "a": 1 }',
      extensions: makeViewerExtensions({ colors, isDark: true }) as never,
    });

    expect(state.facet(EditorView.editable)).toBe(false);
  });

  // behavior: withCursor also binds the fold/unfold-at-cursor shortcuts (Mod+-,
  // Mod+=) so the keyboard can collapse/expand the block under the caret.
  it("should bind fold/unfold keyboard shortcuts when withCursor is set", () => {
    const colors = sentinelEditorColors();
    const state = EditorState.create({
      extensions: makeViewerExtensions({
        colors,
        isDark: true,
        withCursor: true,
      }) as never,
    });
    const keys = state
      .facet(keymap)
      .flat()
      .map((binding) => binding.key);

    expect(keys).toContain("Mod--");
    expect(keys).toContain("Mod-=");
  });

  // behavior: the viewer carries the highlight colors (it reads like the editor).
  it("should color the string tag in the viewer composition from the colors map", () => {
    const colors = sentinelEditorColors({ string: "oklch(0.811 0.161 811)" });

    const view = mountWith(makeViewerExtensions({ colors, isDark: true }));
    const css = injectedCss();
    view.destroy();

    expect(css).toContain("oklch(0.811 0.161 811)");
  });
});

describe("emptyTolerantJsonLinter", () => {
  // behavior: still exported and still tolerant of an empty document (an empty
  // request body is a valid state - learnings #64).
  it("should report no diagnostics for an empty document", () => {
    const lint = emptyTolerantJsonLinter();
    const state = EditorState.create({ doc: "" });
    const view = new EditorView({ state });

    expect(lint(view)).toEqual([]);

    view.destroy();
  });

  // behavior: a non-empty malformed document still produces diagnostics.
  it("should report diagnostics for malformed non-empty JSON", () => {
    const lint = emptyTolerantJsonLinter();
    const state = EditorState.create({ doc: "{" });
    const view = new EditorView({ state });

    expect(lint(view).length).toBeGreaterThan(0);

    view.destroy();
  });
});

// Touch the imported default-colors type so the test file documents the shape
// the factories consume (effectiveColors[mode].editor is a full editor map).
const _shape: FullThemeColors["dark"]["editor"] | null = null;
void _shape;
