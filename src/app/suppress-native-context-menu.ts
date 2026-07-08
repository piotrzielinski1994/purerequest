// Suppress the WebView's native right-click menu across the whole app (the
// "Look Up / Translate / Inspect Element / Services" browser menu). Desktop apps
// (Postman/Bruno) don't show it; our own Radix context menus open independently
// via their trigger's own handler, so preventing the default here does not block
// them (preventDefault stops the native menu, not event propagation/Radix).
export function installContextMenuSuppressor(target: EventTarget): () => void {
  const onContextMenu = (event: Event) => {
    event.preventDefault();
  };
  target.addEventListener("contextmenu", onContextMenu);
  return () => target.removeEventListener("contextmenu", onContextMenu);
}
