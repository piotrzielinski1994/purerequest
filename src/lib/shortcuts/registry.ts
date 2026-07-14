export type ShortcutActionId =
  | "open-settings"
  | "close-settings"
  | "toggle-console"
  | "toggle-sidebar"
  | "toggle-theme"
  | "next-request"
  | "prev-request"
  | "close-request"
  | "close-other-requests"
  | "close-all-requests"
  | "new-request"
  | "new-folder"
  | "duplicate-request"
  | "rename-node"
  | "delete-node"
  | "open-workspace"
  | "send-request"
  | "save-active-editor"
  | "copy-as-code"
  | "import-curl"
  | "import-bruno"
  | "import-postman"
  | "import-openapi"
  | "open-command-palette"
  | "open-quick-open"
  | "collapse-all-folders"
  | "expand-all-folders"
  | "tree-nav-down"
  | "tree-nav-up"
  | "tree-nav-first"
  | "tree-nav-last"
  | "tree-expand"
  | "tree-collapse"
  | "tree-activate"
  | "tree-extend-down"
  | "tree-extend-up"
  | "tree-move-down"
  | "tree-move-up"
  | "tree-outdent"
  | "tree-nest"
  | "open-context-menu";

export type ShortcutAction = {
  id: ShortcutActionId;
  name: string;
  description: string;
  defaultHotkey: string;
};

export type ShortcutOverrides = Partial<Record<ShortcutActionId, string[]>>;

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
    id: "toggle-theme",
    name: "Toggle theme",
    description: "Cycle the theme: light, dark, system.",
    defaultHotkey: "Mod+Shift+L",
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
    id: "close-other-requests",
    name: "Close other request tabs",
    description: "Close every open request tab except the active one.",
    defaultHotkey: "Mod+Alt+W",
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
    id: "copy-as-code",
    name: "Copy as code",
    description:
      "Copy the active request as generated client code (curl, fetch, ...).",
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
    id: "import-postman",
    name: "Import Postman collection",
    description: "Pick a Postman collection JSON file to import as a new folder.",
    defaultHotkey: "Mod+Shift+P",
  },
  {
    id: "import-openapi",
    name: "Import OpenAPI document",
    description: "Pick an OpenAPI 3.x JSON/YAML document to import as a new folder.",
    defaultHotkey: "Mod+Shift+O",
  },
  {
    id: "open-command-palette",
    name: "Open command palette",
    description: "Search and run any action from a command list.",
    defaultHotkey: "Mod+K",
  },
  {
    id: "open-quick-open",
    name: "Quick open request",
    description: "Fuzzy-search and jump to any request or folder by name.",
    defaultHotkey: "Mod+P",
  },
  {
    id: "collapse-all-folders",
    name: "Collapse all folders",
    description: "Collapse every folder in the sidebar collection tree.",
    defaultHotkey: "Mod+Shift+[",
  },
  {
    id: "expand-all-folders",
    name: "Expand all folders",
    description: "Expand every folder in the sidebar collection tree.",
    defaultHotkey: "Mod+Shift+]",
  },
  {
    id: "tree-nav-down",
    name: "Tree: next row",
    description: "Move focus + selection to the next visible sidebar row.",
    defaultHotkey: "ArrowDown",
  },
  {
    id: "tree-nav-up",
    name: "Tree: previous row",
    description: "Move focus + selection to the previous visible sidebar row.",
    defaultHotkey: "ArrowUp",
  },
  {
    id: "tree-nav-first",
    name: "Tree: first row",
    description: "Move focus + selection to the first visible sidebar row.",
    defaultHotkey: "Home",
  },
  {
    id: "tree-nav-last",
    name: "Tree: last row",
    description: "Move focus + selection to the last visible sidebar row.",
    defaultHotkey: "End",
  },
  {
    id: "tree-expand",
    name: "Tree: expand / into folder",
    description:
      "Expand a collapsed folder, or move focus to its first child if open.",
    defaultHotkey: "ArrowRight",
  },
  {
    id: "tree-collapse",
    name: "Tree: collapse / to parent",
    description:
      "Collapse an expanded folder, or move focus to the parent folder.",
    defaultHotkey: "ArrowLeft",
  },
  {
    id: "tree-activate",
    name: "Tree: open request / toggle folder",
    description: "Open the focused request tab, or toggle the focused folder.",
    defaultHotkey: "Enter",
  },
  {
    id: "tree-extend-down",
    name: "Tree: extend selection down",
    description: "Extend the sidebar selection to the next visible row.",
    defaultHotkey: "Shift+ArrowDown",
  },
  {
    id: "tree-extend-up",
    name: "Tree: extend selection up",
    description: "Extend the sidebar selection to the previous visible row.",
    defaultHotkey: "Shift+ArrowUp",
  },
  {
    id: "tree-move-down",
    name: "Tree: move node down",
    description: "Reorder the focused node down among its siblings.",
    defaultHotkey: "Alt+ArrowDown",
  },
  {
    id: "tree-move-up",
    name: "Tree: move node up",
    description: "Reorder the focused node up among its siblings.",
    defaultHotkey: "Alt+ArrowUp",
  },
  {
    id: "tree-outdent",
    name: "Tree: outdent node",
    description: "Move the focused node out to its parent's level.",
    defaultHotkey: "Alt+ArrowLeft",
  },
  {
    id: "tree-nest",
    name: "Tree: nest node into folder above",
    description:
      "Move the focused node into the immediately-preceding sibling folder.",
    defaultHotkey: "Alt+ArrowRight",
  },
  {
    id: "open-context-menu",
    name: "Open context menu",
    description:
      "Open the right-click menu of the focused sidebar row or request tab.",
    defaultHotkey: "Shift+F10",
  },
];
