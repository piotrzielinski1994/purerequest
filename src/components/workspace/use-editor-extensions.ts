import type { Extension } from "@codemirror/state";
import { toCodeMirrorKey } from "@pziel/pureui";
import { useMemo } from "react";
import { editorFind } from "@/components/workspace/editor-find";
import {
  type EditorColors,
  makeChrome,
  makeEditorExtensions,
  makeHighlight,
  makeViewerExtensions,
} from "@/components/workspace/editor-theme";
import { useShortcutOverrides } from "@/lib/settings/settings-context";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { applyDefaults } from "@/lib/theme/overrides";
import { useThemeOptional } from "@/lib/theme/theme-context";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";

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
  // The Cmd+F find extension (styled search panel), for the editors that build their
  // own extension list (script, GraphQL) and can't use the pre-composed sets above.
  findExtension: Extension;
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
  // The resolved Cmd+F open-find binding, bridged to its CodeMirror key form
  // ("Mod+F" -> "Mod-f"). Falls back to the registry default when no binding
  // resolves (e.g. the action was disabled to an empty list).
  const findKey =
    toCodeMirrorKey(resolveShortcuts(useShortcutOverrides())["open-find"][0]) ??
    "Mod-f";
  // Stabilize on the color VALUES (+ mode + find key), not object identity: equal
  // colors across a fresh settings load must reuse the same extensions so CM isn't
  // reconfigured needlessly. `colors`/`isDark` are derived from `colorsKey`, so
  // depending only on the key is correct - the deps lint can't see through that.
  const colorsKey = `${effectiveMode}:${findKey}:${JSON.stringify(colors)}`;

  return useMemo<EditorExtensionSets>(() => {
    const findExtension = editorFind(findKey);
    return {
      bodyExtensions: [
        ...makeEditorExtensions({
          colors,
          isDark,
          withCloseBrackets: true,
          withLinter: true,
        }),
        findExtension,
      ],
      configExtensions: [
        ...makeEditorExtensions({
          colors,
          isDark,
          withLinter: true,
          withLintGutter: true,
          withFold: true,
        }),
        findExtension,
      ],
      viewerExtensions: [
        ...makeViewerExtensions({ colors, isDark }),
        findExtension,
      ],
      responseViewerExtensions: [
        ...makeViewerExtensions({
          colors,
          isDark,
          withFold: true,
          withCursor: true,
        }),
        findExtension,
      ],
      consoleViewerExtensions: [
        ...makeViewerExtensions({
          colors,
          isDark,
          withFold: true,
        }),
        findExtension,
      ],
      envExtensions: [makeChrome(colors, isDark), makeHighlight(colors)],
      scriptChrome: makeChrome(colors, isDark),
      scriptHighlight: makeHighlight(colors),
      findExtension,
      editorColors: colors,
      isDark,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorsKey]);
}
