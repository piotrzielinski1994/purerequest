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
  accentColorFor,
  environmentNamesForScope,
  resolveConfig,
  resolveProcessEnv,
  resolveProcessEnvProvenance,
} from "@/lib/workspace/resolve";
import type { MoveTarget } from "@/lib/workspace/move";
import type { DraftTab } from "@/lib/settings/settings";
import { insertNode } from "@/lib/workspace/tree-edit";
import { SETTINGS_TAB_ID } from "@/components/workspace/pane-tabs";
import type { WriteResult } from "@/lib/workspace/fs";
import { createFakeHttpClient } from "@/lib/http/fake-client";
import type { HttpClient, ResponseState } from "@/lib/http/model";
import type { ScriptRunner } from "@/lib/scripts/model";
import { createFakeScriptRunner } from "@/lib/scripts/fake-runner";
import type { ConfigScope, KeyValue } from "@/lib/workspace/model";
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
import { createTabs } from "@/components/workspace/workspace-context/tabs";
import { createRequestEdits } from "@/components/workspace/workspace-context/request-edits";
import { createTreeCrud } from "@/components/workspace/workspace-context/tree-crud";
import { createSend } from "@/components/workspace/workspace-context/send";

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
    const {
      closeRequest,
      closeAllRequests,
      closeOthers,
      reorderRequests,
      setActiveRequest,
      requestCloseRequest,
      requestCloseOthers,
      requestCloseAll,
      openSettings,
      closeSettings,
    } = createTabs(internals);

    const {
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
      saveActiveRequest,
      saveRequestNode,
      saveActive,
    } = createRequestEdits(internals, persistTree);

    const {
      createRequestNode,
      newRequest,
      newFolder,
      duplicateRequest,
      beginRename,
      commitRename,
      cancelRename,
      requestDeleteNode,
      confirmPendingDelete,
      cancelPendingDelete,
      moveNode,
      moveNodes,
    } = createTreeCrud(internals, { persistTree, selectSingle, closeRequest });
    const {
      sendRequest,
      cancelRequest,
      resolveActiveWire,
      openCodeGen,
      closeCodeGen,
    } = createSend(internals, { persistTree, saveEnv });

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
      saveActive,
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
      setActiveRequest,
      reorderRequests,
      moveNode,
      moveNodes,
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
      openSettings,
      closeSettings,
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
