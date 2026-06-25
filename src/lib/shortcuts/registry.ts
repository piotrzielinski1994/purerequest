export type ShortcutActionId =
  | "open-settings"
  | "close-settings"
  | "toggle-console"
  | "toggle-sidebar"
  | "next-request"
  | "prev-request"
  | "close-request"
  | "close-all-requests"
  | "new-request"
  | "new-folder"
  | "duplicate-request"
  | "rename-node"
  | "delete-node"
  | "open-workspace"
  | "send-request"
  | "save-active-editor"
  | "copy-as-curl"
  | "import-curl"
  | "import-bruno"
  | "open-command-palette";

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
    id: "close-all-requests",
    name: "Close all request tabs",
    description: "Close every open request tab (and the settings tab).",
    defaultHotkey: "Mod+Shift+W",
  },
  {
    id: "new-request",
    name: "New request",
    description: "Create a new request relative to the tree selection.",
    defaultHotkey: "Mod+T",
  },
  {
    id: "new-folder",
    name: "New folder",
    description: "Create a folder relative to the tree selection.",
    defaultHotkey: "Mod+Shift+N",
  },
  {
    id: "duplicate-request",
    name: "Duplicate request",
    description: "Duplicate the selected request.",
    defaultHotkey: "Mod+D",
  },
  {
    id: "rename-node",
    name: "Rename",
    description: "Rename the selected request or folder.",
    defaultHotkey: "F2",
  },
  {
    id: "delete-node",
    name: "Delete",
    description: "Delete the selected request or folder.",
    defaultHotkey: "Mod+Backspace",
  },
  {
    id: "open-workspace",
    name: "Open workspace",
    description: "Pick a workspace folder to load.",
    defaultHotkey: "Mod+O",
  },
  {
    id: "send-request",
    name: "Send request",
    description: "Send the active request and load its response.",
    defaultHotkey: "Mod+Enter",
  },
  {
    id: "save-active-editor",
    name: "Save",
    description: "Save the active config or .env editor.",
    defaultHotkey: "Mod+S",
  },
  {
    id: "copy-as-curl",
    name: "Copy as cURL",
    description: "Copy the active request to the clipboard as a curl command.",
    defaultHotkey: "Mod+Shift+C",
  },
  {
    id: "import-curl",
    name: "Import cURL",
    description: "Paste a curl command to create a new request.",
    defaultHotkey: "Mod+Shift+I",
  },
  {
    id: "import-bruno",
    name: "Import Bruno collection",
    description: "Pick a Bruno collection folder to import as a new folder.",
    defaultHotkey: "Mod+Shift+B",
  },
  {
    id: "open-command-palette",
    name: "Open command palette",
    description: "Search and run any action from a command list.",
    defaultHotkey: "Mod+K",
  },
];
