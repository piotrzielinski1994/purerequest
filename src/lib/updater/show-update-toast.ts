import type { ToastHandle } from "@/components/ui/toast";
import type { UpdateInfo } from "@/lib/updater/update-controller";

async function runUpdate(update: UpdateInfo, handle: ToastHandle) {
  handle.clearAction();
  handle.update("Downloading… 0%");
  await update.downloadAndInstall((pct) =>
    handle.update(`Downloading… ${pct}%`),
  );
  await update.relaunch();
}

// Shows the persistent "Update available" toast whose action downloads/installs
// the update and relaunches. Shared by the startup checker and the Settings
// Updates section so both drive the same flow.
export function showUpdateToast(
  show: (
    message: string,
    options?: {
      persistent?: boolean;
      action?: { label: string; onClick: () => void };
    },
  ) => ToastHandle,
  update: UpdateInfo,
): ToastHandle {
  const handle = show(`Update available: ${update.version}`, {
    persistent: true,
    action: {
      label: "Update now",
      onClick: () => {
        runUpdate(update, handle);
      },
    },
  });
  return handle;
}
