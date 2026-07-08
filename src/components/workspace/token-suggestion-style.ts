import type { Completion } from "@codemirror/autocomplete";
import { autocompletion } from "@codemirror/autocomplete";
import type { TokenCandidateKind } from "@/components/workspace/token-complete";

// THE single source of the token-kind colors, shared by BOTH `{{token}}` popups:
// the React listbox (`TokenSuggestionList`, used by `HighlightedInput`) and the
// CodeMirror completion tooltip (colored via `makeChrome`'s `.cm-token-<kind>`
// rules keyed off `tokenOptionClass`). Keep this map, the CM `optionClass`, and
// the `makeChrome` CSS in sync so the two surfaces stay visually identical.
export const TOKEN_KIND_COLOR: Record<TokenCandidateKind, string> = {
  variable: "text-emerald-500 dark:text-emerald-400",
  environment: "text-sky-600 dark:text-sky-400",
  dotenv: "text-amber-500 dark:text-amber-400",
};

const TOKEN_KINDS = new Set<TokenCandidateKind>([
  "variable",
  "environment",
  "dotenv",
]);

// CodeMirror `optionClass`: a token option's `type` IS its kind, so `makeChrome`'s
// `.cm-token-<kind> .cm-completionLabel` rule colors the label the same emerald /
// sky / amber the listbox uses. Non-token options (schema/script) get no class.
export function tokenOptionClass(completion: Completion): string {
  const type = completion.type;
  return type && TOKEN_KINDS.has(type as TokenCandidateKind)
    ? `cm-token-${type}`
    : "";
}

// The CodeMirror config half of the shared contract: per-kind label coloring
// (`optionClass`) + no icon column (`icons: false`), so the popup matches the
// React token listbox (bare kind-colored name + muted source). Merges into
// basicSetup's single `autocompletion()` instance (config is combined via facets,
// the view plugin de-duped), so it never spawns a second popup; `icons` merges as
// `a && b`, so this turns the icon column off for the token-enabled editors.
export const tokenCompletionConfig = autocompletion({
  optionClass: tokenOptionClass,
  icons: false,
});
