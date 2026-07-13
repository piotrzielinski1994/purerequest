import { useMemo } from "react";
import type { Extension } from "@codemirror/state";
import { useThemeOptional } from "@/lib/theme/theme-context";
import { applyDefaults } from "@/lib/theme/overrides";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";
import {
  makeChrome,
  makeHighlight,
  makeEditorExtensions,
  makeViewerExtensions,
  type EditorColors,
} from "@/components/workspace/editor-theme";

export type EditorExtensionSets = {
  // Request body editor: JSON + close-brackets + lint.
  bodyExtensions: Extension[];
  // Folder/request config + request Settings raw-JSON editor: JSON + lint + gutter.
  configExtensions: Extension[];
  // Read-only response viewer: JSON, no editing.
  viewerExtensions: Extension[];
  // Response body viewer: read-only but keyboard-navigable (caret + arrow nav)
  // with a fold gutter and Mod+-/Mod+= collapse/expand at the cursor.
  responseViewerExtensions: Extension[];
  // Read-only console object viewer: JSON viewer + fold gutter.
  consoleViewerExtensions: Extension[];
  // `.env` editor: plain text - just the theme chrome + highlight.
  envExtensions: Extension[];
  // Script editor builds its own extension list (custom lang + linters); it needs
  // the themed chrome + highlight pieces to fold into that list.
  scriptChrome: Extension;
  scriptHighlight: Extension;
  // The active editor colors + mode, for any consumer that needs them directly.
  editorColors: EditorColors;
  isDark: boolean;
};

export function useEditorExtensions(): EditorExtensionSets {
  const theme = useThemeOptional();
  // Outside a ThemeProvider (isolated subtree / tests) fall back to the built-in
  // light scheme; the real app always mounts the provider at the root.
  const effectiveColors =
    theme?.effectiveColors ??
    applyDefaults(
      { light: { tokens: {}, editor: {} }, dark: { tokens: {}, editor: {} } },
      DEFAULT_THEME_COLORS,
    );
  const effectiveMode = theme?.effectiveMode ?? "light";
  const isDark = effectiveMode === "dark";
  const colors = effectiveColors[effectiveMode].editor as EditorColors;
  // Stabilize on the color VALUES (+ mode), not object identity: equal colors
  // across a fresh settings load must reuse the same extensions so CM isn't
  // reconfigured needlessly. `colors`/`isDark` are derived from `colorsKey`, so
  // depending only on the key is correct - the deps lint can't see through that.
  const colorsKey = `${effectiveMode}:${JSON.stringify(colors)}`;

  return useMemo<EditorExtensionSets>(() => {
    return {
      bodyExtensions: makeEditorExtensions({
        colors,
        isDark,
        withCloseBrackets: true,
        withLinter: true,
      }),
      configExtensions: makeEditorExtensions({
        colors,
        isDark,
        withLinter: true,
        withLintGutter: true,
        withFold: true,
      }),
      viewerExtensions: makeViewerExtensions({ colors, isDark }),
      responseViewerExtensions: makeViewerExtensions({
        colors,
        isDark,
        withFold: true,
        withCursor: true,
      }),
      consoleViewerExtensions: makeViewerExtensions({
        colors,
        isDark,
        withFold: true,
      }),
      envExtensions: [makeChrome(colors, isDark), makeHighlight(colors)],
      scriptChrome: makeChrome(colors, isDark),
      scriptHighlight: makeHighlight(colors),
      editorColors: colors,
      isDark,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorsKey]);
}
