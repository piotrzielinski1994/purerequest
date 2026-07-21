import { jsonLanguage } from "@codemirror/lang-json";
import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { type EditorView, hoverTooltip } from "@codemirror/view";
import {
  handleRefresh,
  jsonCompletion,
  jsonSchemaHover,
  jsonSchemaLinter,
  stateExtensions,
} from "codemirror-json-schema";
import type { JSONSchema7 } from "json-schema";

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

// Schema-aware JSON editor extensions: the SHARED config editor base (JSON +
// empty-tolerant syntax linter + lint gutter + folding + themed chrome/highlight -
// the exact `configExtensions` set, so the Settings editor can't drift from the
// plain config editor) plus schema-driven validation (as warnings), autocomplete,
// and hover docs sourced from `schema`. When `schema` is undefined (generation
// failed) it degrades to just the shared base.
export function makeSchemaExtensions(
  configBase: Extension[],
  schema: JSONSchema7 | undefined,
): Extension[] {
  if (!schema) {
    return configBase;
  }
  return [
    ...configBase,
    linter(asWarning(jsonSchemaLinter()), { needsRefresh: handleRefresh }),
    jsonLanguage.data.of({ autocomplete: jsonCompletion() }),
    hoverTooltip(jsonSchemaHover()),
    stateExtensions(schema),
  ];
}
