import {
  SHORTCUT_ACTIONS,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";
import { safeNormalize } from "@/lib/shortcuts/resolve";
import type { RequestNode } from "@/lib/workspace/model";
import type { MoveTarget } from "@/lib/workspace/move";

// A session "new request" tab kept in app settings (NOT the workspace on disk) so
// an unsaved draft survives an app restart. `placement` is where it promotes into
// the tree when saved.
export type DraftTab = {
  id: string;
  request: RequestNode;
  placement: MoveTarget;
};

export type PanelLayout = Record<string, number>;

export type PanelGroupKey = "workspace" | "main" | "content";

export type ThemeMode = "light" | "dark" | "system";

export type AppTokenName =
  | "background"
  | "foreground"
  | "card"
  | "card-foreground"
  | "popover"
  | "popover-foreground"
  | "primary"
  | "primary-foreground"
  | "secondary"
  | "secondary-foreground"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "destructive"
  | "border"
  | "input"
  | "ring";

export type EditorTokenName =
  | "caret"
  | "selection"
  | "gutter"
  | "keyword"
  | "string"
  | "number"
  | "property"
  | "comment"
  | "invalid";

// Sparse per-mode override maps. An absent key means "use the built-in default
// for that token in that mode" (defaults live in src/lib/theme/theme-defaults).
export type ThemeColorOverrides = {
  tokens: Partial<Record<AppTokenName, string>>;
  editor: Partial<Record<EditorTokenName, string>>;
};

export type ThemeColors = {
  light: ThemeColorOverrides;
  dark: ThemeColorOverrides;
};

// The complete (non-sparse) built-in default set: every token is present in both
// modes. Assignable to ThemeColors (a full record satisfies the partial), so it
// flows into applyDefaults/diffOverrides unchanged.
export type FullThemeColorOverrides = {
  tokens: Record<AppTokenName, string>;
  editor: Record<EditorTokenName, string>;
};

export type FullThemeColors = {
  light: FullThemeColorOverrides;
  dark: FullThemeColorOverrides;
};

export type ThemeSettings = {
  mode: ThemeMode;
  colors: ThemeColors;
};

export type Settings = {
  version: 1;
  layouts: Partial<Record<PanelGroupKey, PanelLayout>>;
  consoleHidden: boolean;
  sidebarHidden: boolean;
  windowFullscreen: boolean;
  shortcuts: ShortcutOverrides;
  openRequestIds: string[];
  activeRequestId: string | null;
  // Unsaved "new request" draft tabs (kept across restarts; not on disk).
  draftTabs: DraftTab[];
  theme: ThemeSettings;
  workspacePath?: string;
  activeEnvironment?: string;
};

const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];

function emptyThemeColors(): ThemeColors {
  return { light: { tokens: {}, editor: {} }, dark: { tokens: {}, editor: {} } };
}

export type SettingsStore = {
  load: () => Promise<Settings>;
  save: (settings: Settings) => Promise<void>;
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  layouts: {},
  consoleHidden: false,
  sidebarHidden: false,
  windowFullscreen: false,
  shortcuts: {},
  openRequestIds: [],
  activeRequestId: null,
  draftTabs: [],
  theme: { mode: "system", colors: emptyThemeColors() },
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

function mergeOpenRequestIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((id): id is string => typeof id === "string");
}

function isMoveTarget(value: unknown): value is MoveTarget {
  return (
    isRecord(value) &&
    (value.parentId === null || typeof value.parentId === "string") &&
    typeof value.index === "number"
  );
}

// A draft is tolerant-validated: only entries with a string id, a request-shaped
// object, and a MoveTarget placement survive. A malformed entry is dropped rather
// than failing the whole load.
function mergeDraftTabs(value: unknown): DraftTab[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is DraftTab => {
    if (!isRecord(entry)) {
      return false;
    }
    const request = entry.request;
    return (
      typeof entry.id === "string" &&
      isRecord(request) &&
      request.kind === "request" &&
      typeof request.id === "string" &&
      isMoveTarget(entry.placement)
    );
  });
}

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.includes(value as ThemeMode);
}

const APP_TOKEN_NAMES = new Set<string>([
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
]);

const EDITOR_TOKEN_NAMES = new Set<string>([
  "caret",
  "selection",
  "gutter",
  "keyword",
  "string",
  "number",
  "property",
  "comment",
  "invalid",
]);

function mergeTokenMap<K extends string>(
  value: unknown,
  known: Set<string>,
): Partial<Record<K, string>> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.entries(value).reduce<Partial<Record<K, string>>>(
    (acc, [key, val]) => {
      if (!known.has(key) || typeof val !== "string") {
        return acc;
      }
      return { ...acc, [key]: val };
    },
    {},
  );
}

function mergeOverrides(value: unknown): ThemeColorOverrides {
  if (!isRecord(value)) {
    return { tokens: {}, editor: {} };
  }
  return {
    tokens: mergeTokenMap<AppTokenName>(value.tokens, APP_TOKEN_NAMES),
    editor: mergeTokenMap<EditorTokenName>(value.editor, EDITOR_TOKEN_NAMES),
  };
}

function mergeThemeColors(value: unknown): ThemeColors {
  if (!isRecord(value)) {
    return emptyThemeColors();
  }
  return {
    light: mergeOverrides(value.light),
    dark: mergeOverrides(value.dark),
  };
}

function mergeTheme(defaults: ThemeSettings, partial: unknown): ThemeSettings {
  if (!isRecord(partial)) {
    return defaults;
  }
  return {
    mode: isThemeMode(partial.mode) ? partial.mode : defaults.mode,
    colors: mergeThemeColors(partial.colors),
  };
}

export function mergeSettings(defaults: Settings, partial: unknown): Settings {
  if (!isRecord(partial)) {
    return defaults;
  }
  const openRequestIds = mergeOpenRequestIds(partial.openRequestIds);
  const draftTabs = mergeDraftTabs(partial.draftTabs);
  const draftIds = new Set(draftTabs.map((draft) => draft.id));
  const activeRequestId =
    typeof partial.activeRequestId === "string" &&
    (openRequestIds.includes(partial.activeRequestId) ||
      draftIds.has(partial.activeRequestId))
      ? partial.activeRequestId
      : null;
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
    windowFullscreen:
      typeof partial.windowFullscreen === "boolean"
        ? partial.windowFullscreen
        : defaults.windowFullscreen,
    shortcuts: mergeShortcuts(partial.shortcuts),
    openRequestIds,
    activeRequestId,
    draftTabs,
    theme: mergeTheme(defaults.theme, partial.theme),
    workspacePath:
      typeof partial.workspacePath === "string"
        ? partial.workspacePath
        : defaults.workspacePath,
    activeEnvironment:
      typeof partial.activeEnvironment === "string"
        ? partial.activeEnvironment
        : defaults.activeEnvironment,
  };
}
