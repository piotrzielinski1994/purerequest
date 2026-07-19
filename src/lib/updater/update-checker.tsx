import { useEffect, useRef } from "react";
import { useToast, type ToastHandle } from "@/components/ui/toast";
import type {
  UpdateController,
  UpdateInfo,
} from "@/lib/updater/update-controller";

async function runUpdate(update: UpdateInfo, handle: ToastHandle) {
  handle.update("Downloading… 0%");
  await update.downloadAndInstall((pct) => handle.update(`Downloading… ${pct}%`));
  await update.relaunch();
}

// Mount-only bridge (sibling of WindowFullscreenSync): runs one update check on
// mount via the injected controller and, on an available update, shows a
// persistent action toast whose button downloads/installs/relaunches. Renders
// nothing. A failed check is swallowed - the app behaves as if no update exists.
export function UpdateChecker({
  controller,
}: {
  controller: UpdateController;
}) {
  const { show } = useToast();
  const hasChecked = useRef(false);

  useEffect(() => {
    if (hasChecked.current) {
      return;
    }
    hasChecked.current = true;
    controller
      .check()
      .then((update) => {
        if (update === null) {
          return;
        }
        const handle = show(`Update available: ${update.version}`, {
          persistent: true,
          action: {
            label: "Update now",
            onClick: () => {
              runUpdate(update, handle);
            },
          },
        });
      })
      .catch(() => {});
  }, [controller, show]);

  return null;
}
