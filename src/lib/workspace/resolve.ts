import type { Auth, ScriptConfig, TreeNode } from "@/lib/workspace/model";

export type Provenance = { scopeId: string; scopeName: string };

export type VariableOrigin = "variable" | "environment";

export type ResolvedValue<T> = {
  value: T;
  from: Provenance;
  origin?: VariableOrigin;
};

export type EffectiveConfig = {
  variables: Record<string, ResolvedValue<string>>;
  headers: Record<string, ResolvedValue<string>>;
  params: Record<string, ResolvedValue<string>>;
  auth: ResolvedValue<Auth>;
  scripts: { pre: ResolvedValue<string>; post: ResolvedValue<string> };
  timeoutMs: ResolvedValue<number>;
};

export const DEFAULT_TIMEOUT_MS = 30000;

const DEFAULT_PROVENANCE: Provenance = {
  scopeId: "default",
  scopeName: "default",
};

type Scope = { id: string; name: string; config: TreeNode["config"] };

function findScopePath(
  nodes: TreeNode[],
  requestId: string,
  ancestors: Scope[],
): Scope[] | null {
  for (const node of nodes) {
    const scope: Scope = { id: node.id, name: node.name, config: node.config };
    if (node.kind === "request") {
      if (node.id === requestId) {
        return [...ancestors, scope];
      }
      continue;
    }
    const found = findScopePath(node.children, requestId, [
      ...ancestors,
      scope,
    ]);
    if (found) {
      return found;
    }
  }
  return null;
}

function provenanceOf(scope: Scope): Provenance {
  return { scopeId: scope.id, scopeName: scope.name };
}

function resolveKeyed(
  path: Scope[],
  pick: (config: TreeNode["config"]) => Record<string, string> | undefined,
): Record<string, ResolvedValue<string>> {
  return path.reduce<Record<string, ResolvedValue<string>>>((acc, scope) => {
    const entries = pick(scope.config);
    if (!entries) {
      return acc;
    }
    const from = provenanceOf(scope);
    return Object.entries(entries).reduce(
      (inner, [key, value]) => ({ ...inner, [key]: { value, from } }),
      acc,
    );
  }, {});
}

function resolveVariables(
  path: Scope[],
  environment: string | undefined,
): Record<string, ResolvedValue<string>> {
  return path.reduce<Record<string, ResolvedValue<string>>>((acc, scope) => {
    const envBlock =
      environment !== undefined
        ? scope.config.environments?.[environment]
        : undefined;
    const envFrom: Provenance = {
      scopeId: `${scope.id}:${environment}`,
      scopeName: `${scope.name} (${environment})`,
    };
    const withEnv = Object.entries(envBlock ?? {}).reduce(
      (inner, [key, value]) => ({
        ...inner,
        [key]: { value, from: envFrom, origin: "environment" as const },
      }),
      acc,
    );
    const from = provenanceOf(scope);
    return Object.entries(scope.config.variables ?? {}).reduce(
      (inner, [key, value]) => ({
        ...inner,
        [key]: { value, from, origin: "variable" as const },
      }),
      withEnv,
    );
  }, {});
}

function resolveHeaders(path: Scope[]): Record<string, ResolvedValue<string>> {
  const byLowerName = path.reduce<
    Record<string, { name: string; value: ResolvedValue<string> }>
  >((acc, scope) => {
    const headers = scope.config.headers;
    if (!headers) {
      return acc;
    }
    const from = provenanceOf(scope);
    return headers
      .filter((header) => header.enabled !== false)
      .reduce(
        (inner, { key, value }) => ({
          ...inner,
          [key.toLowerCase()]: { name: key, value: { value, from } },
        }),
        acc,
      );
  }, {});
  return Object.values(byLowerName).reduce(
    (acc, { name, value }) => ({ ...acc, [name]: value }),
    {},
  );
}

function resolveAuth(path: Scope[]): ResolvedValue<Auth> {
  const nearest = [...path]
    .reverse()
    .find(
      (scope) =>
        scope.config.auth !== undefined && scope.config.auth.type !== "inherit",
    );
  if (!nearest || nearest.config.auth === undefined) {
    return { value: { type: "none" }, from: DEFAULT_PROVENANCE };
  }
  return { value: nearest.config.auth, from: provenanceOf(nearest) };
}

function resolveScript(
  path: Scope[],
  pick: (scripts: ScriptConfig) => string | undefined,
): ResolvedValue<string> {
  const nearest = [...path]
    .reverse()
    .find(
      (scope) =>
        scope.config.scripts !== undefined &&
        pick(scope.config.scripts) !== undefined,
    );
  if (!nearest || nearest.config.scripts === undefined) {
    return { value: "", from: DEFAULT_PROVENANCE };
  }
  return {
    value: pick(nearest.config.scripts) ?? "",
    from: provenanceOf(nearest),
  };
}

function resolveTimeout(path: Scope[]): ResolvedValue<number> {
  const nearest = [...path]
    .reverse()
    .find((scope) => scope.config.timeoutMs !== undefined);
  if (!nearest || nearest.config.timeoutMs === undefined) {
    return { value: DEFAULT_TIMEOUT_MS, from: DEFAULT_PROVENANCE };
  }
  return { value: nearest.config.timeoutMs, from: provenanceOf(nearest) };
}

export function resolveConfig(
  tree: TreeNode[],
  requestId: string,
  options?: { environment?: string },
): EffectiveConfig {
  const path = findScopePath(tree, requestId, []) ?? [];
  return {
    variables: resolveVariables(path, options?.environment),
    headers: resolveHeaders(path),
    params: resolveKeyed(
      path,
      (config) =>
        config.params &&
        Object.fromEntries(
          config.params
            .filter((param) => param.enabled !== false)
            .map(({ key, value }) => [key, value]),
        ),
    ),
    auth: resolveAuth(path),
    scripts: {
      pre: resolveScript(path, (scripts) => scripts.pre),
      post: resolveScript(path, (scripts) => scripts.post),
    },
    timeoutMs: resolveTimeout(path),
  };
}
