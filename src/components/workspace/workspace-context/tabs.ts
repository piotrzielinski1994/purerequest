import { SETTINGS_TAB_ID } from "@/components/workspace/pane-tabs";
import type { WorkspaceInternals } from "@/components/workspace/workspace-context/types";

export type TabsApi = {
  closeRequest: (id: string) => void;
  closeAllRequests: () => void;
  closeOthers: (id: string) => void;
  reorderRequests: (nextIds: string[]) => void;
  setActiveRequest: (id: string) => void;
  requestCloseRequest: (id: string) => void;
  requestCloseOthers: (id: string) => void;
  requestCloseAll: () => void;
  openSettings: () => void;
  closeSettings: () => void;
};

export function createTabs(internals: WorkspaceInternals): TabsApi {
  const {
    openRequestIds,
    activeRequestId,
    dirtyRequestIds,
    preSettingsActiveId,
    setOpenRequestIds,
    setActiveRequestId,
    setRequestOverrides,
    setDraftRequests,
    setResponseStates,
    setIsEditorActive,
    setPendingClose,
  } = internals;

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

  const reorderRequests = (nextIds: string[]) =>
    setOpenRequestIds((current) => {
      const isPermutation =
        nextIds.length === current.length &&
        nextIds.every((id) => current.includes(id));
      return isPermutation ? nextIds : current;
    });

  const setActiveRequest = (id: string) => {
    setIsEditorActive(false);
    setActiveRequestId(id);
  };

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

  const openSettings = () => {
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
  };

  // Esc DEACTIVATES settings (returns to the workspace) but leaves the tab
  // open - it is closed only via its X / Mod+W / close-all, like a request.
  const closeSettings = () => {
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
  };

  return {
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
  };
}
