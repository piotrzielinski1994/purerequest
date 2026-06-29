import type { EffectiveConfig } from "@/lib/workspace/resolve";

export type TokenCandidateKind = "variable" | "environment" | "dotenv";

export type TokenCandidate = {
  // The token name inserted between `{{` and `}}` (e.g. "BASE_URL" or
  // "process.env.HOST").
  name: string;
  // Where it comes from, for the dropdown's secondary label + color.
  kind: TokenCandidateKind;
  source: string;
};

export type TokenCompletion = {
  // The open `{{` query: caret sits after `{{`, before any closing `}}`. `prefix`
  // is the text already typed after `{{` (used to filter + to compute the replace
  // range). `start` is the index of the first char after `{{`.
  prefix: string;
  start: number;
  candidates: TokenCandidate[];
};

const PROCESS_ENV_PREFIX = "process.env.";

// Group order in the dropdown: plain variables first, then env vars, then .env
// keys - each group sorted alphabetically within itself.
const KIND_ORDER: Record<TokenCandidateKind, number> = {
  variable: 0,
  environment: 1,
  dotenv: 2,
};

// All token names offerable for a field: the resolved variables (vars + the active
// env's vars, already merged into effective.variables) plus every `.env` key as
// `process.env.X`. Tagged with origin, ordered by group (var -> env -> .env) then
// name.
export function tokenCandidates(
  effective: EffectiveConfig | null,
  processEnv: Record<string, string>,
  // The scope being edited (request/folder id). A variable resolved FROM this scope
  // gets a blank source - its scope name is long/noisy (e.g. a request path) and
  // redundant when you're already in it.
  ownScopeId?: string,
): TokenCandidate[] {
  const isOwn = (scopeId: string): boolean => {
    if (ownScopeId === undefined) {
      return false;
    }
    // Env-sourced provenance encodes scopeId as `${scopeId}:${env}`; match the base.
    return scopeId === ownScopeId || scopeId.startsWith(`${ownScopeId}:`);
  };
  const fromVars: TokenCandidate[] = effective
    ? Object.entries(effective.variables).map(([name, resolved]) => ({
        name,
        kind: resolved.origin === "environment" ? "environment" : "variable",
        source: isOwn(resolved.from.scopeId) ? "" : resolved.from.scopeName,
      }))
    : [];
  const fromDotenv: TokenCandidate[] = Object.keys(processEnv).map((key) => ({
    name: `${PROCESS_ENV_PREFIX}${key}`,
    kind: "dotenv",
    source: ".env",
  }));
  const all = [...fromVars, ...fromDotenv];
  // Rank each source by appearance, then INVERT it: effective.variables is built
  // root -> leaf (parent first), but the nearest folder should lead, so a
  // later-seen (deeper) source ranks ahead. Keeps each source's candidates grouped
  // (no as24/lts interleaving); alphabetical within a source.
  const order: string[] = [];
  all.forEach((c) => {
    if (!order.includes(c.source)) {
      order.push(c.source);
    }
  });
  const nearestRank = (source: string): number =>
    order.length - 1 - order.indexOf(source);
  return all.sort((a, b) => {
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) {
      return byKind;
    }
    const bySource = nearestRank(a.source) - nearestRank(b.source);
    return bySource !== 0 ? bySource : a.name.localeCompare(b.name);
  });
}

// Is the caret inside an OPEN `{{ ... ` token (after `{{`, with no closing `}}`
// between the `{{` and the caret)? If so, return the typed prefix + its start
// index; else null. Scans backwards from the caret for the nearest `{{`, bailing
// if a `}}` is hit first (caret is past a closed token).
function openTokenAt(
  text: string,
  caret: number,
): { prefix: string; start: number } | null {
  for (let i = caret - 1; i >= 1; i -= 1) {
    if (text[i] === "}" && text[i - 1] === "}") {
      return null;
    }
    if (text[i] === "{" && text[i - 1] === "{") {
      const start = i + 1;
      const prefix = text.slice(start, caret);
      // A token name has no braces; if the user typed `}` already, it's not open.
      if (prefix.includes("}") || prefix.includes("{")) {
        return null;
      }
      return { prefix, start };
    }
  }
  return null;
}

// The completion state for a field's current value + caret: null when the caret
// isn't inside an open `{{`, else the prefix, its start index, and the filtered
// candidates (case-insensitive prefix match, ranked exact-prefix first).
export function tokenCompletionAt(
  text: string,
  caret: number,
  all: TokenCandidate[],
): TokenCompletion | null {
  const open = openTokenAt(text, caret);
  if (open === null) {
    return null;
  }
  const query = open.prefix.trim().toLowerCase();
  const candidates = all.filter((c) =>
    c.name.toLowerCase().includes(query),
  );
  if (candidates.length === 0) {
    return null;
  }
  return { prefix: open.prefix, start: open.start, candidates };
}

// Apply a candidate: replace the open token's typed prefix with the full name and
// auto-close with `}}` unless a `}}` already follows the caret. Returns the new
// text + the caret position to set (just after the inserted `}}`, or after the
// name when a `}}` already followed).
export function applyTokenCandidate(
  text: string,
  completion: TokenCompletion,
  caret: number,
  candidate: TokenCandidate,
): { text: string; caret: number } {
  const before = text.slice(0, completion.start);
  const after = text.slice(caret);
  const hasClose = after.startsWith("}}");
  const insert = hasClose ? candidate.name : `${candidate.name}}}`;
  return {
    text: `${before}${insert}${after}`,
    caret: before.length + insert.length + (hasClose ? 2 : 0),
  };
}
