import { json, jsonLanguage } from "@codemirror/lang-json";
import { hoverTooltip, type EditorView } from "@codemirror/view";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { JSONSchema7 } from "json-schema";
import {
  jsonCompletion,
  jsonSchemaLinter,
  jsonSchemaHover,
  stateExtensions,
  handleRefresh,
} from "codemirror-json-schema";
import {
  makeChrome,
  makeHighlight,
  emptyTolerantJsonLinter,
  type EditorColors,
} from "@/components/workspace/editor-theme";

// The schema linter emits `severity:"error"` for every schema violation, which
// would make malformed-vs-merely-invalid indistinguishable and (in spirit) gate
// the save. Downgrade every schema diagnostic to a warning so only true JSON
// syntax errors (from the empty-tolerant parse linter) stay errors - the save
// path keeps blocking on syntax alone.
function asWarning(
  source: (view: EditorView) => Diagnostic[],
): (view: EditorView) => Diagnostic[] {
  return (view) =>
    source(view).map((diagnostic) => ({
      ...diagnostic,
      severity: "warning" as const,
    }));
}

// Schema-aware JSON editor extensions: the existing JSON language + empty-tolerant
// syntax linter (errors) + themed chrome/highlight, plus schema-driven validation
// (as warnings), autocomplete, and hover docs sourced from `schema`. When `schema`
// is undefined (generation failed) it degrades to the plain JSON editor pieces.
export function makeSchemaExtensions(
  schema: JSONSchema7 | undefined,
  colors: EditorColors,
  isDark: boolean,
): Extension[] {
  const base: Extension[] = [
    json(),
    linter(emptyTolerantJsonLinter()),
    lintGutter(),
    makeChrome(colors, isDark),
    makeHighlight(colors),
  ];
  if (!schema) {
    return base;
  }
  return [
    ...base,
    linter(asWarning(jsonSchemaLinter()), { needsRefresh: handleRefresh }),
    jsonLanguage.data.of({ autocomplete: jsonCompletion() }),
    hoverTooltip(jsonSchemaHover()),
    stateExtensions(schema),
  ];
}
