import {
  createContext,
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
import {
  resolveConfig,
  type EffectiveConfig,
} from "@/lib/workspace/resolve";
import { moveNode as applyMove, type MoveTarget } from "@/lib/workspace/move";
import type { WriteResult } from "@/lib/workspace/fs";

export type RequestTab =
  | "auth"
  | "headers"
  | "params"
  | "body"
  | "script"
  | "effective";
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
  isSettingsOpen: boolean;
  isSettingsActive: boolean;
  toggleFolder: (id: string) => void;
  selectNode: (id: string) => void;
  setActiveRequest: (id: string) => void;
  reorderRequests: (nextIds: string[]) => void;
  moveNode: (dragId: string, target: MoveTarget) => void;
  closeRequest: (id: string) => void;
  closeAllRequests: () => void;
  setRequestBody: (id: string, body: string) => void;
  setRequestTab: (tab: RequestTab) => void;
  setResponseTab: (tab: ResponseTab) => void;
  openSettings: () => void;
  closeSettings: () => void;
  newRequest: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function indexRequests(nodes: TreeNode[]): Map<string, RequestNode> {
  const flatten = (node: TreeNode): RequestNode[] =>
    node.kind === "request" ? [node] : node.children.flatMap(flatten);
  return new Map(nodes.flatMap(flatten).map((request) => [request.id, request]));
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
}: WorkspaceProviderProps) {
  const [tree, setTree] = useState<TreeNode[]>(initialTree);
  const [consoleLines, setConsoleLines] =
    useState<string[]>(initialConsoleLines);
  const [drafts, setDrafts] = useState<RequestNode[]>([]);
  const [bodyOverrides, setBodyOverrides] = useState<Map<string, string>>(
    () => new Map(),
  );
  const draftCounter = useRef(0);

  const requestsById = useMemo(() => {
    const byId = indexRequests(tree);
    drafts.forEach((draft) => byId.set(draft.id, draft));
    bodyOverrides.forEach((body, id) => {
      const base = byId.get(id);
      if (base) {
        byId.set(id, { ...base, body });
      }
    });
    return byId;
  }, [tree, drafts, bodyOverrides]);

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
  const [openRequestIds, setOpenRequestIds] = useState<string[]>(
    restoredOpenIds,
  );
  const [activeRequestId, setActiveRequestId] = useState<string | null>(
    initialActiveRequestId ?? restoredOpenIds[0] ?? null,
  );
  const [activeRequestTab, setActiveRequestTab] = useState<RequestTab>("params");
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
  const isFirstTabsRender = useRef(true);
  useEffect(() => {
    if (isFirstTabsRender.current) {
      isFirstTabsRender.current = false;
      return;
    }
    const persistableIds = openRequestIds.filter(
      (id) => !id.startsWith("draft-"),
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
      setDrafts((current) => current.filter((draft) => draft.id !== id));
      setBodyOverrides((current) => {
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
      setDrafts([]);
      setBodyOverrides(new Map());
      setIsSettingsOpen(false);
      setIsSettingsActive(false);
    };

    const setRequestBody = (id: string, body: string) => {
      setBodyOverrides((current) => {
        const next = new Map(current);
        next.set(id, body);
        return next;
      });
    };

    const newRequest = () => {
      draftCounter.current += 1;
      const id = `draft-${draftCounter.current}`;
      const draft: RequestNode = {
        kind: "request",
        id,
        name: "Untitled",
        method: "GET",
        url: "",
        body: "",
        config: {},
      };
      setDrafts((current) => [...current, draft]);
      setOpenRequestIds((current) => [...current, id]);
      setIsSettingsActive(false);
      setActiveRequestId(id);
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
          ? resolveConfig(tree, activeRequestId)
          : null,
      isSettingsOpen,
      isSettingsActive,
      toggleFolder: (id) =>
        setExpandedFolderIds((current) => toggleInSet(current, id)),
      selectNode,
      setActiveRequest: (id) => {
        setIsSettingsActive(false);
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
      setRequestBody,
      setRequestTab: setActiveRequestTab,
      setResponseTab: setActiveResponseTab,
      openSettings: () => {
        setIsSettingsOpen(true);
        setIsSettingsActive(true);
      },
      closeSettings: () => {
        setIsSettingsOpen(false);
        setIsSettingsActive(false);
      },
      newRequest,
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
