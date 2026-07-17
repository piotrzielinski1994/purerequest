import type { RequestNode } from "@/lib/workspace/model";
import type {
  BodyMode,
  ConfigScope,
  HttpMethod,
  HttpVersion,
  KeyValue,
} from "@/lib/workspace/model";
import { extractPathParams } from "@/lib/http/path-params";
import { syncParamsFromUrl, syncUrlFromParams } from "@/lib/http/query-sync";
import { insertNode } from "@/lib/workspace/tree-edit";
import { updateRequest, type RequestPatch } from "@/lib/workspace/update-request";
import {
  indexRequests,
  type RequestOverride,
  type WorkspaceInternals,
} from "@/components/workspace/workspace-context/types";
import type { PersistApi } from "@/components/workspace/workspace-context/persist";

export type RequestEditsApi = {
  mergeOverride: (id: string, patch: RequestOverride) => void;
  setRequestBody: (id: string, json: string) => void;
  setRequestBodyMode: (id: string, active: BodyMode) => void;
  setRequestForm: (id: string, rows: KeyValue[]) => void;
  setRequestGraphqlQuery: (id: string, query: string) => void;
  setRequestGraphqlVariables: (id: string, variables: string) => void;
  setRequestUrl: (id: string, url: string) => void;
  setRequestMethod: (id: string, method: HttpMethod) => void;
  setRequestHttpVersion: (id: string, httpVersion: HttpVersion) => void;
  setRequestPathParams: (id: string, path: KeyValue[]) => void;
  setRequestQueryParams: (id: string, query: KeyValue[]) => void;
  setRequestConfig: (id: string, config: ConfigScope) => void;
  saveActiveRequest: () => boolean;
  saveRequestNode: (id: string, patch: RequestPatch) => void;
  saveActive: () => void;
};

export function createRequestEdits(
  internals: WorkspaceInternals,
  persistTree: PersistApi["persistTree"],
): RequestEditsApi {
  const {
    tree,
    requestsById,
    requestOverrides,
    draftRequests,
    dirtyRequestIds,
    activeRequestId,
    activeEditor,
    autoNameIds,
    showToastRef,
    setRequestOverrides,
    setDraftRequests,
    setExpandedFolderIds,
  } = internals;

  const mergeOverride = (id: string, patch: RequestOverride) => {
    setRequestOverrides((current) => {
      const next = new Map(current);
      next.set(id, { ...current.get(id), ...patch });
      return next;
    });
  };

  // Body edits patch one slot of the request's `body` object, keeping the other
  // types intact (so switching mode never discards a payload). `mode` (active)
  // selects which type is sent; json edits the raw text; form/multipart rows go
  // into the slot named by the current active mode.
  const setRequestBody = (id: string, json: string) => {
    const node = requestsById.get(id);
    if (!node) {
      return;
    }
    mergeOverride(id, {
      body: { ...node.body, types: { ...node.body.types, json } },
    });
  };
  const setRequestBodyMode = (id: string, active: BodyMode) => {
    const node = requestsById.get(id);
    if (!node) {
      return;
    }
    mergeOverride(id, { body: { ...node.body, active } });
  };
  const setRequestForm = (id: string, rows: KeyValue[]) => {
    const node = requestsById.get(id);
    if (!node || (node.body.active !== "form" && node.body.active !== "multipart")) {
      return;
    }
    mergeOverride(id, {
      body: {
        ...node.body,
        types: { ...node.body.types, [node.body.active]: rows },
      },
    });
  };
  const setRequestGraphqlQuery = (id: string, query: string) => {
    const node = requestsById.get(id);
    if (!node) {
      return;
    }
    mergeOverride(id, {
      body: {
        ...node.body,
        types: {
          ...node.body.types,
          graphql: { ...node.body.types.graphql, query },
        },
      },
    });
  };
  const setRequestGraphqlVariables = (id: string, variables: string) => {
    const node = requestsById.get(id);
    if (!node) {
      return;
    }
    mergeOverride(id, {
      body: {
        ...node.body,
        types: {
          ...node.body.types,
          graphql: { ...node.body.types.graphql, variables },
        },
      },
    });
  };
  // Path slot after a URL edit: drop a `:name` value only when its token LEFT the
  // URL (grid-only params are kept). Returns undefined when nothing changed, so a
  // no-op edit stays non-dirty.
  const prunePathAfterUrl = (
    node: RequestNode,
    nextUrl: string,
  ): KeyValue[] | undefined => {
    const current = node.params.path;
    if (current.length === 0) {
      return undefined;
    }
    const removed = new Set(
      extractPathParams(node.url).filter(
        (name) => !extractPathParams(nextUrl).includes(name),
      ),
    );
    if (removed.size === 0) {
      return undefined;
    }
    return current.filter((row) => !removed.has(row.key));
  };
  // Query slot after a URL edit: mirror the URL `?query` into the grid rows - a
  // typed `?key=value` adds/re-enables a row, a key removed from the URL disables
  // its row (value kept). Returns undefined when the rows didn't change.
  const syncQueryAfterUrl = (
    node: RequestNode,
    nextUrl: string,
  ): KeyValue[] | undefined => {
    const current = node.params.query;
    const next = syncParamsFromUrl(node.url, nextUrl, current);
    if (JSON.stringify(next) === JSON.stringify(current)) {
      return undefined;
    }
    return next;
  };
  // Build the `params` patch for a URL edit: path pruning + query sync folded into
  // one params object (so neither clobbers the other). Undefined when neither slot
  // changed, keeping a path-literal-only URL edit out of the dirty set.
  const paramsPatchForUrl = (id: string, nextUrl: string): RequestOverride => {
    const node = requestsById.get(id);
    if (!node) {
      return {};
    }
    const path = prunePathAfterUrl(node, nextUrl);
    const query = syncQueryAfterUrl(node, nextUrl);
    if (path === undefined && query === undefined) {
      return {};
    }
    return {
      params: {
        path: path ?? node.params.path,
        query: query ?? node.params.query,
      },
    };
  };
  const setRequestUrl = (id: string, url: string) => {
    const params = paramsPatchForUrl(id, url);
    // A freshly-created request's name tracks the URL verbatim until the user
    // names it; an empty URL falls back to the request's unique untitled name
    // so clearing the field doesn't blank the label.
    const fallback = autoNameIds.current.get(id);
    if (fallback !== undefined) {
      mergeOverride(id, {
        url,
        name: url.trim() || fallback,
        ...params,
      });
      return;
    }
    mergeOverride(id, { url, ...params });
  };
  const setRequestMethod = (id: string, method: HttpMethod) =>
    mergeOverride(id, { method });
  const setRequestHttpVersion = (id: string, httpVersion: HttpVersion) =>
    mergeOverride(id, { httpVersion });
  const setRequestPathParams = (id: string, path: KeyValue[]) => {
    const node = requestsById.get(id);
    if (!node) {
      return;
    }
    mergeOverride(id, { params: { ...node.params, path } });
  };
  // The Query grid edits `params.query` AND mirrors the enabled rows back into the
  // URL `?query` (path + `:name` tokens preserved), so toggling/editing a row
  // updates the address bar live (the reverse of syncQueryAfterUrl).
  const setRequestQueryParams = (id: string, query: KeyValue[]) => {
    const node = requestsById.get(id);
    if (!node) {
      return;
    }
    mergeOverride(id, {
      params: { ...node.params, query },
      url: syncUrlFromParams(node.url, query),
    });
  };
  const setRequestConfig = (id: string, config: ConfigScope) =>
    mergeOverride(id, { config });

  const saveActiveRequest = (): boolean => {
    if (activeRequestId === null) {
      return false;
    }
    const id = activeRequestId;
    const draft = draftRequests.get(id);
    // A draft promotes to the tree on save: fold any edits onto the pristine
    // draft request, insert at the remembered placement, and drop the draft +
    // override. A draft is inherently unsaved (never on disk), so it always
    // promotes on save - even a RESTORED draft whose edits are already baked
    // into draft.request (no live override, so not "dirty").
    if (draft) {
      const patch = requestOverrides.get(id) as RequestPatch | undefined;
      const node: RequestNode = { ...draft.request, ...(patch ?? {}) };
      autoNameIds.current.delete(id);
      setDraftRequests((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      setRequestOverrides((current) => {
        if (!current.has(id)) {
          return current;
        }
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      setExpandedFolderIds((current) =>
        draft.placement.parentId !== null
          ? new Set(current).add(draft.placement.parentId)
          : current,
      );
      persistTree(
        insertNode(tree, draft.placement.parentId, draft.placement.index, node),
        "create",
      );
      return true;
    }
    if (!dirtyRequestIds.has(id)) {
      return false;
    }
    const patch = requestOverrides.get(id) as RequestPatch | undefined;
    if (!patch) {
      return false;
    }
    // Saving establishes the name - the URL no longer drives it.
    autoNameIds.current.delete(id);
    setRequestOverrides((current) => {
      if (!current.has(id)) {
        return current;
      }
      const nextOverrides = new Map(current);
      nextOverrides.delete(id);
      return nextOverrides;
    });
    persistTree(updateRequest(tree, id, patch), "edits");
    return true;
  };

  const saveRequestNode = (id: string, patch: RequestPatch) => {
    const draft = draftRequests.get(id);
    // A draft's full-request save promotes it into the tree at its placement.
    if (draft) {
      const node: RequestNode = { ...draft.request, ...patch };
      autoNameIds.current.delete(id);
      setDraftRequests((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      setRequestOverrides((current) => {
        if (!current.has(id)) {
          return current;
        }
        const nextOverrides = new Map(current);
        nextOverrides.delete(id);
        return nextOverrides;
      });
      setExpandedFolderIds((current) =>
        draft.placement.parentId !== null
          ? new Set(current).add(draft.placement.parentId)
          : current,
      );
      persistTree(
        insertNode(tree, draft.placement.parentId, draft.placement.index, node),
        "create",
      );
      return;
    }
    // Full-request Settings save - only persists a request that exists on disk.
    if (!indexRequests(tree).has(id)) {
      return;
    }
    autoNameIds.current.delete(id);
    // Drop any url/method/body override so the URL bar / Body tab re-sync to
    // the just-saved values instead of masking them.
    setRequestOverrides((current) => {
      if (!current.has(id)) {
        return current;
      }
      const nextOverrides = new Map(current);
      nextOverrides.delete(id);
      return nextOverrides;
    });
    persistTree(updateRequest(tree, id, patch), "edits");
  };

  // A DIRTY editor persists + toasts via its own save(); a dirty request persists
  // + toasts via persistTree. Only when NEITHER had changes (clean state) do we
  // toast here - so Cmd+S always confirms without double-toasting AND a clean save
  // never pays the tree-write round-trip (the editor's save() would persist
  // unconditionally, which lagged the toast on the Settings tab).
  const saveActive = () => {
    if (activeEditor) {
      if (activeEditor.isDirty) {
        activeEditor.save();
        return;
      }
      showToastRef.current("Saved");
      return;
    }
    if (saveActiveRequest()) {
      return;
    }
    showToastRef.current("Saved");
  };

  return {
    mergeOverride,
    setRequestBody,
    setRequestBodyMode,
    setRequestForm,
    setRequestGraphqlQuery,
    setRequestGraphqlVariables,
    setRequestUrl,
    setRequestMethod,
    setRequestHttpVersion,
    setRequestPathParams,
    setRequestQueryParams,
    setRequestConfig,
    saveActiveRequest,
    saveRequestNode,
    saveActive,
  };
}
