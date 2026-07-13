import type { RequestNode, TreeNode } from "@/lib/workspace/model";
import type { EffectiveConfig } from "@/lib/workspace/resolve";
import type { MoveTarget } from "@/lib/workspace/move";
import type { HttpRequest, ResponseState } from "@/lib/http/model";
import type {
  BodyMode,
  ConfigScope,
  HttpMethod,
  KeyValue,
} from "@/lib/workspace/model";
import type { RequestPatch } from "@/lib/workspace/update-request";
import type { TokenTarget } from "@/components/workspace/url-token";
import type { CurlParseResult } from "@/lib/curl/parse-curl";
import type { BrunoFileMap } from "@/lib/bruno/bruno-to-tree";
import type { PostmanFileMap } from "@/lib/postman/postman-to-tree";

export type RequestOverride = Partial<
  Pick<RequestNode, "name" | "url" | "method" | "body" | "params" | "config">
>;

// `config`/`body`/`params` are objects, so an override is only "dirty" when it
// differs from the saved value by VALUE (a re-created-but-equal object must clear
// the dot). `name`/`url`/`method` are primitives, compared by `!==`.
export function isOverrideFieldDirty(
  field: keyof RequestOverride,
  overrideValue: unknown,
  baseValue: unknown,
): boolean {
  if (overrideValue === undefined) {
    return false;
  }
  if (field === "config" || field === "body" || field === "params") {
    return JSON.stringify(overrideValue) !== JSON.stringify(baseValue);
  }
  return overrideValue !== baseValue;
}

export function indexRequests(nodes: TreeNode[]): Map<string, RequestNode> {
  const flatten = (node: TreeNode): RequestNode[] =>
    node.kind === "request" ? [node] : node.children.flatMap(flatten);
  return new Map(
    nodes.flatMap(flatten).map((request) => [request.id, request]),
  );
}

export function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  next.add(id);
  return next;
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

// "Go to source" from a path-param token: which Params sub-tab to open. `nonce`
// re-fires the same jump (the consumer keys its render on identity).
export type ParamsReveal = { nonce: number; subTab: "path" | "query" } | null;

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

export type PendingDelete = { ids: string[] } | null;

// How a click adjusts the sidebar multi-selection: a plain click replaces it, a
// Cmd/Ctrl click toggles one row, a Shift click selects the range from the
// anchor to the clicked row over the visible (expanded) rows.
export type SelectMode = "replace" | "toggle" | "range";

export type RequestTab =
  | "vars"
  | "auth"
  | "headers"
  | "params"
  | "body"
  | "script"
  | "settings";
export type ResponseTab = "response" | "headers" | "timing" | "protocols";

export type WorkspaceContextValue = {
  tree: TreeNode[];
  // Whether edits persist to disk (a workspacePath is configured). False only
  // when no workspace is set at all - the sidebar then shows a read-only hint
  // instead of a create-your-first-thing prompt.
  isWorkspaceWritable: boolean;
  consoleLines: string[];
  expandedFolderIds: Set<string>;
  selectedNodeId: string | null;
  // The sidebar multi-selection (node ids). Empty until the user Cmd/Shift-clicks
  // (a plain click keeps it in sync with the single `selectedNodeId`).
  selectedIds: Set<string>;
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
  // Folder Settings JSON save: persists config + the whole env-color map together
  // (the doc merges colors into `environments`).
  saveFolderConfigDoc: (
    id: string,
    config: ConfigScope,
    colors: Record<string, string>,
  ) => void;
  // Live (non-draft) write of one env's border color onto a folder; null clears it.
  setFolderEnvColor: (
    folderId: string,
    env: string,
    color: string | null,
  ) => void;
  // The color that recolors the shell --border for the active env + active tab:
  // the active folder editor's folder, else the active request, resolved against
  // the active environment. Null when no active env or no color in scope.
  activeAccentColor: string | null;
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
  paramsReveal: ParamsReveal;
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
  focusNode: (id: string) => void;
  selectInTree: (id: string, mode: SelectMode) => void;
  clearSelection: () => void;
  setActiveRequest: (id: string) => void;
  reorderRequests: (nextIds: string[]) => void;
  moveNode: (dragId: string, target: MoveTarget) => void;
  moveNodes: (dragIds: string[], target: MoveTarget) => void;
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
  setRequestGraphqlQuery: (id: string, query: string) => void;
  setRequestGraphqlVariables: (id: string, variables: string) => void;
  setRequestUrl: (id: string, url: string) => void;
  setRequestMethod: (id: string, method: HttpMethod) => void;
  setRequestPathParams: (id: string, pathParams: KeyValue[]) => void;
  setRequestQueryParams: (id: string, params: KeyValue[]) => void;
  setRequestConfig: (id: string, config: ConfigScope) => void;
  sendRequest: (id: string) => void;
  cancelRequest: (id: string) => void;
  setRequestTab: (tab: RequestTab) => void;
  setResponseTab: (tab: ResponseTab) => void;
  openSettings: () => void;
  closeSettings: () => void;
  newRequest: (target?: MoveTarget) => void;
  resolveActiveWire: () => HttpRequest | null;
  isCodeGenOpen: boolean;
  openCodeGen: () => void;
  closeCodeGen: () => void;
  isCurlImportOpen: boolean;
  openCurlImport: () => void;
  closeCurlImport: () => void;
  importCurl: (text: string) => CurlParseResult;
  importBruno: (files: BrunoFileMap, name: string) => void;
  importPostman: (files: PostmanFileMap, name: string) => void;
  importOpenapi: (text: string, name: string) => void;
  focusUrlNonce: number;
};
