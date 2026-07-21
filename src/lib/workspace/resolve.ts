import {
  listEnvironmentNames,
  type ProcessEnv,
  parseDotenv,
} from "@/lib/workspace/environment";
import type { Auth, ScriptConfig, TreeNode } from "@/lib/workspace/model";
import { emptyAuth } from "@/lib/workspace/model";

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
  auth: ResolvedValue<Auth>;
  scripts: { pre: ResolvedValue<string>; post: ResolvedValue<string> };
  timeoutMs: ResolvedValue<number>;
};

export const DEFAULT_TIMEOUT_MS = 30000;

const DEFAULT_PROVENANCE: Provenance = {
  scopeId: "default",
  scopeName: "default",
};

export type Scope = {
  id: string;
  name: string;
  config: TreeNode["config"];
  dotenv?: string;
  environmentColors?: Record<string, string>;
};

export function findScopePath(
  nodes: TreeNode[],
  requestId: string,
  ancestors: Scope[],
): Scope[] | null {
  for (const node of nodes) {
    const scope: Scope = {
      id: node.id,
      name: node.name,
      config: node.config,
      ...(node.kind === "folder" && node.dotenv !== undefined
        ? { dotenv: node.dotenv }
        : {}),
      ...(node.kind === "folder" && node.environmentColors !== undefined
        ? { environmentColors: node.environmentColors }
        : {}),
    };
    // Match a request OR a folder by id: a folder pane resolves its own chain
    // (root -> that folder) so its {{token}} previews resolve like a request's.
    if (node.id === requestId) {
      return [...ancestors, scope];
    }
    if (node.kind === "request") {
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

// The color that recolors the shell for a node under the active env: walk the
// scope path (root -> node) and take the nearest ancestor folder that has a color
// for `env`. Null when env is unset. Works for a folder id (its own path ends at
// it) and a request id (inherits the nearest ancestor folder). Env-keyed: a folder
// colored only for "prod" yields null for "local".
export function accentColorFor(
  tree: TreeNode[],
  id: string | null,
  env: string | null | undefined,
): string | null {
  if (id === null || env === null || env === undefined) {
    return null;
  }
  const path = findScopePath(tree, id, []) ?? [];
  const nearest = [...path]
    .reverse()
    .find((scope) => scope.environmentColors?.[env] !== undefined);
  return nearest?.environmentColors?.[env] ?? null;
}

// The env names in scope for a node: the sorted union of every ancestor folder's
// `config.environments` keys along the chain root -> node. A null id falls back to
// every env name in the tree.
export function environmentNamesForScope(
  tree: TreeNode[],
  id: string | null,
): string[] {
  if (id === null) {
    return listEnvironmentNames(tree);
  }
  const path = findScopePath(tree, id, []) ?? [];
  const names = path.reduce<Set<string>>((acc, scope) => {
    (scope.config.environments ?? []).forEach((env) => {
      acc.add(env.name);
    });
    // An env a folder has COLORED but not declared in config.environments is still
    // in scope - coloring it is a per-folder signal the folder cares about it.
    Object.keys(scope.environmentColors ?? {}).forEach((name) => {
      acc.add(name);
    });
    return acc;
  }, new Set());
  return [...names].sort();
}

// For each env name declared along the chain root -> node, the NAME of the nearest
// folder that defines it (in config.environments). Lets a sub-folder's env picker
// mark which envs it inherits from a parent vs owns. Iterating the path root->leaf
// and overwriting means the nearest (deepest) defining folder wins.
export function environmentOrigins(
  tree: TreeNode[],
  id: string,
): Record<string, string> {
  const path = findScopePath(tree, id, []) ?? [];
  return Object.fromEntries(
    path.flatMap((scope) =>
      (scope.config.environments ?? []).map(
        (env) => [env.name, scope.name] as const,
      ),
    ),
  );
}

function provenanceOf(scope: Scope): Provenance {
  return { scopeId: scope.id, scopeName: scope.name };
}

function resolveVariables(
  path: Scope[],
  environment: string | undefined,
): Record<string, ResolvedValue<string>> {
  return Object.fromEntries(
    path.flatMap((scope) => {
      const envRows =
        environment !== undefined
          ? scope.config.environments?.find((e) => e.name === environment)
              ?.variables
          : undefined;
      const envFrom: Provenance = {
        scopeId: `${scope.id}:${environment}`,
        scopeName: `${scope.name} (${environment})`,
      };
      // Env block first, plain vars second, so a scope's plain variable WINS over
      // that same scope's active-environment value for the same key.
      const envEntries = (envRows ?? [])
        .filter((row) => row.enabled !== false)
        .map(
          ({ key, value }) =>
            [
              key,
              { value, from: envFrom, origin: "environment" as const },
            ] as const,
        );
      const from = provenanceOf(scope);
      const varEntries = (scope.config.variables ?? [])
        .filter((row) => row.enabled !== false)
        .map(
          ({ key, value }) =>
            [key, { value, from, origin: "variable" as const }] as const,
        );
      return [...envEntries, ...varEntries];
    }),
  );
}

function resolveHeaders(path: Scope[]): Record<string, ResolvedValue<string>> {
  const byLowerName: Record<
    string,
    { name: string; value: ResolvedValue<string> }
  > = Object.fromEntries(
    path.flatMap((scope) => {
      const headers = scope.config.headers;
      if (!headers) {
        return [];
      }
      const from = provenanceOf(scope);
      return headers
        .filter((header) => header.enabled !== false)
        .map(
          ({ key, value }) =>
            [key.toLowerCase(), { name: key, value: { value, from } }] as const,
        );
    }),
  );
  return Object.fromEntries(
    Object.values(byLowerName).map(({ name, value }) => [name, value] as const),
  );
}

function resolveAuth(path: Scope[]): ResolvedValue<Auth> {
  const nearest = [...path]
    .reverse()
    .find(
      (scope) =>
        scope.config.auth !== undefined &&
        scope.config.auth.active !== "inherit",
    );
  if (!nearest || nearest.config.auth === undefined) {
    return {
      value: { ...emptyAuth(), active: "none" },
      from: DEFAULT_PROVENANCE,
    };
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

export type ProcessEnvProvenance = Record<
  string,
  { value: string; scopeId: string | null }
>;

// Fold a request's folder-chain `.env` over the root base. `findScopePath`
// returns scopes root->leaf, so iterating in order lets a nearer folder's key
// overwrite a farther one; the root base seeds the accumulator first.
function foldProcessEnv(
  tree: TreeNode[],
  requestId: string,
  rootEnv: ProcessEnv,
): ProcessEnvProvenance {
  const path = findScopePath(tree, requestId, []) ?? [];
  const seeded = Object.entries(rootEnv).map(
    ([key, value]) => [key, { value, scopeId: null }] as const,
  );
  const scoped = path.flatMap((scope) => {
    if (scope.dotenv === undefined) {
      return [];
    }
    return Object.entries(parseDotenv(scope.dotenv)).map(
      ([key, value]) => [key, { value, scopeId: scope.id }] as const,
    );
  });
  return Object.fromEntries([...seeded, ...scoped]);
}

export function resolveProcessEnv(
  tree: TreeNode[],
  requestId: string,
  rootEnv: ProcessEnv,
): ProcessEnv {
  const prov = foldProcessEnv(tree, requestId, rootEnv);
  return Object.fromEntries(
    Object.entries(prov).map(([key, { value }]) => [key, value]),
  );
}

export function resolveProcessEnvProvenance(
  tree: TreeNode[],
  requestId: string,
  rootEnv: ProcessEnv,
): ProcessEnvProvenance {
  return foldProcessEnv(tree, requestId, rootEnv);
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
    auth: resolveAuth(path),
    scripts: {
      pre: resolveScript(path, (scripts) => scripts.pre),
      post: resolveScript(path, (scripts) => scripts.post),
    },
    timeoutMs: resolveTimeout(path),
  };
}
