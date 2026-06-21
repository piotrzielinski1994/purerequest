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
import {
  mockConsoleLines,
  mockTree,
  type RequestNode,
  type TreeNode,
} from "@/components/workspace/mock-data";
import { resolveConfig, type EffectiveConfig } from "@/lib/workspace/resolve";
import { moveNode as applyMove, type MoveTarget } from "@/lib/workspace/move";
import {
  collectRequestIds,
  duplicateRequest as applyDuplicate,
  insertNode,
  removeNode,
  renameNode,
} from "@/lib/workspace/tree-edit";
import { locateNode } from "@/lib/workspace/tree-locate";
import { deriveRequestName } from "@/lib/workspace/request-name";
import type { WriteResult } from "@/lib/workspace/fs";
import { buildHttpRequest } from "@/lib/http/build-request";
import { createFakeHttpClient } from "@/lib/http/fake-client";
import type { HttpClient, ResponseState } from "@/lib/http/model";
import type {
  BodyMode,
  ConfigScope,
  HttpMethod,
  KeyValue,
} from "@/lib/workspace/model";
import {
  listEnvironmentNames,
  parseDotenv,
  setDotenvValue,
} from "@/lib/workspace/environment";
import { updateNodeConfig } from "@/lib/workspace/update-config";
import {
  updateRequest,
  type RequestPatch,
} from "@/lib/workspace/update-request";
import { findNode } from "@/lib/workspace/tree-locate";
import type { TokenTarget } from "@/components/workspace/url-token";
import { useToast } from "@/components/ui/toast";

type RequestOverride = Partial<
  Pick<RequestNode, "name" | "url" | "method" | "body" | "bodyMode" | "bodyForm">
>;

export type EditTarget =
  | { kind: "config"; id: string }
  | { kind: "env" }
  | null;

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
  envText: string;
  editTarget: EditTarget;
  isEditorActive: boolean;
  openConfigEditor: (id: string) => void;
  openEnvEditor: () => void;
  closeEditor: () => void;
  saveNodeConfig: (id: string, config: ConfigScope) => void;
  saveRequestNode: (id: string, patch: RequestPatch) => void;
  saveActiveRequest: () => void;
  dirtyRequestIds: Set<string>;
  saveEnv: (text: string) => void;
  setTokenValue: (target: TokenTarget, value: string) => void;
  registerActiveEditor: (editor: ActiveEditor | null) => void;
  saveActiveEditor: () => boolean;
  editorDirty: boolean;
  pendingClose: PendingClose;
  popupCanSave: boolean;
  requestCloseRequest: (id: string) => void;
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
  sendRequest: (id: string) => void;
  setRequestTab: (tab: RequestTab) => void;
  setResponseTab: (tab: ResponseTab) => void;
  openSettings: () => void;
  closeSettings: () => void;
  newRequest: (target?: MoveTarget) => void;
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
  activeEnvironment?: string;
  processEnv?: Record<string, string>;
  envText?: string;
  onActiveEnvironmentChange?: (name: string | null) => void;
  onEnvChange?: (text: string) => void;
};

export function WorkspaceProvider({
  children,
  tree: initialTree = mockTree,
  consoleLines: initialConsoleLines = mockConsoleLines,
  initialExpandedIds = [],
  initialActiveRequestId,
  initialOpenRequestIds,
  onTabsChange,
  onTreeChange,
  httpClient,
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
  // Ids of freshly-created requests whose name auto-tracks the URL until the
  // user names them (manual rename) or the request is saved.
  const autoNameIds = useRef<Set<string>>(new Set());
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
        (field) =>
          override[field] !== undefined && override[field] !== base[field],
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
      // A freshly-created request's name tracks the URL path until the user
      // names it. deriveRequestName("") is "" -> fall back to "New Request" so
      // clearing the URL doesn't blank the tab/row label.
      if (autoNameIds.current.has(id)) {
        mergeOverride(id, { url, name: deriveRequestName(url) || "New Request" });
        return;
      }
      mergeOverride(id, { url });
    };
    const setRequestMethod = (id: string, method: HttpMethod) =>
      mergeOverride(id, { method });

    const sendRequest = (id: string) => {
      const node = requestsById.get(id);
      if (!node || responseStates.get(id)?.status === "sending") {
        return;
      }
      const wire = buildHttpRequest(
        node,
        resolveConfig(tree, id, {
          environment: activeEnvironment ?? undefined,
        }),
        processEnv,
      );
      setResponseStates((current) =>
        new Map(current).set(id, { status: "sending" }),
      );
      httpClientRef.current.send(wire).then((result) => {
        setResponseStates((current) => {
          if (!current.has(id)) {
            return current;
          }
          return new Map(current).set(
            id,
            result.ok
              ? { status: "success", response: result.response }
              : { status: "error", message: result.error },
          );
        });
      });
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
    const newRequest = (target?: MoveTarget) => {
      nodeCounter.current += 1;
      const id = `new-${nodeCounter.current}`;
      const request: RequestNode = {
        kind: "request",
        id,
        name: "New Request",
        method: "GET",
        url: "",
        body: "",
        config: {},
      };
      const placement = derivePlacement(target);
      if (placement.parentId !== null) {
        setExpandedFolderIds((current) =>
          new Set(current).add(placement.parentId!),
        );
      }
      autoNameIds.current.add(id);
      setIsSettingsActive(false);
      setIsEditorActive(false);
      setOpenRequestIds((current) => [...current, id]);
      setActiveRequestId(id);
      setSelectedNodeId(id);
      setRenamingNodeId(null);
      setFocusUrlNonce((nonce) => nonce + 1);
      persistTree(
        insertNode(tree, placement.parentId, placement.index, request),
        "create",
      );
    };

    const persistTree = (next: TreeNode[], failLabel: string) => {
      setTree(next);
      const persist = onTreeChangeRef.current;
      if (!persist) {
        showToastRef.current("Saved");
        return;
      }
      persist(next).then((result) => {
        if (result.ok) {
          showToastRef.current("Saved");
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

    const saveActiveRequest = () => {
      if (activeRequestId === null) {
        return;
      }
      if (!dirtyRequestIds.has(activeRequestId)) {
        return;
      }
      const patch = requestOverrides.get(activeRequestId) as
        | RequestPatch
        | undefined;
      if (!patch) {
        return;
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
        saveEnv(setDotenvValue(envText, target.key, value));
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
      processEnv,
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
      openEnvEditor: () => {
        setIsSettingsActive(false);
        setEditTarget({ kind: "env" });
        setIsEditorActive(true);
      },
      closeEditor: requestCloseEditor,
      saveNodeConfig,
      saveRequestNode,
      saveActiveRequest,
      dirtyRequestIds,
      saveEnv,
      setTokenValue,
      registerActiveEditor,
      saveActiveEditor: () => {
        if (!activeEditor) {
          return false;
        }
        activeEditor.save();
        return true;
      },
      editorDirty,
      pendingClose,
      popupCanSave,
      requestCloseRequest,
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
      sendRequest,
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
