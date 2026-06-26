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
import {
  resolveConfig,
  resolveProcessEnv,
  resolveProcessEnvProvenance,
  type EffectiveConfig,
} from "@/lib/workspace/resolve";
import { moveNode as applyMove, type MoveTarget } from "@/lib/workspace/move";
import {
  collectRequestIds,
  duplicateRequest as applyDuplicate,
  insertNode,
  removeNode,
  renameNode,
} from "@/lib/workspace/tree-edit";
import { locateNode } from "@/lib/workspace/tree-locate";
import { untitledName } from "@/lib/workspace/request-name";
import type { WriteResult } from "@/lib/workspace/fs";
import { buildHttpRequest } from "@/lib/http/build-request";
import { createFakeHttpClient } from "@/lib/http/fake-client";
import type { HttpClient, ResponseState } from "@/lib/http/model";
import type { ScriptRunner } from "@/lib/scripts/model";
import { createFakeScriptRunner } from "@/lib/scripts/fake-runner";
import {
  applyPreToEffective,
  buildScriptApi,
  type ReqDraft,
  type VarWrite,
} from "@/lib/scripts/script-context";
import { findVarWriteTarget, setNodeVar } from "@/lib/scripts/var-write";
import type {
  BodyMode,
  ConfigScope,
  HttpMethod,
  KeyValue,
} from "@/lib/workspace/model";
import {
  listEnvironmentNames,
  mergeDotenv,
  parseDotenv,
  setDotenvValue,
} from "@/lib/workspace/environment";
import { updateNodeConfig } from "@/lib/workspace/update-config";
import { updateFolderDotenv } from "@/lib/workspace/update-folder-dotenv";
import {
  updateRequest,
  type RequestPatch,
} from "@/lib/workspace/update-request";
import { findNode } from "@/lib/workspace/tree-locate";
import type { TokenTarget } from "@/components/workspace/url-token";
import { useToast } from "@/components/ui/toast";
import { toCurl } from "@/lib/curl/to-curl";
import { parseCurl, type CurlParseResult } from "@/lib/curl/parse-curl";
import {
  brunoToTree,
  collectDotenv,
  type BrunoFileMap,
} from "@/lib/bruno/bruno-to-tree";

type RequestOverride = Partial<
  Pick<
    RequestNode,
    "name" | "url" | "method" | "body" | "bodyMode" | "bodyForm" | "config"
  >
>;

// `config` is an object, so an override is only "dirty" when it differs from the
// saved value by VALUE (a re-created-but-equal config must clear the dot). Every
// other override field is a primitive, compared by `!==`.
function isOverrideFieldDirty(
  field: keyof RequestOverride,
  overrideValue: unknown,
  baseValue: unknown,
): boolean {
  if (overrideValue === undefined) {
    return false;
  }
  if (field === "config") {
    return JSON.stringify(overrideValue) !== JSON.stringify(baseValue);
  }
  return overrideValue !== baseValue;
}

export type EditTarget = { kind: "config"; id: string } | null;

// A "go to source" jump from a token popup: which folder scope + which view to
// open so the value behind the token is editable. `nonce` makes consecutive
// jumps to the SAME target re-fire (the consumer keys its effect on identity).
export type RevealTarget = {
  nonce: number;
  folderId: string;
  view: "vars" | "envs" | "dotenv";
  env?: string;
} | null;

// The root `.env` Settings editor still registers on the active-editor seam under
// a distinct scope so Cmd+S / close-confirm route to it; it is no longer an
// `editTarget` (it lives in Settings, not as an editor tab).
export type EditorScope = { kind: "config"; id: string } | { kind: "env" };

export type ActiveEditor = {
  scope: EditorScope;
  isDirty: boolean;
  // false when the editor content can't be persisted (e.g. invalid JSON); a
  // popup-save must skip it rather than silently save nothing.
  canSave: boolean;
  save: () => void;
  // Pure fold of this editor's current content into a tree (config/request
  // editors). Lets a popup-save persist this editor PLUS request overrides in a
  // single tree write (no stale-tree clobber). Absent for the .env editor, which
  // writes `envText`, not the tree.
  commitToTree?: (tree: TreeNode[]) => TreeNode[];
};

export type PendingClose =
  | { kind: "one"; id: string }
  | { kind: "others"; id: string }
  | { kind: "all" }
  | { kind: "editor" }
  | null;

export type PendingDelete = { id: string } | null;

export type RequestTab =
  | "vars"
  | "auth"
  | "headers"
  | "params"
  | "body"
  | "script"
  | "settings";
export type ResponseTab = "response" | "headers";

type WorkspaceContextValue = {
  tree: TreeNode[];
  consoleLines: string[];
  expandedFolderIds: Set<string>;
  selectedNodeId: string | null;
  openRequestIds: string[];
  activeRequestId: string | null;
  activeRequestTab: RequestTab;
  activeResponseTab: ResponseTab;
  requestsById: Map<string, RequestNode>;
  activeRequest: RequestNode | null;
  effectiveConfig: EffectiveConfig | null;
  responseState: (id: string) => ResponseState;
  environmentNames: string[];
  activeEnvironment: string | null;
  setActiveEnvironment: (name: string | null) => void;
  processEnv: Record<string, string>;
  // The workspace-root `.env` base (NOT folded to any request). A folder pane
  // folds this over its own chain to preview its `{{process.env.X}}` tokens.
  rootProcessEnv: Record<string, string>;
  envText: string;
  editTarget: EditTarget;
  isEditorActive: boolean;
  openConfigEditor: (id: string) => void;
  closeEditor: () => void;
  saveNodeConfig: (id: string, config: ConfigScope) => void;
  saveFolder: (id: string, config: ConfigScope, dotenv: string) => void;
  saveRequestNode: (id: string, patch: RequestPatch) => void;
  saveActiveRequest: () => boolean;
  // The Cmd+S entry point: saves the active editor or request, and ALWAYS shows a
  // "Saved" toast - even with nothing to persist (clean state) - so Cmd+S always
  // gives the same confirmation. Real saves toast once via persistTree; this only
  // adds the toast when neither path persisted (so no double toast).
  saveActive: () => void;
  dirtyRequestIds: Set<string>;
  saveEnv: (text: string) => void;
  setTokenValue: (target: TokenTarget, value: string) => void;
  // Jump from a token popup to where its value is editable (nearest-wins scope).
  revealTokenSource: (target: TokenTarget) => void;
  revealTarget: RevealTarget;
  registerActiveEditor: (editor: ActiveEditor | null) => void;
  saveActiveEditor: () => boolean;
  editorDirty: boolean;
  pendingClose: PendingClose;
  popupCanSave: boolean;
  requestCloseRequest: (id: string) => void;
  requestCloseOthers: (id: string) => void;
  requestCloseAll: () => void;
  requestCloseEditor: () => void;
  confirmPendingClose: () => void;
  savePendingClose: () => void;
  cancelPendingClose: () => void;
  isSettingsOpen: boolean;
  isSettingsActive: boolean;
  toggleFolder: (id: string) => void;
  selectNode: (id: string) => void;
  setActiveRequest: (id: string) => void;
  reorderRequests: (nextIds: string[]) => void;
  moveNode: (dragId: string, target: MoveTarget) => void;
  closeRequest: (id: string) => void;
  closeAllRequests: () => void;
  renamingNodeId: string | null;
  beginRename: (id: string) => void;
  commitRename: (id: string, name: string) => void;
  cancelRename: () => void;
  newFolder: (target?: MoveTarget) => void;
  duplicateRequest: (id: string) => void;
  pendingDelete: PendingDelete;
  requestDeleteNode: (id: string) => void;
  confirmPendingDelete: () => void;
  cancelPendingDelete: () => void;
  setRequestBody: (id: string, body: string) => void;
  setRequestBodyMode: (id: string, mode: BodyMode) => void;
  setRequestForm: (id: string, rows: KeyValue[]) => void;
  setRequestUrl: (id: string, url: string) => void;
  setRequestMethod: (id: string, method: HttpMethod) => void;
  setRequestConfig: (id: string, config: ConfigScope) => void;
  sendRequest: (id: string) => void;
  cancelRequest: (id: string) => void;
  setRequestTab: (tab: RequestTab) => void;
  setResponseTab: (tab: ResponseTab) => void;
  openSettings: () => void;
  closeSettings: () => void;
  newRequest: (target?: MoveTarget) => void;
  copyAsCurl: () => void;
  isCurlImportOpen: boolean;
  openCurlImport: () => void;
  closeCurlImport: () => void;
  importCurl: (text: string) => CurlParseResult;
  importBruno: (files: BrunoFileMap, name: string) => void;
  focusUrlNonce: number;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function indexRequests(nodes: TreeNode[]): Map<string, RequestNode> {
  const flatten = (node: TreeNode): RequestNode[] =>
    node.kind === "request" ? [node] : node.children.flatMap(flatten);
  return new Map(
    nodes.flatMap(flatten).map((request) => [request.id, request]),
  );
}

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  next.add(id);
  return next;
}

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
  onTabsChange,
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
  const [revealTarget, setRevealTarget] = useState<RevealTarget>(null);
  const revealNonce = useRef(0);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [consoleLines, setConsoleLines] =
    useState<string[]>(initialConsoleLines);
  const [requestOverrides, setRequestOverrides] = useState<
    Map<string, RequestOverride>
  >(() => new Map());
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
    requestOverrides.forEach((override, id) => {
      const base = byId.get(id);
      if (base) {
        byId.set(id, { ...base, ...override });
      }
    });
    return byId;
  }, [tree, requestOverrides]);

  const dirtyRequestIds = useMemo(() => {
    const treeRequests = indexRequests(tree);
    const dirty = new Set<string>();
    requestOverrides.forEach((override, id) => {
      const base = treeRequests.get(id);
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
  }, [tree, requestOverrides, activeEditor, requestsById]);

  // The active editor (folder config pane / .env) is dirty AND not just a
  // request-config editor already reflected in dirtyRequestIds.
  const editorDirty = activeEditor?.isDirty ?? false;

  // A popup "Save" can persist only when there is no active editor blocking it
  // with unsaveable (e.g. invalid-JSON) content. No editor mounted -> saving the
  // request override is always fine.
  const popupCanSave = activeEditor === null || activeEditor.canSave;

  const restoredOpenIds = useMemo(() => {
    const known = indexRequests(tree);
    const restored = (initialOpenRequestIds ?? []).filter((id) =>
      known.has(id),
    );
    if (restored.length > 0) {
      return restored;
    }
    return initialActiveRequestId ? [initialActiveRequestId] : [];
  }, [tree, initialOpenRequestIds, initialActiveRequestId]);

  const [expandedFolderIds, setExpandedFolderIds] = useState(
    () => new Set(initialExpandedIds),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialActiveRequestId ?? restoredOpenIds[0] ?? null,
  );
  const [openRequestIds, setOpenRequestIds] =
    useState<string[]>(restoredOpenIds);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(
    initialActiveRequestId ?? restoredOpenIds[0] ?? null,
  );
  const [activeRequestTab, setActiveRequestTab] =
    useState<RequestTab>("params");
  const [activeResponseTab, setActiveResponseTab] =
    useState<ResponseTab>("response");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSettingsActive, setIsSettingsActive] = useState(false);

  const onTabsChangeRef = useRef(onTabsChange);
  useEffect(() => {
    onTabsChangeRef.current = onTabsChange;
  }, [onTabsChange]);
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
  const isFirstTabsRender = useRef(true);
  useEffect(() => {
    if (isFirstTabsRender.current) {
      isFirstTabsRender.current = false;
      return;
    }
    // A freshly-created node carries a synthetic in-session id (`new-<n>`) that
    // is replaced by a path-based id on the next disk reload, so it can't match
    // a persisted open-tab id - drop it from what we persist (it would never
    // restore anyway, same accepted limitation a drag-move has).
    const persistableIds = openRequestIds.filter(
      (id) => !id.startsWith("new-"),
    );
    onTabsChangeRef.current?.(
      persistableIds,
      activeRequestId !== null && persistableIds.includes(activeRequestId)
        ? activeRequestId
        : null,
    );
  }, [openRequestIds, activeRequestId]);

  const value = useMemo<WorkspaceContextValue>(() => {
    const selectNode = (id: string) => {
      setSelectedNodeId(id);
      const request = requestsById.get(id);
      if (!request) {
        setExpandedFolderIds((current) => toggleInSet(current, id));
        return;
      }
      setOpenRequestIds((current) =>
        current.includes(id) ? current : [...current, id],
      );
      setIsSettingsActive(false);
      setIsEditorActive(false);
      setActiveRequestId(id);
    };

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
      setResponseStates(new Map());
      setIsSettingsOpen(false);
      setIsSettingsActive(false);
    };

    const closeOthers = (id: string) => {
      setOpenRequestIds((current) => (current.includes(id) ? [id] : current));
      setActiveRequestId(id);
      setIsSettingsActive(false);
      setIsEditorActive(false);
      setRequestOverrides((current) => {
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

    const setRequestBody = (id: string, body: string) =>
      mergeOverride(id, { body });
    const setRequestBodyMode = (id: string, bodyMode: BodyMode) =>
      mergeOverride(id, { bodyMode });
    const setRequestForm = (id: string, bodyForm: KeyValue[]) =>
      mergeOverride(id, { bodyForm });
    const setRequestUrl = (id: string, url: string) => {
      // A freshly-created request's name tracks the URL verbatim until the user
      // names it; an empty URL falls back to the request's unique untitled name
      // so clearing the field doesn't blank the label.
      const fallback = autoNameIds.current.get(id);
      if (fallback !== undefined) {
        mergeOverride(id, { url, name: url.trim() || fallback });
        return;
      }
      mergeOverride(id, { url });
    };
    const setRequestMethod = (id: string, method: HttpMethod) =>
      mergeOverride(id, { method });
    const setRequestConfig = (id: string, config: ConfigScope) =>
      mergeOverride(id, { config });

    const sendRequest = async (id: string) => {
      const node = requestsById.get(id);
      if (!node || responseStates.get(id)?.status === "sending") {
        return;
      }
      const effective = resolveConfig(tree, id, {
        environment: activeEnvironment ?? undefined,
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
      const persistVarWrites = (writes: VarWrite[]) => {
        if (writes.length === 0) {
          return;
        }
        const next = writes.reduce(
          (acc, write) =>
            setNodeVar(
              acc,
              findVarWriteTarget(acc, id, write.name),
              write.name,
              write.value,
            ),
          tree,
        );
        persistTree(next, "script");
      };

      // PRE-request script: may mutate a reqDraft + set runtime/persisted vars.
      const runtimeVars = new Map<string, string>();
      const reqDraft: ReqDraft = {
        method: node.method,
        url: node.url,
        body: node.body,
        headerOverrides: {},
      };
      const preCode = effective.scripts.pre.value;
      if (preCode.trim() !== "") {
        const preVarWrites: VarWrite[] = [];
        const api = buildScriptApi({
          stage: "pre",
          effective,
          processEnv: foldedEnv,
          envName: activeEnvironment ?? null,
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
        body: reqDraft.body,
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
          envName: activeEnvironment ?? null,
          runtimeVars: new Map(runtimeVars),
          varWrites: postVarWrites,
          log: (line) => pendingLines.push(line),
          clear: clearConsole,
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
    const createRequestNode = (
      partial: Pick<RequestNode, "name" | "method" | "url" | "body"> &
        Partial<RequestNode>,
      target?: MoveTarget,
      autoName = false,
    ) => {
      nodeCounter.current += 1;
      const id = `new-${nodeCounter.current}`;
      const request: RequestNode = {
        kind: "request",
        config: {},
        ...partial,
        id,
      };
      const placement = derivePlacement(target);
      if (placement.parentId !== null) {
        setExpandedFolderIds((current) =>
          new Set(current).add(placement.parentId!),
        );
      }
      if (autoName) {
        autoNameIds.current.set(id, request.name);
      }
      setIsSettingsActive(false);
      setIsEditorActive(false);
      setOpenRequestIds((current) => [...current, id]);
      setActiveRequestId(id);
      setSelectedNodeId(id);
      setRenamingNodeId(null);
      if (autoName) {
        setFocusUrlNonce((nonce) => nonce + 1);
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
        { name: untitledName(existingNames), method: "GET", url: "", body: "" },
        target,
        true,
      );
    };

    const copyAsCurl = () => {
      if (activeRequestId === null) {
        return;
      }
      const node = requestsById.get(activeRequestId);
      if (!node) {
        return;
      }
      const effective = resolveConfig(tree, activeRequestId, {
        environment: activeEnvironment ?? undefined,
      });
      const foldedEnv = resolveProcessEnv(tree, activeRequestId, processEnv);
      const wire = buildHttpRequest(node, effective, foldedEnv);
      navigator.clipboard?.writeText(toCurl(wire));
      showToastRef.current("Copied as cURL");
    };

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
        body: body ?? "",
        config: {
          ...(headers.length > 0 ? { headers } : {}),
          ...(auth ? { auth } : {}),
        },
      });
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
      setIsSettingsActive(false);
      setIsEditorActive(false);
      setSelectedNodeId(folder.id);
      persistTree(insertNode(tree, null, tree.length, folder), "import");
      // A collection's .env feeds {{process.env.X}} - merge every .env found
      // (at any depth) into the workspace .env so imported requests resolve
      // their process-env tokens.
      const collectionEnv = collectDotenv(files);
      if (collectionEnv.trim() !== "") {
        saveEnv(mergeDotenv(envText, collectionEnv));
      }
      showToastRef.current("Imported Bruno collection");
    };

    // Optimistic save: the in-memory tree updates synchronously and we confirm
    // ("Saved") immediately, without awaiting the disk write - so Cmd+S never
    // mules behind the round-trip. The write still runs in the background; only a
    // REJECTED write surfaces (a "Save failed" toast + console line) so the user
    // is never silently left with an unpersisted change.
    const persistTree = (next: TreeNode[], failLabel: string) => {
      setTree(next);
      const persist = onTreeChangeRef.current;
      showToastRef.current("Saved");
      if (!persist) {
        return;
      }
      persist(next).then((result) => {
        if (result.ok) {
          return;
        }
        showToastRef.current(`Save failed: ${result.error}`);
        setConsoleLines((lines) => [
          ...lines,
          `[workspace] failed to persist ${failLabel}: ${result.error}`,
        ]);
      });
    };

    const saveNodeConfig = (id: string, config: ConfigScope) =>
      persistTree(updateNodeConfig(tree, id, config), "config");

    // Folder pane save: persist the folder's config AND its own `.env` in ONE
    // tree write so the Env tab's two sub-views can't clobber each other.
    const saveFolder = (id: string, config: ConfigScope, dotenv: string) =>
      persistTree(
        updateFolderDotenv(updateNodeConfig(tree, id, config), id, dotenv),
        "config",
      );

    const saveActiveRequest = (): boolean => {
      if (activeRequestId === null) {
        return false;
      }
      if (!dirtyRequestIds.has(activeRequestId)) {
        return false;
      }
      const patch = requestOverrides.get(activeRequestId) as
        | RequestPatch
        | undefined;
      if (!patch) {
        return false;
      }
      const id = activeRequestId;
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
      setIsSettingsActive(false);
      setIsEditorActive(false);
      setSelectedNodeId(id);
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
      setIsSettingsActive(false);
      setIsEditorActive(false);
      setActiveRequestId(newId);
      setSelectedNodeId(newId);
      persistTree(applyDuplicate(tree, id, newId), "duplicate");
    };

    const deleteNode = (id: string) => {
      const node = findNode(tree, id);
      if (!node) {
        return;
      }
      if (renamingNodeId === id) {
        setRenamingNodeId(null);
      }
      collectRequestIds(node).forEach((requestId) => closeRequest(requestId));
      persistTree(removeNode(tree, id), "delete");
    };

    const requestDeleteNode = (id: string) => {
      const node = findNode(tree, id);
      if (!node) {
        return;
      }
      if (node.kind === "folder" && node.children.length > 0) {
        setPendingDelete({ id });
        return;
      }
      deleteNode(id);
    };

    const confirmPendingDelete = () => {
      if (pendingDelete === null) {
        return;
      }
      deleteNode(pendingDelete.id);
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
      overrideIdsToFold.forEach((id) => {
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

    const saveEnv = (text: string) => {
      setEnvText(text);
      setProcessEnv(parseDotenv(text));
      const persist = onEnvChangeRef.current;
      if (!persist) {
        showToastRef.current("Saved");
        return;
      }
      Promise.resolve(persist(text)).then(() => showToastRef.current("Saved"));
    };

    const setTokenValue = (target: TokenTarget, value: string) => {
      if (target.kind === "dotenv") {
        // Write to the `.env` that PROVIDED this key for the active request: the
        // nearest folder defining it, else the workspace-root `.env`. Editing the
        // root when a nearer folder shadows it would be silently overridden.
        const owner =
          activeRequestId !== null
            ? resolveProcessEnvProvenance(tree, activeRequestId, processEnv)[
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
      const node = findNode(tree, target.scopeId);
      if (!node) {
        return;
      }
      const config = node.config;
      const nextConfig: ConfigScope =
        target.kind === "environment"
          ? {
              ...config,
              environments: {
                ...config.environments,
                [target.env]: {
                  ...config.environments?.[target.env],
                  [target.name]: value,
                },
              },
            }
          : {
              ...config,
              variables: { ...config.variables, [target.name]: value },
            };
      saveNodeConfig(target.scopeId, nextConfig);
    };

    // Jump from a token popup to the exact place the value is editable: the
    // highest-priority scope that actually PROVIDES it (nearest folder wins).
    // dotenv -> that folder's Env > .env (root .env lives in Settings); an env
    // var -> Env > Envs with its env picked; a plain var -> Vars. A value owned
    // by the request itself opens the request's own tab instead of a folder.
    const revealTokenSource = (target: TokenTarget) => {
      if (target.kind === "dotenv") {
        const owner =
          activeRequestId !== null
            ? resolveProcessEnvProvenance(tree, activeRequestId, processEnv)[
                target.key
              ]?.scopeId ?? null
            : null;
        if (owner === null) {
          setIsSettingsOpen(true);
          setIsSettingsActive(true);
          setIsEditorActive(false);
          return;
        }
        revealNonce.current += 1;
        setRevealTarget({
          nonce: revealNonce.current,
          folderId: owner,
          view: "dotenv",
        });
        setIsSettingsActive(false);
        setEditTarget({ kind: "config", id: owner });
        setIsEditorActive(true);
        return;
      }
      const node = findNode(tree, target.scopeId);
      if (!node) {
        return;
      }
      if (node.kind === "request") {
        setIsSettingsActive(false);
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
      setIsSettingsActive(false);
      setEditTarget({ kind: "config", id: node.id });
      setIsEditorActive(true);
    };

    return {
      tree,
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
              environment: activeEnvironment ?? undefined,
            })
          : null,
      responseState: (id: string) =>
        responseStates.get(id) ?? { status: "idle" },
      environmentNames: listEnvironmentNames(tree),
      activeEnvironment,
      // Exposed value = the ACTIVE request's folded `.env` (nearest folder wins,
      // root base), so token highlighting/preview match what a send resolves. The
      // raw root-base `processEnv` state is read directly where folding happens
      // (sendRequest/copyAsCurl/setTokenValue), not from this exposed field.
      processEnv:
        activeRequestId !== null
          ? resolveProcessEnv(tree, activeRequestId, processEnv)
          : processEnv,
      rootProcessEnv: processEnv,
      envText,
      editTarget,
      isEditorActive,
      openConfigEditor: (id: string) => {
        setIsSettingsActive(false);
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
      saveRequestNode,
      saveActiveRequest,
      dirtyRequestIds,
      saveEnv,
      setTokenValue,
      revealTokenSource,
      revealTarget,
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
      toggleFolder: (id) =>
        setExpandedFolderIds((current) => toggleInSet(current, id)),
      selectNode,
      setActiveRequest: (id) => {
        setIsSettingsActive(false);
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
      setRequestUrl,
      setRequestMethod,
      setRequestConfig,
      sendRequest,
      cancelRequest,
      setRequestTab: setActiveRequestTab,
      setResponseTab: setActiveResponseTab,
      openSettings: () => {
        setIsSettingsOpen(true);
        setIsSettingsActive(true);
        setIsEditorActive(false);
      },
      closeSettings: () => {
        setIsSettingsOpen(false);
        setIsSettingsActive(false);
      },
      newRequest,
      copyAsCurl,
      isCurlImportOpen,
      openCurlImport,
      closeCurlImport,
      importCurl,
      importBruno,
      focusUrlNonce,
    };
  }, [
    tree,
    consoleLines,
    expandedFolderIds,
    selectedNodeId,
    openRequestIds,
    activeRequestId,
    activeRequestTab,
    activeResponseTab,
    isSettingsOpen,
    isSettingsActive,
    requestsById,
    responseStates,
    activeEnvironment,
    processEnv,
    envText,
    editTarget,
    isEditorActive,
    dirtyRequestIds,
    requestOverrides,
    pendingClose,
    pendingDelete,
    isCurlImportOpen,
    revealTarget,
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
