import type { RequestNode } from "@/lib/workspace/model";
import type { HttpRequest, ResponseState } from "@/lib/http/model";
import { buildHttpRequest } from "@/lib/http/build-request";
import {
  resolveConfig,
  resolveProcessEnv,
  resolveProcessEnvProvenance,
} from "@/lib/workspace/resolve";
import { parseDotenv, setDotenvValue } from "@/lib/workspace/environment";
import { updateFolderDotenv } from "@/lib/workspace/update-folder-dotenv";
import { findNode } from "@/lib/workspace/tree-locate";
import {
  applyPreToEffective,
  buildScriptApi,
  type ReqDraft,
  type VarWrite,
} from "@/lib/scripts/script-context";
import { resolveVarWriteTarget, setNodeVar } from "@/lib/scripts/var-write";
import type { WorkspaceInternals } from "@/components/workspace/workspace-context/types";
import type { PersistApi } from "@/components/workspace/workspace-context/persist";

export type SendApi = {
  sendRequest: (id: string) => Promise<void>;
  cancelRequest: (id: string) => void;
  resolveActiveWire: () => HttpRequest | null;
  openCodeGen: () => void;
  closeCodeGen: () => void;
};

export function createSend(
  internals: WorkspaceInternals,
  deps: { persistTree: PersistApi["persistTree"]; saveEnv: PersistApi["saveEnv"] },
): SendApi {
  const {
    tree,
    envText,
    processEnv,
    requestsById,
    responseStates,
    activeRequestId,
    effectiveEnvironment,
    sendGeneration,
    inFlightRequestId,
    httpClientRef,
    scriptRunnerRef,
    setResponseStates,
    setConsoleLines,
    setIsCodeGenOpen,
  } = internals;
  const { persistTree, saveEnv } = deps;

  const sendRequest = async (id: string) => {
    const node = requestsById.get(id);
    if (!node || responseStates.get(id)?.status === "sending") {
      return;
    }
    const effective = resolveConfig(tree, id, {
      environment: effectiveEnvironment ?? undefined,
    });
    const foldedEnv = resolveProcessEnv(tree, id, processEnv);
    const generation = (sendGeneration.current.get(id) ?? 0) + 1;
    sendGeneration.current.set(id, generation);
    setResponseStates((current) =>
      new Map(current).set(id, { status: "sending" }),
    );

    const isStale = () => sendGeneration.current.get(id) !== generation;
    const setState = (state: ResponseState) =>
      setResponseStates((current) =>
        current.has(id) ? new Map(current).set(id, state) : current,
      );
    const pendingLines: string[] = [];
    const flushLines = () => {
      if (pendingLines.length === 0) {
        return;
      }
      const drained = pendingLines.splice(0);
      setConsoleLines((lines) => [...lines, ...drained]);
    };
    // A script's console.clear wipes the panel + any lines buffered this run.
    const clearConsole = () => {
      pendingLines.splice(0);
      setConsoleLines([]);
    };
    // A setVar persists either to a node's config.variables OR, when the var's
    // nearest definition is a pure {{process.env.KEY}} pointer, to the .env that
    // provides KEY (root or owning folder) - leaving the pointer row untouched.
    // Fold both edit kinds over one {tree, envText} accumulator, then persist
    // whichever channels actually changed.
    const persistVarWrites = (writes: VarWrite[]) => {
      if (writes.length === 0) {
        return;
      }
      const next = writes.reduce(
        (acc, write) => {
          const target = resolveVarWriteTarget(acc.tree, id, write.name);
          if (target.kind === "config") {
            return {
              ...acc,
              tree: setNodeVar(acc.tree, target.nodeId, write.name, write.value),
            };
          }
          const owner =
            resolveProcessEnvProvenance(
              acc.tree,
              id,
              parseDotenv(acc.envText),
            )[target.key]?.scopeId ?? null;
          if (owner === null) {
            return {
              ...acc,
              envText: setDotenvValue(acc.envText, target.key, write.value),
            };
          }
          const folder = findNode(acc.tree, owner);
          const folderDotenv =
            folder?.kind === "folder" ? folder.dotenv ?? "" : "";
          return {
            ...acc,
            tree: updateFolderDotenv(
              acc.tree,
              owner,
              setDotenvValue(folderDotenv, target.key, write.value),
            ),
          };
        },
        { tree, envText },
      );
      if (next.tree !== tree) {
        persistTree(next.tree, "script", true);
      }
      if (next.envText !== envText) {
        saveEnv(next.envText, true);
      }
    };

    // PRE-request script: may mutate a reqDraft + set runtime/persisted vars.
    const runtimeVars = new Map<string, string>();
    const reqDraft: ReqDraft = {
      method: node.method,
      url: node.url,
      body: node.body.types.json,
      headerOverrides: {},
    };
    const preCode = effective.scripts.pre.value;
    if (preCode.trim() !== "") {
      const preVarWrites: VarWrite[] = [];
      const api = buildScriptApi({
        stage: "pre",
        effective,
        processEnv: foldedEnv,
        envName: effectiveEnvironment ?? null,
        runtimeVars,
        varWrites: preVarWrites,
        log: (line) => pendingLines.push(line),
        clear: clearConsole,
        reqDraft,
      });
      const outcome = await scriptRunnerRef.current.run(preCode, api);
      if (isStale()) {
        flushLines();
        return;
      }
      if (!outcome.ok) {
        pendingLines.push(`[pre] error: ${outcome.error}`);
        flushLines();
        setState({ status: "error", message: outcome.error });
        return;
      }
      persistVarWrites(preVarWrites);
      flushLines();
    }

    const node2: RequestNode = {
      ...node,
      method: reqDraft.method,
      url: reqDraft.url,
      body: { ...node.body, types: { ...node.body.types, json: reqDraft.body } },
    };
    const wire = buildHttpRequest(
      node2,
      applyPreToEffective(effective, runtimeVars, reqDraft.headerOverrides),
      foldedEnv,
    );
    inFlightRequestId.current.set(id, wire.requestId);

    const result = await httpClientRef.current.send(wire);
    if (isStale()) {
      return;
    }
    inFlightRequestId.current.delete(id);
    if (!result.ok) {
      setState(
        result.cancelled
          ? { status: "idle" }
          : { status: "error", message: result.error },
      );
      return;
    }

    // POST-response script: read-only res + may set vars. A throw never
    // downgrades the success state; writes recorded before a throw still persist.
    const response = result.response;
    const postCode = effective.scripts.post.value;
    if (postCode.trim() !== "") {
      const postVarWrites: VarWrite[] = [];
      const api = buildScriptApi({
        stage: "post",
        effective,
        processEnv: foldedEnv,
        envName: effectiveEnvironment ?? null,
        runtimeVars: new Map(runtimeVars),
        varWrites: postVarWrites,
        log: (line) => pendingLines.push(line),
        clear: clearConsole,
        reqDraft,
        response,
      });
      const outcome = await scriptRunnerRef.current.run(postCode, api);
      if (isStale()) {
        flushLines();
        return;
      }
      persistVarWrites(postVarWrites);
      if (!outcome.ok) {
        pendingLines.push(`[post] error: ${outcome.error}`);
      }
      flushLines();
    }
    setState({ status: "success", response });
  };

  const cancelRequest = (id: string) => {
    if (responseStates.get(id)?.status !== "sending") {
      return;
    }
    // Bump the generation so the in-flight send's resolve is ignored, drop the
    // pane back to idle now, and ask the native side to abort the connection.
    sendGeneration.current.set(id, (sendGeneration.current.get(id) ?? 0) + 1);
    const requestId = inFlightRequestId.current.get(id);
    inFlightRequestId.current.delete(id);
    setResponseStates((current) => new Map(current).set(id, { status: "idle" }));
    if (requestId) {
      void httpClientRef.current.cancel(requestId);
    }
  };

  const resolveActiveWire = (): HttpRequest | null => {
    if (activeRequestId === null) {
      return null;
    }
    const node = requestsById.get(activeRequestId);
    if (!node) {
      return null;
    }
    const effective = resolveConfig(tree, activeRequestId, {
      environment: effectiveEnvironment ?? undefined,
    });
    const foldedEnv = resolveProcessEnv(tree, activeRequestId, processEnv);
    return buildHttpRequest(node, effective, foldedEnv);
  };

  const openCodeGen = () => {
    if (resolveActiveWire() === null) {
      return;
    }
    setIsCodeGenOpen(true);
  };
  const closeCodeGen = () => setIsCodeGenOpen(false);

  return { sendRequest, cancelRequest, resolveActiveWire, openCodeGen, closeCodeGen };
}
