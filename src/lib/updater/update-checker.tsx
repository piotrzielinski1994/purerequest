import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import type { UpdateController } from "@/lib/updater/update-controller";
import { showUpdateToast } from "@/lib/updater/show-update-toast";

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
        if (update !== null) {
          showUpdateToast(show, update);
        }
      })
      .catch(() => {});
  }, [controller, show]);

  return null;
}
