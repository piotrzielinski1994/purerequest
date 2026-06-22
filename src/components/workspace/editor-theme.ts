import { json, jsonParseLinter } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Diagnostic } from "@codemirror/lint";
import { tags as t } from "@lezer/highlight";

// JetBrains Darcula token colors (IntelliJ default dark). Chrome (background,
// gutter, active line) stays transparent so the editor inherits the pane behind
// it - the request body editor and the response viewer share this scheme.
const darcula = {
  caret: "#bbbbbb",
  selection: "#214283",
  gutterForeground: "#606366",
  keyword: "#cc7832",
  string: "#6a8759",
  number: "#6897bb",
  property: "#9876aa",
  comment: "#808080",
  invalid: "#bc3f3c",
};

export const darculaChrome = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      height: "100%",
    },
    ".cm-content": { caretColor: darcula.caret },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused .cm-cursor": { borderLeftColor: darcula.caret },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: darcula.selection },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: darcula.gutterForeground,
      border: "none",
    },
    // Keep the fold gutter clickable but never show its arrows (incl. on hover).
    ".cm-foldGutter .cm-gutterElement": { opacity: "0" },
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
    },
    ".cm-tooltip-autocomplete > ul > li": {
      color: "var(--popover-foreground)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--accent-foreground)",
    },
    ".cm-completionLabel": { color: "inherit" },
    ".cm-completionMatchedText": {
      color: "var(--primary)",
      textDecoration: "none",
      fontWeight: "600",
    },
    ".cm-completionIcon": { color: "var(--muted-foreground)", opacity: "1" },
    ".cm-completionDetail": {
      color: "var(--muted-foreground)",
      fontStyle: "normal",
    },
  },
  { dark: true },
);

export const darculaHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.bool, t.null], color: darcula.keyword },
  { tag: [t.string, t.special(t.string)], color: darcula.string },
  { tag: [t.number], color: darcula.number },
  {
    tag: [t.propertyName, t.definition(t.propertyName)],
    color: darcula.property,
  },
  { tag: [t.comment], color: darcula.comment, fontStyle: "italic" },
  { tag: [t.invalid], color: darcula.invalid },
]);

// jsonParseLinter flags an empty document as "Unexpected EOF". An empty request
// body is a valid state (no body), so suppress diagnostics until something is typed.
export function emptyTolerantJsonLinter(): (view: EditorView) => Diagnostic[] {
  const lint = jsonParseLinter();
  return (view) => (view.state.doc.toString().trim() === "" ? [] : lint(view));
}

// Read-only JSON viewer extensions (no editing, no linter, no bracket-closing) -
// same colors as the editor so the response reads like the request body.
export const jsonViewerExtensions = [
  json(),
  EditorView.editable.of(false),
  darculaChrome,
  syntaxHighlighting(darculaHighlight),
];
