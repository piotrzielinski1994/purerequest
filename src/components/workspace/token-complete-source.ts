import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import {
  applyTokenCandidate,
  type TokenCandidate,
  tokenCompletionAt,
} from "@/components/workspace/token-complete";

// A CodeMirror CompletionSource that offers `{{token}}` candidates inside an open
// `{{ ... ` token, wrapping the same pure core the token-aware text input uses
// (tokenCompletionAt for the open-token/filter logic, applyTokenCandidate for the
// prefix-replace + `}}` auto-close). Registered via the JSON language-data
// `autocomplete` facet, so it COMPOSES with any other source (e.g. schema
// completion) rather than replacing it. Returns null when the caret is not inside
// an open token or nothing matches - CodeMirror then shows no token options.
// The concrete synchronous source signature (assignable to CodeMirror's
// `CompletionSource`, whose return is a `... | Promise<...>` union) - so a test /
// caller reading `result.from`/`result.options` gets the precise result type.
export function tokenCompletionSource(
  candidates: TokenCandidate[],
): (context: CompletionContext) => CompletionResult | null {
  return (context: CompletionContext): CompletionResult | null => {
    const text = context.state.doc.toString();
    const completion = tokenCompletionAt(text, context.pos, candidates);
    if (completion === null) {
      return null;
    }
    const options: Completion[] = completion.candidates.map((candidate) => ({
      label: candidate.name,
      // `type` IS the kind: `tokenOptionClass` turns it into `cm-token-<kind>`,
      // which `makeChrome` colors emerald / sky / amber to match the React token
      // listbox. Do NOT remap it (icons are off, so it drives only the color).
      type: candidate.kind,
      ...(candidate.source !== "" ? { detail: candidate.source } : {}),
      // Insert via applyTokenCandidate against the LIVE doc/caret (`to`), then
      // dispatch only the changed span [start, caret) so undo history + scroll are
      // preserved (the pure fn returns the whole text; the changed slice is the
      // middle between the unchanged prefix `start` and the unchanged suffix).
      apply: (view, _completion, _from, to) => {
        const docText = view.state.doc.toString();
        const at = tokenCompletionAt(docText, to, candidates);
        if (at === null) {
          return;
        }
        const next = applyTokenCandidate(docText, at, to, candidate);
        const suffixLength = docText.length - to;
        const insert = next.text.slice(
          at.start,
          next.text.length - suffixLength,
        );
        view.dispatch({
          changes: { from: at.start, to, insert },
          selection: { anchor: next.caret },
        });
      },
    }));
    return {
      from: completion.start,
      options,
      // `filter: false` keeps CodeMirror from re-sorting/re-filtering: the options
      // are ALREADY filtered + grouped by `tokenCompletionAt` (variable -> env ->
      // dotenv, nearest scope first), and CM's default fuzzy sort would re-order
      // them alphabetically - diverging from the React input listbox. We still
      // re-run the source as the user types (no `validFor`) so the grouped order
      // is preserved at every keystroke.
      filter: false,
    };
  };
}
