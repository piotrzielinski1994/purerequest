import type { EffectiveConfig } from "@/lib/workspace/resolve";
import { interpolate } from "@/lib/http/interpolate";

export type TokenKind = "variable" | "environment" | "dotenv" | "path";

export type TokenTarget =
  | { kind: "variable"; scopeId: string; name: string }
  | { kind: "environment"; scopeId: string; env: string; name: string }
  | { kind: "dotenv"; key: string }
  | { kind: "path"; requestId: string; name: string };

export type TokenPreview = {
  value: string;
  rawValue: string;
  source: string;
  kind: TokenKind;
  // The nearest scope row that defines this token - what the pencil "go to
  // source" jumps to.
  target: TokenTarget;
  // The TERMINAL source the inline edit writes to: the drill follows a chain of
  // pure {{token}} pointers to the row holding the real literal (or the `.env`
  // key a {{process.env.KEY}} pointer resolves to). Equals `target` when the
  // nearest row is already a literal (no indirection to follow).
  writeTarget: TokenTarget;
};

const PROCESS_ENV_PREFIX = "process.env.";

// A single, pure `{{token}}` reference (only surrounding whitespace) -> its
// trimmed inner name; anything embedded, a second token, or a non-token value
// -> null. Generalizes `processEnvRefKey` (lib/scripts/var-write.ts) to any
// token, so a `{{process.env.KEY}}` pointer is just an inner name carrying the
// known prefix.
const PURE_REF = /^\s*\{\{\s*([^}\s]+)\s*\}\}\s*$/;

export function pureRefInner(value: string): string | null {
  return PURE_REF.exec(value)?.[1] ?? null;
}

function varMap(effective: EffectiveConfig): Record<string, string> {
  return Object.fromEntries(
    Object.entries(effective.variables).map(([key, resolved]) => [
      key,
      resolved.value,
    ]),
  );
}

// The write/reveal target for a resolved variable row: an `environment` target
// when the value came from the active env block (its provenance scopeId encodes
// `${scopeId}:${env}` - strip the env suffix), else a plain `variable` target.
function variableTarget(
  name: string,
  resolved: EffectiveConfig["variables"][string],
  environment?: string,
): TokenTarget {
  const isEnv = resolved.origin === "environment";
  if (isEnv && environment) {
    return {
      kind: "environment",
      scopeId: resolved.from.scopeId.slice(0, -(environment.length + 1)),
      env: environment,
      name,
    };
  }
  return { kind: "variable", scopeId: resolved.from.scopeId, name };
}

// Walk the reference chain from `name` to the TERMINAL source the inline edit
// should write to: a `dotenv` target when a hop is a pure `{{process.env.KEY}}`
// pointer, the first row whose value is a real literal (env-aware target), or -
// for a dead-end pointer (undefined var) or a reference cycle - the hovered
// var's own row (falls back to today's overwrite, never loops or throws).
export function resolveWriteTarget(
  name: string,
  effective: EffectiveConfig,
  environment?: string,
): TokenTarget {
  const resolved = effective.variables[name];
  const fallback: TokenTarget = resolved
    ? variableTarget(name, resolved, environment)
    : { kind: "variable", scopeId: "default", name };
  const walk = (current: string, visited: Set<string>): TokenTarget => {
    if (current.startsWith(PROCESS_ENV_PREFIX)) {
      return { kind: "dotenv", key: current.slice(PROCESS_ENV_PREFIX.length) };
    }
    if (visited.has(current)) {
      return fallback;
    }
    const row = effective.variables[current];
    if (!row) {
      return fallback;
    }
    const inner = pureRefInner(row.value);
    if (inner === null) {
      return variableTarget(current, row, environment);
    }
    return walk(inner, new Set(visited).add(current));
  };
  return walk(name, new Set());
}

export function resolveTokenPreview(
  name: string,
  effective: EffectiveConfig,
  processEnv: Record<string, string>,
  environment?: string,
): TokenPreview | null {
  if (name.startsWith(PROCESS_ENV_PREFIX)) {
    const key = name.slice(PROCESS_ENV_PREFIX.length);
    const raw = processEnv[key];
    return raw === undefined
      ? null
      : {
          value: raw,
          rawValue: raw,
          source: ".env",
          kind: "dotenv",
          target: { kind: "dotenv", key },
          writeTarget: { kind: "dotenv", key },
        };
  }
  const resolved = effective.variables[name];
  if (!resolved) {
    return null;
  }
  const isEnv = resolved.origin === "environment";
  return {
    value: interpolate(resolved.value, varMap(effective), processEnv),
    rawValue: resolved.value,
    source: resolved.from.scopeName,
    kind: isEnv ? "environment" : "variable",
    target: variableTarget(name, resolved, environment),
    writeTarget: resolveWriteTarget(name, effective, environment),
  };
}

// Preview for a `:name` path param. Its value lives on the request (not in the
// resolved config), keyed by the bare name; a missing/blank value is still a
// valid, editable token (shows the empty input), so this only returns null when
// there's no request context to write back to.
export function resolvePathTokenPreview(
  name: string,
  requestId: string | null,
  pathValues: Record<string, string>,
  effective: EffectiveConfig,
  processEnv: Record<string, string>,
): TokenPreview | null {
  if (requestId === null) {
    return null;
  }
  const raw = pathValues[name] ?? "";
  const target: TokenTarget = { kind: "path", requestId, name };
  return {
    value: interpolate(raw, varMap(effective), processEnv),
    rawValue: raw,
    source: "path param",
    kind: "path",
    target,
    // A path value lives on the request; there is no reference chain to drill.
    writeTarget: target,
  };
}
