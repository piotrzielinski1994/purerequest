import { createContext, useContext } from "react";
import { matchesKeyboardEvent, type Hotkey } from "@tanstack/hotkeys";

// The configurable "open context menu" shortcut (default Shift+F10) and the
// dedicated ContextMenu key are the keyboard equivalents of a right-click.
// Browsers map them to a native `contextmenu` event on the focused element on
// real hardware, but headless Chromium and jsdom do not synthesize it - so a
// focusable element inside a Radix ContextMenuTrigger stays unreachable by
// keyboard unless we dispatch the event ourselves. This fires a `contextmenu`
// MouseEvent at the element's center so the Trigger opens. `binding` is the
// user's effective `open-context-menu` hotkey; the ContextMenu key always works.
export function openContextMenuOnKey(
  event: React.KeyboardEvent,
  binding: string,
): boolean {
  const isMenuKey =
    event.key === "ContextMenu" ||
    matchesKeyboardEvent(event.nativeEvent, binding as Hotkey);
  if (!isMenuKey) {
    return false;
  }
  const el = event.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  event.preventDefault();
  el.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
    }),
  );
  return true;
}

// The keyboard-navigation seam the sidebar tree provides to its rows: which row
// is in the roving Tab order, a ref registry so a nav command can imperatively
// focus the newly-selected row, and the key dispatcher each row calls onKeyDown.
export type TreeNavState = {
  rovingId: string | null;
  contextMenuBinding: string;
  registerRow: (id: string, el: HTMLElement | null) => void;
  handleKeyDown: (focusedId: string, event: React.KeyboardEvent) => void;
};

const TreeNavContext = createContext<TreeNavState>({
  rovingId: null,
  contextMenuBinding: "Shift+F10",
  registerRow: () => {},
  handleKeyDown: () => {},
});

export const TreeNavProvider = TreeNavContext.Provider;

export function useTreeNav(): TreeNavState {
  return useContext(TreeNavContext);
}
