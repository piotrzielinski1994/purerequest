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
  type SettingsSection,
  type SettingsStore,
  type ThemeColors,
  type ThemeMode,
} from "@/lib/settings/settings";
import type { ShortcutActionId } from "@/lib/shortcuts/registry";
import { resolveShortcuts, safeNormalize } from "@/lib/shortcuts/resolve";

type SettingsContextValue = {
  settings: Settings;
  saveLayout: (group: PanelGroupKey, layout: PanelLayout) => void;
  saveConsoleHidden: (hidden: boolean) => void;
  saveSidebarHidden: (hidden: boolean) => void;
  saveWindowFullscreen: (fullscreen: boolean) => void;
  saveWorkspacePath: (path: string) => void;
  addShortcut: (id: ShortcutActionId, hotkey: string) => void;
  removeShortcut: (id: ShortcutActionId, hotkey: string) => void;
  replaceShortcut: (
    id: ShortcutActionId,
    oldHotkey: string,
    newHotkey: string,
  ) => void;
  resetShortcut: (id: ShortcutActionId) => void;
  saveOpenTabs: (
    openRequestIds: string[],
    activeRequestId: string | null,
  ) => void;
  saveDraftTabs: (draftTabs: DraftTab[]) => void;
  saveActiveEnvironment: (name: string | null) => void;
  saveSettingsSection: (section: SettingsSection) => void;
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

  // Append a binding to the action's effective list (seeded from the registry
  // default when no override exists yet), normalized + de-duplicated. An invalid
  // hotkey or a duplicate is a no-op.
  const addShortcut = useCallback(
    (id: ShortcutActionId, hotkey: string) =>
      update((base) => {
        const normalized = safeNormalize(hotkey);
        if (normalized === null) {
          return base;
        }
        const current = resolveShortcuts(base.shortcuts)[id];
        if (current.includes(normalized)) {
          return base;
        }
        return {
          ...base,
          shortcuts: { ...base.shortcuts, [id]: [...current, normalized] },
        };
      }),
    [update],
  );

  // Drop one binding from the action's effective list. Removing the last one
  // leaves an empty list - the action is disabled (distinct from "no override").
  const removeShortcut = useCallback(
    (id: ShortcutActionId, hotkey: string) =>
      update((base) => {
        const normalized = safeNormalize(hotkey) ?? hotkey;
        const current = resolveShortcuts(base.shortcuts)[id];
        return {
          ...base,
          shortcuts: {
            ...base.shortcuts,
            [id]: current.filter((binding) => binding !== normalized),
          },
        };
      }),
    [update],
  );

  // Swap one binding for another in place (preserving its slot), normalized +
  // de-duplicated. A no-op when the new hotkey is invalid or the old one is not
  // actually bound to the action.
  const replaceShortcut = useCallback(
    (id: ShortcutActionId, oldHotkey: string, newHotkey: string) =>
      update((base) => {
        const normalizedNew = safeNormalize(newHotkey);
        if (normalizedNew === null) {
          return base;
        }
        const normalizedOld = safeNormalize(oldHotkey) ?? oldHotkey;
        const current = resolveShortcuts(base.shortcuts)[id];
        if (!current.includes(normalizedOld)) {
          return base;
        }
        const swapped = current.map((binding) =>
          binding === normalizedOld ? normalizedNew : binding,
        );
        return {
          ...base,
          shortcuts: {
            ...base.shortcuts,
            [id]: swapped.filter(
              (binding, index) => swapped.indexOf(binding) === index,
            ),
          },
        };
      }),
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

  const saveSettingsSection = useCallback(
    (section: SettingsSection) =>
      update((base) => ({ ...base, settingsSection: section })),
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
            addShortcut,
            removeShortcut,
            replaceShortcut,
            resetShortcut,
            saveOpenTabs,
            saveDraftTabs,
            saveActiveEnvironment,
            saveSettingsSection,
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
      addShortcut,
      removeShortcut,
      replaceShortcut,
      resetShortcut,
      saveOpenTabs,
      saveDraftTabs,
      saveActiveEnvironment,
      saveSettingsSection,
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

// The current shortcut overrides, or an empty map when no SettingsProvider is
// mounted. Lets keyboard-shortcut consumers (sidebar tree, tab bar) resolve
// effective bindings and fall back to registry defaults outside a provider,
// instead of hard-crashing - the shortcuts are a progressive enhancement.
export function useShortcutOverrides(): Settings["shortcuts"] {
  return useContext(SettingsContext)?.settings.shortcuts ?? {};
}
