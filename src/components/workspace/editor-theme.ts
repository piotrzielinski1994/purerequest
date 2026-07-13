import { json, jsonParseLinter } from "@codemirror/lang-json";
import { EditorView, keymap } from "@codemirror/view";
import {
  HighlightStyle,
  syntaxHighlighting,
  foldGutter,
  codeFolding,
  foldKeymap,
  foldCode,
  unfoldCode,
} from "@codemirror/language";
import { closeBrackets } from "@codemirror/autocomplete";
import { defaultKeymap } from "@codemirror/commands";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import type { EditorTokenName } from "@/lib/settings/settings";

// The editor color set the factories consume: one color per syntax/chrome token.
// In practice this is `effectiveColors[effectiveMode].editor` (a full map).
export type EditorColors = Record<EditorTokenName, string>;

// Chrome (caret/selection/gutter + the autocomplete popup) for one mode. The
// background stays transparent so the editor inherits the themed pane behind it
// (the request body editor, response viewer, console, config/env/script editors
// all share this) - avoids the white-flash the @uiw default-light theme injects.
// Fold-gutter chevrons are ALWAYS invisible (design.md): folding still works
// (the gutter element stays clickable, plus the fold keymap), but no arrow shows.
export function makeChrome(colors: EditorColors, isDark: boolean): Extension {
  return EditorView.theme(
    {
      "&": {
        backgroundColor: "transparent",
        height: "100%",
      },
      ".cm-content": { caretColor: colors.caret },
      "&.cm-focused": { outline: "none" },
      "&.cm-focused .cm-cursor": { borderLeftColor: colors.caret },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: colors.selection },
      ".cm-activeLine": { backgroundColor: "transparent" },
      ".cm-activeLineGutter": { backgroundColor: "transparent" },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: colors.gutter,
        border: "none",
      },
      // The fold chevrons are always invisible (design.md: folding works but the
      // arrows must not show) - kept clickable (still an affordance for a mouse)
      // and paired with the fold keymap for keyboard collapse/expand.
      ".cm-foldGutter .cm-gutterElement": { opacity: "0", cursor: "pointer" },
      ".cm-scroller": {
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
      },
      // Autocomplete popup follows the app theme tokens, not CodeMirror's default
      // light chrome: popover bg/fg, 1px border-border, no rounded corners
      // (design.md), accent for the selected row, primary for the matched chars.
      ".cm-tooltip.cm-tooltip-autocomplete": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
        borderRadius: "0",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
      },
      ".cm-tooltip-autocomplete > ul": {
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        // Match the React token listbox width (w-72 = 18rem).
        minWidth: "18rem",
        maxWidth: "18rem",
      },
      // Match the React token listbox row: flex, name left + source right
      // (justify-between via the detail's margin-left:auto), same padding/size.
      ".cm-tooltip-autocomplete > ul > li": {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.25rem 0.5rem",
        fontSize: "0.75rem",
        lineHeight: "1rem",
        color: "var(--popover-foreground)",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
      },
      // The label takes the row's free space + truncates; the source is fixed.
      ".cm-completionLabel": {
        color: "inherit",
        flex: "1 1 auto",
        minWidth: "0",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
      ".cm-completionMatchedText": {
        color: "inherit",
        textDecoration: "none",
        fontWeight: "600",
      },
      ".cm-completionIcon": { color: "var(--muted-foreground)", opacity: "1" },
      ".cm-completionDetail": {
        color: "var(--muted-foreground)",
        fontStyle: "normal",
        flex: "0 0 auto",
        marginLeft: "auto",
        fontSize: "10px",
      },
      // Per-kind label color, keyed off the token option's `optionClass`
      // (`cm-token-<kind>`, set by `tokenOptionClass`). Matches TOKEN_KIND_COLOR
      // in token-suggestions.tsx - keep the two in sync.
      ".cm-token-variable .cm-completionLabel": {
        color: isDark ? "var(--color-emerald-400)" : "var(--color-emerald-500)",
      },
      ".cm-token-environment .cm-completionLabel": {
        color: isDark ? "var(--color-sky-400)" : "var(--color-sky-600)",
      },
      ".cm-token-dotenv .cm-completionLabel": {
        color: isDark ? "var(--color-amber-400)" : "var(--color-amber-500)",
      },
    },
    { dark: isDark },
  );
}

export function makeHighlight(colors: EditorColors): Extension {
  return syntaxHighlighting(
    HighlightStyle.define([
      { tag: [t.keyword, t.bool, t.null], color: colors.keyword },
      { tag: [t.string, t.special(t.string)], color: colors.string },
      { tag: [t.number], color: colors.number },
      {
        tag: [t.propertyName, t.definition(t.propertyName)],
        color: colors.property,
      },
      { tag: [t.comment], color: colors.comment, fontStyle: "italic" },
      { tag: [t.invalid], color: colors.invalid },
    ]),
  );
}

type EditorExtensionOpts = {
  colors: EditorColors;
  isDark: boolean;
  withLinter?: boolean;
  withCloseBrackets?: boolean;
  withLintGutter?: boolean;
  withFold?: boolean;
};

// JSON editor extensions (editable). Composes json() + chrome + highlight plus
// the optional pieces each consumer needs (close-bracket, lint, lint gutter,
// code folding). `withFold` wires collapse/expand: the fold state, the fold
// gutter (arrows kept INVISIBLE by makeChrome), and the fold keymap (Ctrl-Shift-[ / ]).
export function makeEditorExtensions(opts: EditorExtensionOpts): Extension[] {
  const { colors, isDark } = opts;
  return [
    json(),
    ...(opts.withCloseBrackets ? [closeBrackets()] : []),
    ...(opts.withLinter ? [linter(emptyTolerantJsonLinter())] : []),
    ...(opts.withLintGutter ? [lintGutter()] : []),
    ...(opts.withFold
      ? [codeFolding(), foldGutter(), keymap.of(foldKeymap)]
      : []),
    makeChrome(colors, isDark),
    makeHighlight(colors),
  ];
}

// Collapse/expand the block under the caret from the keyboard. Mod+- folds,
// Mod+= (the unshifted "+") unfolds - matching the "cmd+-/cmd++" the user asked
// for while avoiding the shift-dependent "+" that varies by layout.
const foldAtCursorKeymap = keymap.of([
  { key: "Mod--", run: foldCode },
  { key: "Mod-=", run: unfoldCode },
]);

type ViewerExtensionOpts = {
  colors: EditorColors;
  isDark: boolean;
  withFold?: boolean;
  // Read-only-but-navigable: keep the state read-only (edits blocked) yet enable
  // the caret so arrow keys move through the response, and bind the fold/unfold
  // keyboard shortcuts. Off = the historical plain non-editable viewer (no caret).
  withCursor?: boolean;
};

// Read-only JSON viewer extensions (no editing, no linter) - same colors as the
// editor so the response/console reads like the request body. `withCursor` turns
// the surface from "not editable at all" into "read-only but keyboard-navigable":
// EditorState.readOnly blocks edits while EditorView.editable keeps the caret, and
// the default cursor-movement + fold keymaps let the keyboard drive it.
export function makeViewerExtensions(opts: ViewerExtensionOpts): Extension[] {
  const { colors, isDark } = opts;
  const readOnlyMode = opts.withCursor
    ? [
        EditorState.readOnly.of(true),
        keymap.of(defaultKeymap),
        keymap.of(foldKeymap),
        foldAtCursorKeymap,
      ]
    : [EditorView.editable.of(false)];
  return [
    json(),
    ...readOnlyMode,
    ...(opts.withFold ? [foldGutter()] : []),
    makeChrome(colors, isDark),
    makeHighlight(colors),
  ];
}

// jsonParseLinter flags an empty document as "Unexpected EOF". An empty request
// body is a valid state (no body), so suppress diagnostics until something is typed.
export function emptyTolerantJsonLinter(): (view: EditorView) => Diagnostic[] {
  const lint = jsonParseLinter();
  return (view) => (view.state.doc.toString().trim() === "" ? [] : lint(view));
}
