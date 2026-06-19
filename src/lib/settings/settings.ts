import {
  SHORTCUT_ACTIONS,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";
import { safeNormalize } from "@/lib/shortcuts/resolve";

export type PanelLayout = Record<string, number>;

export type PanelGroupKey = "workspace" | "main" | "content";

export type Settings = {
  version: 1;
  layouts: Partial<Record<PanelGroupKey, PanelLayout>>;
  consoleHidden: boolean;
  sidebarHidden: boolean;
  shortcuts: ShortcutOverrides;
  workspacePath?: string;
};

export type SettingsStore = {
  load: () => Promise<Settings>;
  save: (settings: Settings) => Promise<void>;
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  layouts: {},
  consoleHidden: false,
  sidebarHidden: false,
  shortcuts: {},
};

const GROUP_KEYS: PanelGroupKey[] = ["workspace", "main", "content"];

const ACTION_IDS = new Set<string>(SHORTCUT_ACTIONS.map((action) => action.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPanelLayout(value: unknown): value is PanelLayout {
  return (
    isRecord(value) &&
    Object.values(value).every((size) => typeof size === "number")
  );
}

function mergeLayouts(partial: unknown): Settings["layouts"] {
  if (!isRecord(partial)) {
    return DEFAULT_SETTINGS.layouts;
  }
  return GROUP_KEYS.reduce<Settings["layouts"]>((acc, key) => {
    const layout = partial[key];
    return isPanelLayout(layout) ? { ...acc, [key]: layout } : acc;
  }, {});
}

function mergeShortcuts(partial: unknown): ShortcutOverrides {
  if (!isRecord(partial)) {
    return {};
  }
  return Object.entries(partial).reduce<ShortcutOverrides>(
    (acc, [id, value]) => {
      if (!ACTION_IDS.has(id) || typeof value !== "string") {
        return acc;
      }
      const normalized = safeNormalize(value);
      return normalized === null ? acc : { ...acc, [id]: normalized };
    },
    {},
  );
}

export function mergeSettings(defaults: Settings, partial: unknown): Settings {
  if (!isRecord(partial)) {
    return defaults;
  }
  return {
    version: defaults.version,
    layouts: mergeLayouts(partial.layouts),
    consoleHidden:
      typeof partial.consoleHidden === "boolean"
        ? partial.consoleHidden
        : defaults.consoleHidden,
    sidebarHidden:
      typeof partial.sidebarHidden === "boolean"
        ? partial.sidebarHidden
        : defaults.sidebarHidden,
    shortcuts: mergeShortcuts(partial.shortcuts),
    workspacePath:
      typeof partial.workspacePath === "string"
        ? partial.workspacePath
        : defaults.workspacePath,
  };
}
