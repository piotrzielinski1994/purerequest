import { normalizeHotkey, validateHotkey } from "@tanstack/hotkeys";
import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";

const ACTION_IDS = new Set<string>(SHORTCUT_ACTIONS.map((action) => action.id));

function isShortcutActionId(value: string): value is ShortcutActionId {
  return ACTION_IDS.has(value);
}

// Keys TanStack flags as "Unknown" but that are real, matchable keys we bind
// (the ContextMenu / Menu key is a valid physical key for opening a row menu).
const ALLOWED_UNKNOWN_KEYS = new Set(["ContextMenu"]);

export function safeNormalize(hotkey: string): string | null {
  if (typeof hotkey !== "string" || hotkey.length === 0) {
    return null;
  }
  const result = validateHotkey(hotkey);
  const hasUnknownKey = result.warnings.some(
    (warning) =>
      warning.includes("Unknown key") &&
      !ALLOWED_UNKNOWN_KEYS.has(hotkey.split("+").pop() ?? ""),
  );
  if (!result.valid || hasUnknownKey) {
    return null;
  }
  return normalizeHotkey(hotkey);
}

export function resolveShortcuts(
  overrides: ShortcutOverrides,
): Record<ShortcutActionId, string> {
  const overlay =
    typeof overrides === "object" && overrides !== null ? overrides : {};
  return SHORTCUT_ACTIONS.reduce(
    (acc, action) => {
      const candidate = overlay[action.id];
      const normalized =
        typeof candidate === "string" ? safeNormalize(candidate) : null;
      acc[action.id] = normalized ?? action.defaultHotkey;
      return acc;
    },
    {} as Record<ShortcutActionId, string>,
  );
}

export function findConflict(
  hotkey: string,
  forAction: ShortcutActionId,
  effective: Record<ShortcutActionId, string>,
): ShortcutActionId | null {
  const target = safeNormalize(hotkey);
  if (target === null) {
    return null;
  }
  const owner = (Object.keys(effective) as ShortcutActionId[]).find((id) => {
    if (id === forAction || !isShortcutActionId(id)) {
      return false;
    }
    return safeNormalize(effective[id]) === target;
  });
  return owner ?? null;
}
