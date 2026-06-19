import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_SETTINGS,
  type PanelGroupKey,
  type PanelLayout,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";
import type { ShortcutActionId } from "@/lib/shortcuts/registry";

type SettingsContextValue = {
  settings: Settings;
  saveLayout: (group: PanelGroupKey, layout: PanelLayout) => void;
  saveConsoleHidden: (hidden: boolean) => void;
  saveSidebarHidden: (hidden: boolean) => void;
  saveWorkspacePath: (path: string) => void;
  saveShortcut: (id: ShortcutActionId, hotkey: string) => void;
  resetShortcut: (id: ShortcutActionId) => void;
  saveOpenTabs: (openRequestIds: string[], activeRequestId: string | null) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

type SettingsProviderProps = {
  store: SettingsStore;
  children: ReactNode;
};

export function SettingsProvider({ store, children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let isMounted = true;
    store.load().then((loaded) => {
      if (isMounted) {
        setSettings(loaded);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [store]);

  const update = useCallback(
    (mutate: (base: Settings) => Settings) => {
      const next = mutate(settings ?? DEFAULT_SETTINGS);
      setSettings(next);
      store.save(next);
    },
    [settings, store],
  );

  const saveLayout = useCallback(
    (group: PanelGroupKey, layout: PanelLayout) =>
      update((base) => ({
        ...base,
        layouts: { ...base.layouts, [group]: layout },
      })),
    [update],
  );

  const saveConsoleHidden = useCallback(
    (hidden: boolean) => update((base) => ({ ...base, consoleHidden: hidden })),
    [update],
  );

  const saveSidebarHidden = useCallback(
    (hidden: boolean) => update((base) => ({ ...base, sidebarHidden: hidden })),
    [update],
  );

  const saveWorkspacePath = useCallback(
    (path: string) => update((base) => ({ ...base, workspacePath: path })),
    [update],
  );

  const saveShortcut = useCallback(
    (id: ShortcutActionId, hotkey: string) =>
      update((base) => ({
        ...base,
        shortcuts: { ...base.shortcuts, [id]: hotkey },
      })),
    [update],
  );

  const resetShortcut = useCallback(
    (id: ShortcutActionId) =>
      update((base) => ({
        ...base,
        shortcuts: Object.fromEntries(
          Object.entries(base.shortcuts).filter(([key]) => key !== id),
        ),
      })),
    [update],
  );

  const saveOpenTabs = useCallback(
    (openRequestIds: string[], activeRequestId: string | null) =>
      update((base) => ({ ...base, openRequestIds, activeRequestId })),
    [update],
  );

  const value = useMemo<SettingsContextValue | null>(
    () =>
      settings === null
        ? null
        : {
            settings,
            saveLayout,
            saveConsoleHidden,
            saveSidebarHidden,
            saveWorkspacePath,
            saveShortcut,
            resetShortcut,
            saveOpenTabs,
          },
    [
      settings,
      saveLayout,
      saveConsoleHidden,
      saveSidebarHidden,
      saveWorkspacePath,
      saveShortcut,
      resetShortcut,
      saveOpenTabs,
    ],
  );

  if (value === null) {
    return null;
  }

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return value;
}
