import type { TauriWindow, WindowController } from "@pziel/pureui";
import { getCurrentWindow } from "@tauri-apps/api/window";

// The Tauri-backed WindowController factory. The port type + the noop fallback
// live in @pziel/pureui (Tauri-free); this factory is the one piece that must
// stay in the app because it imports the Tauri window API.
export function createWindowController(
  getWindow: () => TauriWindow = getCurrentWindow,
): WindowController {
  const win = getWindow();
  return {
    isFullscreen: () => win.isFullscreen(),
    setFullscreen: (fullscreen) => win.setFullscreen(fullscreen),
    onFullscreenChange: async (listener) => {
      let last = await win.isFullscreen();
      return win.onResized(() => {
        win.isFullscreen().then((current) => {
          if (current === last) {
            return;
          }
          last = current;
          listener(current);
        });
      });
    },
  };
}
