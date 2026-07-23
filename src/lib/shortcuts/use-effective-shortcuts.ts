import { useSettings } from "@/lib/settings/settings-context";
import type { ShortcutActionId } from "@/lib/shortcuts/registry";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

// App-side settings-read seam for the hoisted useActionHotkeys hook: reads the
// user's shortcut overrides and resolves them to the effective binding map.
// useSettings() throws outside a SettingsProvider - behavior unchanged.
export function useEffectiveShortcuts(): Record<ShortcutActionId, string[]> {
  const { settings } = useSettings();
  return resolveShortcuts(settings.shortcuts);
}
