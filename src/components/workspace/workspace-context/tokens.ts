import { SETTINGS_TAB_ID } from "@/components/workspace/pane-tabs";
import type { TokenTarget } from "@/components/workspace/url-token";
import type { ConfigSavesApi } from "@/components/workspace/workspace-context/config-saves";
import type { PersistApi } from "@/components/workspace/workspace-context/persist";
import type { RequestEditsApi } from "@/components/workspace/workspace-context/request-edits";
import type { WorkspaceInternals } from "@/components/workspace/workspace-context/types";
import { setDotenvValue } from "@/lib/workspace/environment";
import type { ConfigScope } from "@/lib/workspace/model";
import { upsertRow } from "@/lib/workspace/model";
import { resolveProcessEnvProvenance } from "@/lib/workspace/resolve";
import { findNode } from "@/lib/workspace/tree-locate";
import { updateFolderDotenv } from "@/lib/workspace/update-folder-dotenv";

export type TokensApi = {
  setTokenValue: (target: TokenTarget, value: string) => void;
  revealTokenSource: (target: TokenTarget) => void;
};

export function createTokens(
  internals: WorkspaceInternals,
  deps: {
    persistTree: PersistApi["persistTree"];
    saveEnv: PersistApi["saveEnv"];
    saveNodeConfig: ConfigSavesApi["saveNodeConfig"];
    setRequestPathParams: RequestEditsApi["setRequestPathParams"];
  },
): TokensApi {
  const {
    tree,
    envText,
    processEnv,
    requestsById,
    activeScopeId,
    revealNonce,
    paramsRevealNonce,
    setEditTarget,
    setIsEditorActive,
    setOpenRequestIds,
    setActiveRequestId,
    setActiveRequestTab,
    setRevealTarget,
    setParamsReveal,
  } = internals;
  const { persistTree, saveEnv, saveNodeConfig, setRequestPathParams } = deps;

  const setTokenValue = (target: TokenTarget, value: string) => {
    if (target.kind === "dotenv") {
      // Write to the `.env` that PROVIDED this key for the active SCOPE (a folder
      // pane resolves its own chain; a request its folder chain): the nearest
      // folder defining it, else the workspace-root `.env`. Editing the root when
      // a nearer folder shadows it would be silently overridden.
      const owner =
        activeScopeId !== null
          ? (resolveProcessEnvProvenance(tree, activeScopeId, processEnv)[
              target.key
            ]?.scopeId ?? null)
          : null;
      if (owner === null) {
        saveEnv(setDotenvValue(envText, target.key, value));
        return;
      }
      const folder = findNode(tree, owner);
      const nextDotenv = setDotenvValue(
        folder?.kind === "folder" ? (folder.dotenv ?? "") : "",
        target.key,
        value,
      );
      persistTree(updateFolderDotenv(tree, owner, nextDotenv), "env");
      return;
    }
    if (target.kind === "path") {
      const node = requestsById.get(target.requestId);
      if (!node) {
        return;
      }
      const next = upsertRow(node.params.path, target.name, value);
      setRequestPathParams(target.requestId, next);
      return;
    }
    const node = findNode(tree, target.scopeId);
    if (!node) {
      return;
    }
    const config = node.config;
    const nextConfig: ConfigScope =
      target.kind === "environment"
        ? {
            ...config,
            environments: (config.environments ?? []).some(
              (env) => env.name === target.env,
            )
              ? (config.environments ?? []).map((env) =>
                  env.name === target.env
                    ? {
                        ...env,
                        variables: upsertRow(env.variables, target.name, value),
                      }
                    : env,
                )
              : [
                  ...(config.environments ?? []),
                  {
                    name: target.env,
                    variables: [{ key: target.name, value }],
                  },
                ],
          }
        : {
            ...config,
            variables: upsertRow(config.variables ?? [], target.name, value),
          };
    saveNodeConfig(target.scopeId, nextConfig);
  };

  // Jump from a token popup to the exact place the value is editable: the
  // highest-priority scope that actually PROVIDES it (nearest folder wins).
  // dotenv -> that folder's Env > .env (root .env lives in Settings); an env
  // var -> Env > Envs with its env picked; a plain var -> Vars. A value owned
  // by the request itself opens the request's own tab instead of a folder.
  const revealTokenSource = (target: TokenTarget) => {
    if (target.kind === "path") {
      setIsEditorActive(false);
      setOpenRequestIds((current) =>
        current.includes(target.requestId)
          ? current
          : [...current, target.requestId],
      );
      setActiveRequestId(target.requestId);
      setActiveRequestTab("params");
      paramsRevealNonce.current += 1;
      setParamsReveal({ nonce: paramsRevealNonce.current, subTab: "path" });
      return;
    }
    if (target.kind === "dotenv") {
      const owner =
        activeScopeId !== null
          ? (resolveProcessEnvProvenance(tree, activeScopeId, processEnv)[
              target.key
            ]?.scopeId ?? null)
          : null;
      if (owner === null) {
        setOpenRequestIds((current) =>
          current.includes(SETTINGS_TAB_ID)
            ? current
            : [...current, SETTINGS_TAB_ID],
        );
        setActiveRequestId(SETTINGS_TAB_ID);
        setIsEditorActive(false);
        return;
      }
      revealNonce.current += 1;
      setRevealTarget({
        nonce: revealNonce.current,
        folderId: owner,
        view: "dotenv",
      });
      setEditTarget({ kind: "config", id: owner });
      setIsEditorActive(true);
      return;
    }
    const node = findNode(tree, target.scopeId);
    if (!node) {
      return;
    }
    if (node.kind === "request") {
      setIsEditorActive(false);
      setOpenRequestIds((current) =>
        current.includes(node.id) ? current : [...current, node.id],
      );
      setActiveRequestId(node.id);
      setActiveRequestTab("vars");
      return;
    }
    revealNonce.current += 1;
    setRevealTarget({
      nonce: revealNonce.current,
      folderId: node.id,
      view: target.kind === "environment" ? "envs" : "vars",
      env: target.kind === "environment" ? target.env : undefined,
    });
    setEditTarget({ kind: "config", id: node.id });
    setIsEditorActive(true);
  };

  return { setTokenValue, revealTokenSource };
}
