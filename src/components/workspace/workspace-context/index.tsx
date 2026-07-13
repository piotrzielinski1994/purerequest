import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import {
  accentColorFor,
  environmentNamesForScope,
  resolveConfig,
  resolveProcessEnv,
  resolveProcessEnvProvenance,
} from "@/lib/workspace/resolve";
import {
  moveNode as applyMove,
  moveNodes as applyMoveNodes,
  type MoveTarget,
} from "@/lib/workspace/move";
import type { DraftTab } from "@/lib/settings/settings";
import {
  collectRequestIds,
  containsId,
  duplicateRequest as applyDuplicate,
  insertNode,
  removeNode,
  renameNode,
} from "@/lib/workspace/tree-edit";
import { locateNode } from "@/lib/workspace/tree-locate";
import { SETTINGS_TAB_ID } from "@/components/workspace/pane-tabs";
import { untitledName } from "@/lib/workspace/request-name";
import type { WriteResult } from "@/lib/workspace/fs";
import { buildHttpRequest } from "@/lib/http/build-request";
import { extractPathParams } from "@/lib/http/path-params";
import { syncParamsFromUrl, syncUrlFromParams } from "@/lib/http/query-sync";
import { createFakeHttpClient } from "@/lib/http/fake-client";
import type {
  HttpClient,
  HttpRequest,
  ResponseState,
} from "@/lib/http/model";
import type { ScriptRunner } from "@/lib/scripts/model";
import { createFakeScriptRunner } from "@/lib/scripts/fake-runner";
import {
  applyPreToEffective,
  buildScriptApi,
  type ReqDraft,
  type VarWrite,
} from "@/lib/scripts/script-context";
import { resolveVarWriteTarget, setNodeVar } from "@/lib/scripts/var-write";
import type {
  BodyMode,
  ConfigScope,
  HttpMethod,
  KeyValue,
} from "@/lib/workspace/model";
import {
  mergeDotenv,
  parseDotenv,
  setDotenvValue,
} from "@/lib/workspace/environment";
import { updateFolderDotenv } from "@/lib/workspace/update-folder-dotenv";
import {
  updateRequest,
  type RequestPatch,
} from "@/lib/workspace/update-request";
import { findNode } from "@/lib/workspace/tree-locate";
import type { TokenTarget } from "@/components/workspace/url-token";
import { useToast } from "@/components/ui/toast";
import { parseCurl, type CurlParseResult } from "@/lib/curl/parse-curl";
import {
  brunoToTree,
  collectDotenv,
  type BrunoFileMap,
} from "@/lib/bruno/bruno-to-tree";
import { postmanToTree, type PostmanFileMap } from "@/lib/postman/postman-to-tree";
import { openapiToTree } from "@/lib/openapi/openapi-to-tree";
import {
  indexRequests,
  isOverrideFieldDirty,
  type ActiveEditor,
  type EditTarget,
  type ParamsReveal,
  type PendingClose,
  type PendingDelete,
  type RequestOverride,
  type RequestTab,
  type ResponseTab,
  type RevealTarget,
  type WorkspaceContextValue,
} from "@/components/workspace/workspace-context/types";

import type { WorkspaceInternals } from "@/components/workspace/workspace-context/types";
import { createPersist } from "@/components/workspace/workspace-context/persist";
import { createSelection } from "@/components/workspace/workspace-context/selection";
import { createConfigSaves } from "@/components/workspace/workspace-context/config-saves";

export type {
  ActiveEditor,
  EditTarget,
  EditorScope,
  ParamsReveal,
  PendingClose,
  PendingDelete,
  RequestTab,
  ResponseTab,
  RevealTarget,
  SelectMode,
  WorkspaceContextValue,
} from "@/components/workspace/workspace-context/types";


const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

type WorkspaceProviderProps = {
  children: ReactNode;
  tree?: TreeNode[];
  consoleLines?: string[];
  initialExpandedIds?: string[];
  initialActiveRequestId?: string;
  initialOpenRequestIds?: string[];
  onTabsChange?: (
    openRequestIds: string[],
    activeRequestId: string | null,
  ) => void;
  // Restored unsaved "new request" draft tabs + a callback to persist changes to
  // them (both live in app settings, not the workspace on disk).
  initialDraftTabs?: DraftTab[];
  onDraftTabsChange?: (drafts: DraftTab[]) => void;
  onTreeChange?: (tree: TreeNode[]) => Promise<WriteResult>;
  httpClient?: HttpClient;
  scriptRunner?: ScriptRunner;
  activeEnvironment?: string;
  processEnv?: Record<string, string>;
  envText?: string;
  onActiveEnvironmentChange?: (name: string | null) => void;
  onEnvChange?: (text: string) => void;
};

export function WorkspaceProvider({
  children,
  tree: initialTree = [],
  consoleLines: initialConsoleLines = [],
  initialExpandedIds = [],
  initialActiveRequestId,
  initialOpenRequestIds,
  initialDraftTabs,
  onTabsChange,
  onDraftTabsChange,
  onTreeChange,
  httpClient,
  scriptRunner,
  activeEnvironment: initialActiveEnvironment,
  processEnv: initialProcessEnv = {},
  envText: initialEnvText = "",
  onActiveEnvironmentChange,
  onEnvChange,
}: WorkspaceProviderProps) {
  const [tree, setTree] = useState<TreeNode[]>(initialTree);
  const [activeEnvironment, setActiveEnvironmentState] = useState<
    string | null
  >(initialActiveEnvironment ?? null);
  const [envText, setEnvText] = useState(initialEnvText);
  const [processEnv, setProcessEnv] = useState(() =>
    Object.keys(initialProcessEnv).length > 0
      ? initialProcessEnv
      : parseDotenv(initialEnvText),
  );
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  // Whether the open config/.env editor is the focused view. Mirrors the
  // Settings open-vs-active split: activating a request/settings tab deactivates
  // the editor but KEEPS its tab open (tabs never self-close); only an explicit
  // close clears `editTarget`.
  const [isEditorActive, setIsEditorActive] = useState(false);
  const [pendingClose, setPendingClose] = useState<PendingClose>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [isCurlImportOpen, setIsCurlImportOpen] = useState(false);
  const [isCodeGenOpen, setIsCodeGenOpen] = useState(false);
  const [revealTarget, setRevealTarget] = useState<RevealTarget>(null);
  // The tab that was active right before Settings was opened, so Esc
  // (close-settings) can return to it rather than an arbitrary neighbour.
  const preSettingsActiveId = useRef<string | null>(null);
  const revealNonce = useRef(0);
  // "Go to source" from a `:name` path token opens the Params tab's Path sub-tab;
  // the nonce re-fires the same jump (consumer keys its render on identity).
  const [paramsReveal, setParamsReveal] = useState<ParamsReveal>(null);
  const paramsRevealNonce = useRef(0);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [consoleLines, setConsoleLines] =
    useState<string[]>(initialConsoleLines);
  const [requestOverrides, setRequestOverrides] = useState<
    Map<string, RequestOverride>
  >(() => new Map());
  // Session-only "new request" tabs: a fresh request lives here (NOT in the tree,
  // NOT on disk, NOT in the sidebar) as just an open tab until it is edited AND
  // saved - only then is it promoted into the tree and written to disk. Each draft
  // remembers where it should land on promotion. Clicking "+" must never write an
  // empty request to disk; that only happens on an explicit save of an edited draft.
  const [draftRequests, setDraftRequests] = useState<
    Map<string, { request: RequestNode; placement: MoveTarget }>
  >(
    () =>
      new Map(
        (initialDraftTabs ?? []).map((draft) => [
          draft.id,
          { request: draft.request, placement: draft.placement },
        ]),
      ),
  );
  const [responseStates, setResponseStates] = useState<
    Map<string, ResponseState>
  >(() => new Map());
  const nodeCounter = useRef(0);
  // Ids of freshly-created requests whose name auto-tracks the URL until named
  // (manual rename) or saved, mapped to the per-request fallback name (its
  // unique "untitled") used when the URL derives no path.
  const autoNameIds = useRef<Map<string, string>>(new Map());
  const [focusUrlNonce, setFocusUrlNonce] = useState(0);
  const [activeEditor, setActiveEditor] = useState<ActiveEditor | null>(null);
  const registerActiveEditor = useCallback(
    (editor: ActiveEditor | null) => setActiveEditor(editor),
    [],
  );
  const { show: showToast } = useToast();
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);
  const httpClientRef = useRef<HttpClient>(
    httpClient ?? createFakeHttpClient(),
  );
  useEffect(() => {
    if (httpClient) {
      httpClientRef.current = httpClient;
    }
  }, [httpClient]);
  const scriptRunnerRef = useRef<ScriptRunner>(
    scriptRunner ?? createFakeScriptRunner(),
  );
  useEffect(() => {
    if (scriptRunner) {
      scriptRunnerRef.current = scriptRunner;
    }
  }, [scriptRunner]);
  // Per-request send generation: bumped on each send so a stale result (one
  // resolving after a cancel + re-send) can be ignored. The in-flight wire id
  // lets a Stop cancel exactly the send it belongs to.
  const sendGeneration = useRef<Map<string, number>>(new Map());
  const inFlightRequestId = useRef<Map<string, string>>(new Map());

  const requestsById = useMemo(() => {
    const byId = indexRequests(tree);
    // Session drafts resolve like on-disk requests for the open tab / panes.
    draftRequests.forEach(({ request }, id) => byId.set(id, request));
    requestOverrides.forEach((override, id) => {
      const base = byId.get(id);
      if (base) {
        byId.set(id, { ...base, ...override });
      }
    });
    return byId;
  }, [tree, draftRequests, requestOverrides]);

  const dirtyRequestIds = useMemo(() => {
    const treeRequests = indexRequests(tree);
    const dirty = new Set<string>();
    requestOverrides.forEach((override, id) => {
      // A draft compares against its own pristine request; an on-disk request
      // against its tree node.
      const base = draftRequests.get(id)?.request ?? treeRequests.get(id);
      if (!base) {
        return;
      }
      const isDirty = (Object.keys(override) as (keyof RequestOverride)[]).some(
        (field) => isOverrideFieldDirty(field, override[field], base[field]),
      );
      if (isDirty) {
        dirty.add(id);
      }
    });
    // A mounted, dirty request-config editor makes its request dirty too.
    if (
      activeEditor?.isDirty &&
      activeEditor.scope.kind === "config" &&
      requestsById.has(activeEditor.scope.id)
    ) {
      dirty.add(activeEditor.scope.id);
    }
    return dirty;
  }, [tree, draftRequests, requestOverrides, activeEditor, requestsById]);

  // The active editor (folder config pane / .env) is dirty AND not just a
  // request-config editor already reflected in dirtyRequestIds.
  const editorDirty = activeEditor?.isDirty ?? false;

  // A popup "Save" can persist only when there is no active editor blocking it
  // with unsaveable (e.g. invalid-JSON) content. No editor mounted -> saving the
  // request override is always fine.
  const popupCanSave = activeEditor === null || activeEditor.canSave;

  const restoredOpenIds = useMemo(() => {
    const known = indexRequests(tree);
    const draftIds = new Set((initialDraftTabs ?? []).map((draft) => draft.id));
    // Restore a persisted open tab if it is either an on-disk request OR a
    // restored draft (drafts live in settings, not the tree).
    const restored = (initialOpenRequestIds ?? []).filter(
      (id) => known.has(id) || draftIds.has(id),
    );
    if (restored.length > 0) {
      return restored;
    }
    return initialActiveRequestId ? [initialActiveRequestId] : [];
  }, [tree, initialOpenRequestIds, initialActiveRequestId, initialDraftTabs]);

  const [expandedFolderIds, setExpandedFolderIds] = useState(
    () => new Set(initialExpandedIds),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialActiveRequestId ?? restoredOpenIds[0] ?? null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const initial = initialActiveRequestId ?? restoredOpenIds[0] ?? null;
    return new Set(initial !== null ? [initial] : []);
  });
  // The shift-click anchor: the row a range extends from. Set by a replace/toggle
  // click, reused by a following range click.
  const [selectAnchorId, setSelectAnchorId] = useState<string | null>(null);
  const [openRequestIds, setOpenRequestIds] =
    useState<string[]>(restoredOpenIds);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(
    initialActiveRequestId ?? restoredOpenIds[0] ?? null,
  );
  const [activeRequestTab, setActiveRequestTab] =
    useState<RequestTab>("params");
  const [activeResponseTab, setActiveResponseTab] =
    useState<ResponseTab>("response");
  // Settings is a real tab: it lives in `openRequestIds` under a synthetic id, so
  // it drags/reorders/closes like any request. "open" = present in the list,
  // "active" = the active tab AND no editor is active (the editor takes content
  // precedence even when the settings id is still the active tab id).
  const isSettingsOpen = openRequestIds.includes(SETTINGS_TAB_ID);
  const isSettingsActive = !isEditorActive && activeRequestId === SETTINGS_TAB_ID;

  // The node whose env scope drives the border + the sidebar env list: the open
  // folder config editor's folder while it's the active editor, else the active
  // request, else null (Settings/no focus).
  const activeScopeId = useMemo<string | null>(() => {
    if (
      isEditorActive &&
      editTarget?.kind === "config" &&
      findNode(tree, editTarget.id)?.kind === "folder"
    ) {
      return editTarget.id;
    }
    if (!isEditorActive && !isSettingsActive && activeRequestId !== null) {
      return activeRequestId;
    }
    return null;
  }, [tree, editTarget, isEditorActive, isSettingsActive, activeRequestId]);

  const onTabsChangeRef = useRef(onTabsChange);
  useEffect(() => {
    onTabsChangeRef.current = onTabsChange;
  }, [onTabsChange]);
  const onDraftTabsChangeRef = useRef(onDraftTabsChange);
  useEffect(() => {
    onDraftTabsChangeRef.current = onDraftTabsChange;
  }, [onDraftTabsChange]);
  const onTreeChangeRef = useRef(onTreeChange);
  useEffect(() => {
    onTreeChangeRef.current = onTreeChange;
  }, [onTreeChange]);
  const onActiveEnvironmentChangeRef = useRef(onActiveEnvironmentChange);
  useEffect(() => {
    onActiveEnvironmentChangeRef.current = onActiveEnvironmentChange;
  }, [onActiveEnvironmentChange]);
  const onEnvChangeRef = useRef(onEnvChange);
  useEffect(() => {
    onEnvChangeRef.current = onEnvChange;
  }, [onEnvChange]);

  // Env names in scope for the focused node (combobox options).
  const scopedEnvNames = useMemo(
    () => environmentNamesForScope(tree, activeScopeId),
    [tree, activeScopeId],
  );
  // Clamp the active env to the focused node's scope: if its chain doesn't define
  // the selected env (switched to a folder with different/no envs), it reads as No
  // Environment so the border clears and the combobox shows no stale selection.
  // Derived in render (not an effect) - the raw selection is kept, so returning to
  // a tab that defines it surfaces it again (sticky), with no setState cascade.
  const effectiveEnvironment =
    activeEnvironment !== null && scopedEnvNames.includes(activeEnvironment)
      ? activeEnvironment
      : null;

  const isFirstTabsRender = useRef(true);
  useEffect(() => {
    if (isFirstTabsRender.current) {
      isFirstTabsRender.current = false;
      return;
    }
    // A freshly-created (promoted) node carries a synthetic in-session id
    // (`new-<n>`) that is replaced by a path-based id on the next disk reload, so
    // it can't match a persisted open-tab id - drop it. EXCEPT an id that is still
    // a draft: drafts are restored from settings by that same id, so it must stay.
    const persistableIds = openRequestIds.filter(
      (id) =>
        id !== SETTINGS_TAB_ID &&
        (!id.startsWith("new-") || draftRequests.has(id)),
    );
    onTabsChangeRef.current?.(
      persistableIds,
      activeRequestId !== null && persistableIds.includes(activeRequestId)
        ? activeRequestId
        : null,
    );
  }, [openRequestIds, activeRequestId, draftRequests]);

  // Persist draft tabs to app settings whenever they change, so an unsaved "new
  // request" survives an app restart. Skip the first render (it would just write
  // the restored value straight back).
  const isFirstDraftsRender = useRef(true);
  useEffect(() => {
    if (isFirstDraftsRender.current) {
      isFirstDraftsRender.current = false;
      return;
    }
    // Persist the draft with its live edits FOLDED IN: a draft's unsaved edits live
    // in requestOverrides, so the pristine draft.request alone would restore a
    // blank request (URL/method/body lost). Merge the override so a restart keeps
    // exactly what is on screen.
    onDraftTabsChangeRef.current?.(
      [...draftRequests.entries()].map(([id, { request, placement }]) => ({
        id,
        request: { ...request, ...(requestOverrides.get(id) ?? {}) },
        placement,
      })),
    );
  }, [draftRequests, requestOverrides]);

  const isWorkspaceWritable = onTreeChange !== undefined;

  const value = useMemo<WorkspaceContextValue>(() => {
    // The shared bag threaded into each concern factory. Built fresh per memo run
    // (same cadence as the inline closures had), so recompute timing is unchanged.
    const internals: WorkspaceInternals = {
      tree,
      setTree,
      activeEnvironment,
      setActiveEnvironmentState,
      envText,
      setEnvText,
      processEnv,
      setProcessEnv,
      editTarget,
      setEditTarget,
      isEditorActive,
      setIsEditorActive,
      pendingClose,
      setPendingClose,
      pendingDelete,
      setPendingDelete,
      isCurlImportOpen,
      setIsCurlImportOpen,
      isCodeGenOpen,
      setIsCodeGenOpen,
      revealTarget,
      setRevealTarget,
      paramsReveal,
      setParamsReveal,
      renamingNodeId,
      setRenamingNodeId,
      consoleLines,
      setConsoleLines,
      requestOverrides,
      setRequestOverrides,
      draftRequests,
      setDraftRequests,
      responseStates,
      setResponseStates,
      focusUrlNonce,
      setFocusUrlNonce,
      activeEditor,
      setActiveEditor,
      expandedFolderIds,
      setExpandedFolderIds,
      selectedNodeId,
      setSelectedNodeId,
      selectedIds,
      setSelectedIds,
      selectAnchorId,
      setSelectAnchorId,
      openRequestIds,
      setOpenRequestIds,
      activeRequestId,
      setActiveRequestId,
      activeRequestTab,
      setActiveRequestTab,
      activeResponseTab,
      setActiveResponseTab,
      preSettingsActiveId,
      revealNonce,
      paramsRevealNonce,
      nodeCounter,
      autoNameIds,
      showToastRef,
      httpClientRef,
      scriptRunnerRef,
      sendGeneration,
      inFlightRequestId,
      onTabsChangeRef,
      onDraftTabsChangeRef,
      onTreeChangeRef,
      onActiveEnvironmentChangeRef,
      onEnvChangeRef,
      requestsById,
      dirtyRequestIds,
      editorDirty,
      popupCanSave,
      isWorkspaceWritable,
      activeScopeId,
      scopedEnvNames,
      effectiveEnvironment,
      isSettingsOpen,
      isSettingsActive,
    };

    const { persistTree, saveEnv } = createPersist(internals);
    const {
      selectSingle,
      focusNode,
      selectNode,
      selectInTree,
      clearSelection,
      toggleFolder,
    } = createSelection(internals);

    const closeRequest = (id: string) => {
      setOpenRequestIds((current) => {
        const index = current.indexOf(id);
        if (index === -1) {
          return current;
        }
        const next = current.filter((openId) => openId !== id);
        setActiveRequestId((active) => {
          if (active !== id) {
            return active;
          }
          return next[Math.min(index, next.length - 1)] ?? null;
        });
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
      // Closing a draft tab discards it entirely (never written to disk).
      setDraftRequests((current) => {
        if (!current.has(id)) {
          return current;
        }
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      setResponseStates((current) => {
        if (!current.has(id)) {
          return current;
        }
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    };

    const closeAllRequests = () => {
      setOpenRequestIds([]);
      setActiveRequestId(null);
      setRequestOverrides(new Map());
      setDraftRequests(new Map());
      setResponseStates(new Map());
    };

    const closeOthers = (id: string) => {
      setOpenRequestIds((current) => (current.includes(id) ? [id] : current));
      setActiveRequestId(id);
      setIsEditorActive(false);
      setRequestOverrides((current) => {
        const kept = current.get(id);
        return kept === undefined ? new Map() : new Map([[id, kept]]);
      });
      setDraftRequests((current) => {
        const kept = current.get(id);
        return kept === undefined ? new Map() : new Map([[id, kept]]);
      });
      setResponseStates((current) => {
        const kept = current.get(id);
        return kept === undefined ? new Map() : new Map([[id, kept]]);
      });
    };

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
    // Drop a stored path-param value only when its `:name` LEFT the URL (was in the
    // old URL, gone from the new one), so removing `:id` from the address bar prunes
    // it - but a grid-only param (defined in the Path tab, never in the URL) is kept.
    // Returns the patch only when it changes something (a no-op edit stays non-dirty).
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
          persistTree(next.tree, "script");
        }
        if (next.envText !== envText) {
          saveEnv(next.envText);
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
      setResponseStates((current) =>
        new Map(current).set(id, { status: "idle" }),
      );
      if (requestId) {
        void httpClientRef.current.cancel(requestId);
      }
    };

    // Placement for a new node: an explicit target wins; else inside a selected
    // folder (appended), else as the next sibling of a selected request, else
    // at workspace root (appended).
    const derivePlacement = (target?: MoveTarget): MoveTarget => {
      if (target) {
        return target;
      }
      const selected =
        selectedNodeId !== null ? findNode(tree, selectedNodeId) : null;
      if (selected?.kind === "folder") {
        return { parentId: selected.id, index: selected.children.length };
      }
      if (selected?.kind === "request") {
        const location = locateNode(tree, selected.id);
        if (location) {
          return { parentId: location.parentId, index: location.index + 1 };
        }
      }
      return { parentId: null, index: tree.length };
    };

    // New request inserts a real node at the placement, persists immediately,
    // expands the parent, opens + activates + selects its tab, and FOCUSES the
    // URL input (not inline rename) - the name then auto-tracks the URL until the
    // user names it or saves. No draft/save step.
    // Insert a request node at the derived placement, persist immediately, open
    // + activate + select its tab. `autoName` keeps the name tracking the URL and
    // focuses the URL input (the New-request flow); imports pass autoName=false
    // since they arrive fully formed.
    // Create a request node and open its tab. `mode: "draft"` keeps it in memory
    // only (a "+"/new-request tab that is not written to disk until edited AND
    // saved); `mode: "persist"` writes it to the tree immediately (curl import,
    // which arrives fully formed). `autoName` keeps the name tracking the URL and
    // focuses the URL input (the new-request flow).
    const createRequestNode = (
      partial: Pick<RequestNode, "name" | "method" | "url"> &
        Partial<RequestNode>,
      options: {
        target?: MoveTarget;
        autoName?: boolean;
        mode: "draft" | "persist";
      },
    ) => {
      nodeCounter.current += 1;
      const id = `new-${nodeCounter.current}`;
      const request: RequestNode = {
        kind: "request",
        body: emptyBody(),
        params: emptyParams(),
        config: {},
        ...partial,
        id,
      };
      const placement = derivePlacement(options.target);
      if (placement.parentId !== null) {
        setExpandedFolderIds((current) =>
          new Set(current).add(placement.parentId!),
        );
      }
      if (options.autoName) {
        autoNameIds.current.set(id, request.name);
      }
      setIsEditorActive(false);
      setOpenRequestIds((current) => [...current, id]);
      setActiveRequestId(id);
      selectSingle(id);
      setRenamingNodeId(null);
      if (options.autoName) {
        setFocusUrlNonce((nonce) => nonce + 1);
      }
      if (options.mode === "draft") {
        setDraftRequests((current) =>
          new Map(current).set(id, { request, placement }),
        );
        return;
      }
      persistTree(
        insertNode(tree, placement.parentId, placement.index, request),
        "create",
      );
    };

    const newRequest = (target?: MoveTarget) => {
      const existingNames = [...requestsById.values()].map(
        (request) => request.name,
      );
      createRequestNode(
        { name: untitledName(existingNames), method: "GET", url: "" },
        { target, autoName: true, mode: "draft" },
      );
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

    const openCurlImport = () => setIsCurlImportOpen(true);
    const closeCurlImport = () => setIsCurlImportOpen(false);

    const importCurl = (text: string): CurlParseResult => {
      const result = parseCurl(text);
      if (!result.ok) {
        return result;
      }
      const { method, url, headers, body, auth } = result.request;
      createRequestNode({
        name: url.trim() || "Imported Request",
        method,
        url,
        body: {
          active: "json",
          types: {
            json: body ?? "",
            form: [],
            multipart: [],
            graphql: { query: "", variables: "" },
          },
        },
        config: {
          ...(headers.length > 0 ? { headers } : {}),
          ...(auth ? { auth } : {}),
        },
      }, { mode: "persist" });
      setIsCurlImportOpen(false);
      showToastRef.current("Imported request");
      return result;
    };

    const importBruno = (files: BrunoFileMap, name: string) => {
      const [root] = brunoToTree(files, name);
      if (!root || root.kind !== "folder" || root.children.length === 0) {
        return;
      }
      nodeCounter.current += 1;
      const folder = { ...root, id: `new-${nodeCounter.current}` };
      setExpandedFolderIds((current) => new Set(current).add(folder.id));
      setIsEditorActive(false);
      selectSingle(folder.id);
      persistTree(insertNode(tree, null, tree.length, folder), "import");
      showToastRef.current("Imported Bruno collection");
    };

    const importPostman = (files: PostmanFileMap, name: string) => {
      const [root] = postmanToTree(files, name);
      if (!root || root.kind !== "folder" || root.children.length === 0) {
        return;
      }
      nodeCounter.current += 1;
      const folder = { ...root, id: `new-${nodeCounter.current}` };
      setExpandedFolderIds((current) => new Set(current).add(folder.id));
      setIsEditorActive(false);
      selectSingle(folder.id);
      persistTree(insertNode(tree, null, tree.length, folder), "import");
      const collectionEnv = collectDotenv(files);
      if (collectionEnv.trim() !== "") {
        saveEnv(mergeDotenv(envText, collectionEnv));
      }
      showToastRef.current("Imported Postman collection");
    };

    const importOpenapi = (text: string, name: string) => {
      const [root] = openapiToTree(text, name);
      if (!root || root.kind !== "folder" || root.children.length === 0) {
        showToastRef.current("No importable operations in OpenAPI document");
        return;
      }
      nodeCounter.current += 1;
      const folder = { ...root, id: `new-${nodeCounter.current}` };
      setExpandedFolderIds((current) => new Set(current).add(folder.id));
      setIsEditorActive(false);
      selectSingle(folder.id);
      persistTree(insertNode(tree, null, tree.length, folder), "import");
      showToastRef.current("Imported OpenAPI document");
    };

    const { saveNodeConfig, saveFolder, saveFolderConfigDoc, setFolderEnvColor } =
      createConfigSaves(internals, persistTree);

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
          insertNode(
            tree,
            draft.placement.parentId,
            draft.placement.index,
            node,
          ),
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
          insertNode(
            tree,
            draft.placement.parentId,
            draft.placement.index,
            node,
          ),
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

    const beginRename = (id: string) => {
      // Stop the URL from driving the name (the user is naming it now), but keep
      // the last auto-derived name as the rename seed.
      autoNameIds.current.delete(id);
      setRenamingNodeId(id);
    };
    const cancelRename = () => setRenamingNodeId(null);
    const commitRename = (id: string, name: string) => {
      setRenamingNodeId(null);
      autoNameIds.current.delete(id);
      if (name.trim() === "") {
        return;
      }
      // A draft is not on disk: rename it in place on its own request (and clear
      // any name override so the new name shows through). No tree write.
      if (draftRequests.has(id)) {
        setDraftRequests((current) => {
          const entry = current.get(id);
          if (!entry) {
            return current;
          }
          const next = new Map(current);
          next.set(id, {
            ...entry,
            request: { ...entry.request, name },
          });
          return next;
        });
        setRequestOverrides((current) => {
          const existing = current.get(id);
          if (!existing || existing.name === undefined) {
            return current;
          }
          const rest = { ...existing };
          delete rest.name;
          const next = new Map(current);
          next.set(id, rest);
          return next;
        });
        return;
      }
      // Drop any name override so the persisted (renamed) tree value shows through
      // instead of being masked by the auto-name override.
      setRequestOverrides((current) => {
        const existing = current.get(id);
        if (!existing || existing.name === undefined) {
          return current;
        }
        const rest = { ...existing };
        delete rest.name;
        const next = new Map(current);
        next.set(id, rest);
        return next;
      });
      const node = findNode(tree, id);
      if (!node || node.name === name) {
        return;
      }
      persistTree(renameNode(tree, id, name), "rename");
    };

    const newFolder = (target?: MoveTarget) => {
      nodeCounter.current += 1;
      const id = `new-${nodeCounter.current}`;
      const folder: TreeNode = {
        kind: "folder",
        id,
        name: "New Folder",
        config: {},
        children: [],
      };
      const placement = derivePlacement(target);
      if (placement.parentId !== null) {
        setExpandedFolderIds((current) =>
          new Set(current).add(placement.parentId!),
        );
      }
      setIsEditorActive(false);
      selectSingle(id);
      setRenamingNodeId(id);
      persistTree(
        insertNode(tree, placement.parentId, placement.index, folder),
        "create",
      );
    };

    const duplicateRequest = (id: string) => {
      const node = findNode(tree, id);
      if (!node || node.kind !== "request") {
        return;
      }
      nodeCounter.current += 1;
      const newId = `new-${nodeCounter.current}`;
      setOpenRequestIds((current) =>
        current.includes(newId) ? current : [...current, newId],
      );
      setIsEditorActive(false);
      setActiveRequestId(newId);
      selectSingle(newId);
      persistTree(applyDuplicate(tree, id, newId), "duplicate");
    };

    // The delete target set for a clicked row: the whole multi-selection when the
    // clicked node is part of it, else just that node. Reduced to ids that exist
    // and pruned of any id nested under another target (its ancestor's removal
    // already takes it), returned in tree document order.
    const deleteTargetsFor = (id: string): string[] => {
      const base =
        selectedIds.has(id) && selectedIds.size > 1 ? [...selectedIds] : [id];
      const present = base.filter((each) => findNode(tree, each) !== null);
      const roots = present.filter((each) => {
        const ancestorAlsoTarget = present.some((other) => {
          if (other === each) {
            return false;
          }
          const otherNode = findNode(tree, other);
          return otherNode !== null && containsId(otherNode, each);
        });
        return !ancestorAlsoTarget;
      });
      const rootSet = new Set(roots);
      const ordered: string[] = [];
      const walk = (nodes: TreeNode[]) => {
        nodes.forEach((node) => {
          if (rootSet.has(node.id)) {
            ordered.push(node.id);
            return;
          }
          if (node.kind === "folder") {
            walk(node.children);
          }
        });
      };
      walk(tree);
      return ordered;
    };

    const deleteNodes = (ids: string[]) => {
      const nodes = ids
        .map((id) => findNode(tree, id))
        .filter((node): node is TreeNode => node !== null);
      if (nodes.length === 0) {
        return;
      }
      if (ids.includes(renamingNodeId ?? "")) {
        setRenamingNodeId(null);
      }
      nodes
        .flatMap((node) => collectRequestIds(node))
        .forEach((requestId) => closeRequest(requestId));
      const next = ids.reduce((acc, id) => removeNode(acc, id), tree);
      persistTree(next, "delete");
    };

    const requestDeleteNode = (id: string) => {
      const ids = deleteTargetsFor(id);
      if (ids.length === 0) {
        return;
      }
      // A dialog guards a destructive delete: more than one target, or a single
      // non-empty folder. A lone request or empty folder deletes immediately.
      const needsConfirm =
        ids.length > 1 ||
        ids.some((each) => {
          const node = findNode(tree, each);
          return node?.kind === "folder" && node.children.length > 0;
        });
      if (needsConfirm) {
        setPendingDelete({ ids });
        return;
      }
      deleteNodes(ids);
    };

    const confirmPendingDelete = () => {
      if (pendingDelete === null) {
        return;
      }
      deleteNodes(pendingDelete.ids);
      setPendingDelete(null);
    };

    const cancelPendingDelete = () => setPendingDelete(null);

    const requestCloseRequest = (id: string) => {
      if (dirtyRequestIds.has(id)) {
        setPendingClose({ kind: "one", id });
        return;
      }
      closeRequest(id);
    };

    const requestCloseAll = () => {
      const hasDirtyOpen = openRequestIds.some((id) => dirtyRequestIds.has(id));
      if (hasDirtyOpen) {
        setPendingClose({ kind: "all" });
        return;
      }
      closeAllRequests();
    };

    const requestCloseOthers = (id: string) => {
      if (!openRequestIds.includes(id) || openRequestIds.length <= 1) {
        return;
      }
      const hasDirtyOther = openRequestIds.some(
        (openId) => openId !== id && dirtyRequestIds.has(openId),
      );
      if (hasDirtyOther) {
        setPendingClose({ kind: "others", id });
        return;
      }
      closeOthers(id);
    };

    const requestCloseEditor = () => {
      if (editorDirty) {
        setPendingClose({ kind: "editor" });
        return;
      }
      setEditTarget(null);
      setIsEditorActive(false);
    };

    const confirmPendingClose = () => {
      if (pendingClose === null) {
        return;
      }
      if (pendingClose.kind === "all") {
        closeAllRequests();
      } else if (pendingClose.kind === "others") {
        closeOthers(pendingClose.id);
      } else if (pendingClose.kind === "editor") {
        setEditTarget(null);
        setIsEditorActive(false);
      } else {
        closeRequest(pendingClose.id);
      }
      setPendingClose(null);
    };

    // Persist everything dirty for the pending close in ONE tree write, then
    // close. Folds the active config/request editor (commitToTree) and the saved
    // requests' url/method/body overrides into a single tree so close-all over
    // several dirty tabs can't clobber. The .env editor (no commitToTree) writes
    // its own text via save(). No-op when the active editor can't be saved.
    const savePendingClose = () => {
      if (pendingClose === null || !popupCanSave) {
        return;
      }
      const editor = activeEditor;
      const treeRequests = indexRequests(tree);
      const overrideIdsToFold =
        pendingClose.kind === "one"
          ? [pendingClose.id]
          : pendingClose.kind === "all"
            ? openRequestIds
            : pendingClose.kind === "others"
              ? openRequestIds.filter((id) => id !== pendingClose.id)
              : [];

      let nextTree = tree;
      const foldedOverrideIds: string[] = [];
      const promotedDraftIds: string[] = [];
      overrideIdsToFold.forEach((id) => {
        const draft = draftRequests.get(id);
        if (draft) {
          // A dirty draft being closed-with-save is promoted into the tree.
          const patch = requestOverrides.get(id) as RequestPatch | undefined;
          const node: RequestNode = { ...draft.request, ...(patch ?? {}) };
          nextTree = insertNode(
            nextTree,
            draft.placement.parentId,
            draft.placement.index,
            node,
          );
          promotedDraftIds.push(id);
          if (patch) {
            foldedOverrideIds.push(id);
          }
          return;
        }
        if (!treeRequests.has(id)) {
          return; // not an on-disk request: nothing to write
        }
        const patch = requestOverrides.get(id) as RequestPatch | undefined;
        if (patch) {
          nextTree = updateRequest(nextTree, id, patch);
          foldedOverrideIds.push(id);
        }
      });
      if (editor?.commitToTree) {
        nextTree = editor.commitToTree(nextTree);
      }

      if (promotedDraftIds.length > 0) {
        setDraftRequests((current) => {
          const next = new Map(current);
          promotedDraftIds.forEach((id) => next.delete(id));
          return next;
        });
      }
      if (foldedOverrideIds.length > 0) {
        setRequestOverrides((current) => {
          const nextOverrides = new Map(current);
          foldedOverrideIds.forEach((id) => nextOverrides.delete(id));
          return nextOverrides;
        });
      }
      if (nextTree !== tree) {
        persistTree(nextTree, "edits");
      }
      // The .env editor isn't a tree write - persist it on its own.
      if (editor && !editor.commitToTree) {
        editor.save();
      }

      if (pendingClose.kind === "all") {
        closeAllRequests();
      } else if (pendingClose.kind === "others") {
        closeOthers(pendingClose.id);
      } else if (pendingClose.kind === "editor") {
        setEditTarget(null);
        setIsEditorActive(false);
      } else {
        closeRequest(pendingClose.id);
      }
      setPendingClose(null);
    };

    const cancelPendingClose = () => setPendingClose(null);

    const setTokenValue = (target: TokenTarget, value: string) => {
      if (target.kind === "dotenv") {
        // Write to the `.env` that PROVIDED this key for the active SCOPE (a folder
        // pane resolves its own chain; a request its folder chain): the nearest
        // folder defining it, else the workspace-root `.env`. Editing the root when
        // a nearer folder shadows it would be silently overridden.
        const owner =
          activeScopeId !== null
            ? resolveProcessEnvProvenance(tree, activeScopeId, processEnv)[
                target.key
              ]?.scopeId ?? null
            : null;
        if (owner === null) {
          saveEnv(setDotenvValue(envText, target.key, value));
          return;
        }
        const folder = findNode(tree, owner);
        const nextDotenv = setDotenvValue(
          folder?.kind === "folder" ? folder.dotenv ?? "" : "",
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
        const path = node.params.path;
        const next = path.some((row) => row.key === target.name)
          ? path.map((row) =>
              row.key === target.name ? { ...row, value } : row,
            )
          : [...path, { key: target.name, value }];
        setRequestPathParams(target.requestId, next);
        return;
      }
      const node = findNode(tree, target.scopeId);
      if (!node) {
        return;
      }
      const config = node.config;
      // Update-or-append a `{key,value}` in a KeyValue[] rows list.
      const upsertRow = (rows: KeyValue[], key: string, val: string) =>
        rows.some((row) => row.key === key)
          ? rows.map((row) => (row.key === key ? { ...row, value: val } : row))
          : [...rows, { key, value: val }];
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
            ? resolveProcessEnvProvenance(tree, activeScopeId, processEnv)[
                target.key
              ]?.scopeId ?? null
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

    return {
      tree,
      isWorkspaceWritable,
      consoleLines,
      expandedFolderIds,
      selectedNodeId,
      openRequestIds,
      activeRequestId,
      activeRequestTab,
      activeResponseTab,
      requestsById,
      activeRequest:
        activeRequestId !== null
          ? (requestsById.get(activeRequestId) ?? null)
          : null,
      effectiveConfig:
        activeRequestId !== null
          ? resolveConfig(tree, activeRequestId, {
              environment: effectiveEnvironment ?? undefined,
            })
          : null,
      responseState: (id: string) =>
        responseStates.get(id) ?? { status: "idle" },
      // The shell border tracks the active env resolved against the focused node:
      // the open folder editor's folder while editing, else the active request.
      activeAccentColor: accentColorFor(tree, activeScopeId, effectiveEnvironment),
      // Env combobox options are scoped to the focused node's chain (a folder with
      // no/other envs changes what the sidebar offers); no focus -> all tree envs.
      environmentNames: scopedEnvNames,
      activeEnvironment: effectiveEnvironment,
      // Exposed value = the ACTIVE request's folded `.env` (nearest folder wins,
      // root base), so token highlighting/preview match what a send resolves. The
      // raw root-base `processEnv` state is read directly where folding happens
      // (sendRequest/openCodeGen/setTokenValue), not from this exposed field.
      processEnv:
        activeRequestId !== null
          ? resolveProcessEnv(tree, activeRequestId, processEnv)
          : processEnv,
      rootProcessEnv: processEnv,
      envText,
      editTarget,
      isEditorActive,
      openConfigEditor: (id: string) => {
        if (requestsById.has(id)) {
          setEditTarget(null);
          setIsEditorActive(false);
          setOpenRequestIds((current) =>
            current.includes(id) ? current : [...current, id],
          );
          setActiveRequestId(id);
          setActiveRequestTab("settings");
          return;
        }
        setEditTarget({ kind: "config", id });
        setIsEditorActive(true);
      },
      closeEditor: requestCloseEditor,
      saveNodeConfig,
      saveFolder,
      saveFolderConfigDoc,
      setFolderEnvColor,
      saveRequestNode,
      saveActiveRequest,
      dirtyRequestIds,
      saveEnv,
      setTokenValue,
      revealTokenSource,
      revealTarget,
      paramsReveal,
      registerActiveEditor,
      saveActiveEditor: () => {
        if (!activeEditor) {
          return false;
        }
        activeEditor.save();
        return true;
      },
      saveActive: () => {
        // A DIRTY editor persists + toasts via its own save(); a dirty request
        // persists + toasts via persistTree. Only when NEITHER had changes (clean
        // state) do we toast here - so Cmd+S always confirms without double-toasting
        // AND a clean save never pays the tree-write round-trip (the editor's save()
        // would persist unconditionally, which lagged the toast on the Settings tab).
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
      },
      editorDirty,
      pendingClose,
      popupCanSave,
      requestCloseRequest,
      requestCloseOthers,
      requestCloseAll,
      requestCloseEditor,
      confirmPendingClose,
      savePendingClose,
      cancelPendingClose,
      setActiveEnvironment: (name: string | null) => {
        setActiveEnvironmentState(name);
        onActiveEnvironmentChangeRef.current?.(name);
      },
      isSettingsOpen,
      isSettingsActive,
      toggleFolder,
      selectNode,
      focusNode,
      selectedIds,
      selectInTree,
      clearSelection,
      setActiveRequest: (id) => {
        setIsEditorActive(false);
        setActiveRequestId(id);
      },
      reorderRequests: (nextIds) =>
        setOpenRequestIds((current) => {
          const isPermutation =
            nextIds.length === current.length &&
            nextIds.every((id) => current.includes(id));
          return isPermutation ? nextIds : current;
        }),
      moveNode: (dragId, target) => {
        const next = applyMove(tree, dragId, target);
        if (next === tree) {
          return;
        }
        setTree(next);
        onTreeChangeRef.current?.(next).then((result) => {
          if (!result.ok) {
            setConsoleLines((lines) => [
              ...lines,
              `[workspace] failed to persist move: ${result.error}`,
            ]);
          }
        });
      },
      moveNodes: (dragIds, target) => {
        const next = applyMoveNodes(tree, dragIds, target);
        if (next === tree) {
          return;
        }
        setTree(next);
        onTreeChangeRef.current?.(next).then((result) => {
          if (!result.ok) {
            setConsoleLines((lines) => [
              ...lines,
              `[workspace] failed to persist move: ${result.error}`,
            ]);
          }
        });
      },
      closeRequest,
      closeAllRequests,
      renamingNodeId,
      beginRename,
      commitRename,
      cancelRename,
      newFolder,
      duplicateRequest,
      pendingDelete,
      requestDeleteNode,
      confirmPendingDelete,
      cancelPendingDelete,
      setRequestBody,
      setRequestBodyMode,
      setRequestForm,
      setRequestGraphqlQuery,
      setRequestGraphqlVariables,
      setRequestUrl,
      setRequestMethod,
      setRequestPathParams,
      setRequestQueryParams,
      setRequestConfig,
      sendRequest,
      cancelRequest,
      setRequestTab: setActiveRequestTab,
      setResponseTab: setActiveResponseTab,
      openSettings: () => {
        // Remember the pre-settings tab so Esc can return to it (only when
        // opening fresh, not re-activating from another tab).
        if (activeRequestId !== SETTINGS_TAB_ID) {
          preSettingsActiveId.current = activeRequestId;
        }
        setOpenRequestIds((current) =>
          current.includes(SETTINGS_TAB_ID)
            ? current
            : [...current, SETTINGS_TAB_ID],
        );
        setActiveRequestId(SETTINGS_TAB_ID);
        setIsEditorActive(false);
      },
      // Esc DEACTIVATES settings (returns to the workspace) but leaves the tab
      // open - it is closed only via its X / Mod+W / close-all, like a request.
      closeSettings: () => {
        if (activeRequestId !== SETTINGS_TAB_ID) {
          return;
        }
        const others = openRequestIds.filter((id) => id !== SETTINGS_TAB_ID);
        const prior = preSettingsActiveId.current;
        const target =
          prior !== null && others.includes(prior)
            ? prior
            : (others[others.length - 1] ?? null);
        setActiveRequestId(target);
      },
      newRequest,
      resolveActiveWire,
      isCodeGenOpen,
      openCodeGen,
      closeCodeGen,
      isCurlImportOpen,
      openCurlImport,
      closeCurlImport,
      importCurl,
      importBruno,
      importPostman,
      importOpenapi,
      focusUrlNonce,
    };
  }, [
    tree,
    isWorkspaceWritable,
    consoleLines,
    expandedFolderIds,
    selectedNodeId,
    selectedIds,
    selectAnchorId,
    openRequestIds,
    activeRequestId,
    activeRequestTab,
    activeResponseTab,
    isSettingsOpen,
    isSettingsActive,
    requestsById,
    responseStates,
    effectiveEnvironment,
    scopedEnvNames,
    activeScopeId,
    processEnv,
    envText,
    editTarget,
    isEditorActive,
    dirtyRequestIds,
    requestOverrides,
    draftRequests,
    pendingClose,
    pendingDelete,
    isCurlImportOpen,
    isCodeGenOpen,
    revealTarget,
    paramsReveal,
    renamingNodeId,
    focusUrlNonce,
    activeEditor,
    editorDirty,
    popupCanSave,
    registerActiveEditor,
  ]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return value;
}
