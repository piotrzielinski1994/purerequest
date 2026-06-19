import { LazyStore } from "@tauri-apps/plugin-store";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";
import type { ShortcutOverrides } from "@/lib/shortcuts/registry";

const SETTINGS_FILE = "settings.json";
const KEYMAP_FILE = "keymap.json";
const SETTINGS_KEY = "settings";
const SHORTCUTS_KEY = "shortcuts";

export function createTauriSettingsStore(): SettingsStore {
  const settingsStore = new LazyStore(SETTINGS_FILE);
  const keymapStore = new LazyStore(KEYMAP_FILE);

  const load = async (): Promise<Settings> => {
    const persistedSettings = await settingsStore
      .get<unknown>(SETTINGS_KEY)
      .catch(() => undefined);
    const persistedShortcuts = await keymapStore
      .get<unknown>(SHORTCUTS_KEY)
      .catch(() => undefined);
    const base = mergeSettings(DEFAULT_SETTINGS, persistedSettings);
    return mergeSettings(base, { ...base, shortcuts: persistedShortcuts });
  };

  const save = async (settings: Settings): Promise<void> => {
    const { shortcuts, ...withoutShortcuts } = settings;
    await persist(settingsStore, SETTINGS_KEY, {
      ...withoutShortcuts,
      shortcuts: {},
    });
    await persist(keymapStore, SHORTCUTS_KEY, shortcuts);
  };

  return { load, save };
}

async function persist(
  store: LazyStore,
  key: string,
  value: Settings | ShortcutOverrides,
): Promise<void> {
  await store
    .set(key, value)
    .then(() => store.save())
    .catch((error) => {
      console.warn(`Failed to persist ${key}`, error);
    });
}
