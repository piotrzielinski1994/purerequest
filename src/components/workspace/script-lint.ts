import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import type { Diagnostic } from "@codemirror/lint";

const PARSE_TIMEOUT_MS = 1000;

// Syntax-only linter: walks the Lezer JS parse tree and flags error nodes
// (unclosed brace/string, stray token, ...). NOT a semantic check - an
// undefined variable is a runtime ReferenceError, not a parse error, so it is
// deliberately not reported here. Mirrors how the body editor lints JSON.
export function jsSyntaxLinter(): (view: EditorView) => Diagnostic[] {
  return (view) => {
    const doc = view.state.doc;
    if (doc.toString().trim() === "") {
      return [];
    }
    const tree = ensureSyntaxTree(view.state, doc.length, PARSE_TIMEOUT_MS);
    if (!tree) {
      return [];
    }
    const diagnostics: Diagnostic[] = [];
    tree.iterate({
      enter: (node) => {
        if (!node.type.isError) {
          return;
        }
        // A zero-width error node (missing token) gets a 1-char span so the
        // marker is visible; clamp to the doc end.
        const from = node.from;
        const to = node.to > node.from ? node.to : Math.min(from + 1, doc.length);
        diagnostics.push({
          from,
          to,
          severity: "error",
          message: "Syntax error",
        });
      },
    });
    return diagnostics;
  };
}
