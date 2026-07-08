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
  type DraftTab,
  type PanelGroupKey,
  type PanelLayout,
  type Settings,
  type SettingsStore,
  type ThemeColors,
  type ThemeMode,
} from "@/lib/settings/settings";
import type { ShortcutActionId } from "@/lib/shortcuts/registry";

type SettingsContextValue = {
  settings: Settings;
  saveLayout: (group: PanelGroupKey, layout: PanelLayout) => void;
  saveConsoleHidden: (hidden: boolean) => void;
  saveSidebarHidden: (hidden: boolean) => void;
  saveWindowFullscreen: (fullscreen: boolean) => void;
  saveWorkspacePath: (path: string) => void;
  saveShortcut: (id: ShortcutActionId, hotkey: string) => void;
  resetShortcut: (id: ShortcutActionId) => void;
  saveOpenTabs: (
    openRequestIds: string[],
    activeRequestId: string | null,
  ) => void;
  saveDraftTabs: (draftTabs: DraftTab[]) => void;
  saveActiveEnvironment: (name: string | null) => void;
  saveThemeMode: (mode: ThemeMode) => void;
  saveThemeColors: (colors: ThemeColors) => void;
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

  // Compose off the CURRENT state (functional updater) so two saves in the same
  // tick chain instead of both reading the pre-render value and clobbering each
  // other (e.g. saveOpenTabs + saveDraftTabs on draft create). store.save runs
  // inside the updater with the freshly-composed value.
  const update = useCallback(
    (mutate: (base: Settings) => Settings) => {
      setSettings((current) => {
        const next = mutate(current ?? DEFAULT_SETTINGS);
        store.save(next);
        return next;
      });
    },
    [store],
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

  const saveWindowFullscreen = useCallback(
    (fullscreen: boolean) =>
      update((base) => ({ ...base, windowFullscreen: fullscreen })),
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

  const saveDraftTabs = useCallback(
    (draftTabs: DraftTab[]) =>
      update((base) => ({ ...base, draftTabs })),
    [update],
  );

  const saveActiveEnvironment = useCallback(
    (name: string | null) =>
      update((base) => ({
        ...base,
        activeEnvironment: name ?? undefined,
      })),
    [update],
  );

  const saveThemeMode = useCallback(
    (mode: ThemeMode) =>
      update((base) => ({ ...base, theme: { ...base.theme, mode } })),
    [update],
  );

  const saveThemeColors = useCallback(
    (colors: ThemeColors) =>
      update((base) => ({ ...base, theme: { ...base.theme, colors } })),
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
            saveWindowFullscreen,
            saveWorkspacePath,
            saveShortcut,
            resetShortcut,
            saveOpenTabs,
            saveDraftTabs,
            saveActiveEnvironment,
            saveThemeMode,
            saveThemeColors,
          },
    [
      settings,
      saveLayout,
      saveConsoleHidden,
      saveSidebarHidden,
      saveWindowFullscreen,
      saveWorkspacePath,
      saveShortcut,
      resetShortcut,
      saveOpenTabs,
      saveDraftTabs,
      saveActiveEnvironment,
      saveThemeMode,
      saveThemeColors,
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
