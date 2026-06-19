import CodeMirror from "@uiw/react-codemirror";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { closeBrackets } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { tags as t } from "@lezer/highlight";

// JetBrains Darcula token colors (IntelliJ default dark). Chrome (background,
// gutter, active line) stays transparent so the editor inherits the pane behind
// it - matching the response pane on the right.
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

const darculaChrome = EditorView.theme(
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
    ".cm-scroller": {
      fontFamily: "var(--font-mono, ui-monospace, monospace)",
    },
  },
  { dark: true },
);

const darculaHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.bool, t.null], color: darcula.keyword },
  { tag: [t.string, t.special(t.string)], color: darcula.string },
  { tag: [t.number], color: darcula.number },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: darcula.property },
  { tag: [t.comment], color: darcula.comment, fontStyle: "italic" },
  { tag: [t.invalid], color: darcula.invalid },
]);

const extensions = [
  json(),
  closeBrackets(),
  linter(jsonParseLinter()),
  lintGutter(),
  darculaChrome,
  syntaxHighlighting(darculaHighlight),
];

type BodyEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

export function BodyEditor({ value, onChange }: BodyEditorProps) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme="none"
      extensions={extensions}
      height="100%"
      className="h-full text-xs"
    />
  );
}
