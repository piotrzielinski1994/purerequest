export type ShortcutActionId =
  | "open-settings"
  | "close-settings"
  | "toggle-console"
  | "toggle-sidebar"
  | "next-request"
  | "prev-request"
  | "close-request"
  | "new-request"
  | "open-workspace";

export type ShortcutAction = {
  id: ShortcutActionId;
  name: string;
  description: string;
  defaultHotkey: string;
};

export type ShortcutOverrides = Partial<Record<ShortcutActionId, string>>;

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  {
    id: "open-settings",
    name: "Open settings",
    description: "Go to the settings page.",
    defaultHotkey: "Mod+Shift+S",
  },
  {
    id: "close-settings",
    name: "Back to workspace",
    description: "Leave settings and return to the workspace.",
    defaultHotkey: "Escape",
  },
  {
    id: "toggle-console",
    name: "Toggle console",
    description: "Show or hide the console pane.",
    defaultHotkey: "Mod+J",
  },
  {
    id: "toggle-sidebar",
    name: "Toggle sidebar",
    description: "Show or hide the collection sidebar.",
    defaultHotkey: "Mod+B",
  },
  {
    id: "next-request",
    name: "Next request tab",
    description: "Activate the next open request tab.",
    defaultHotkey: "Control+Tab",
  },
  {
    id: "prev-request",
    name: "Previous request tab",
    description: "Activate the previous open request tab.",
    defaultHotkey: "Control+Shift+Tab",
  },
  {
    id: "close-request",
    name: "Close request tab",
    description: "Close the active request tab.",
    defaultHotkey: "Mod+W",
  },
  {
    id: "new-request",
    name: "New request",
    description: "Open a new draft request tab.",
    defaultHotkey: "Mod+T",
  },
  {
    id: "open-workspace",
    name: "Open workspace",
    description: "Pick a workspace folder to load.",
    defaultHotkey: "Mod+O",
  },
];
