import type { UpdateToastSink } from "@pziel/pureui";
import { toast } from "sonner";

// One stable id keeps the whole flow on a single sonner toast: present ->
// progress label -> Installing… -> error all update in place, and an update
// toast never stacks.
const UPDATE_TOAST_ID = "app-update";

// Adapts sonner to pureui's toast-lib-agnostic UpdateToastSink port. present()
// opens the persistent (duration: Infinity) closeButton toast with the "Update
// now" action; each later step reuses UPDATE_TOAST_ID so the one toast is
// updated in place. pureui owns the flow + the "Downloading… NN%" label; sonner
// semantics (stable id, Infinity, closeButton, Installing…, error toast) stay
// app-owned.
export function createSonnerUpdateToastSink(): UpdateToastSink {
  return {
    present: ({ message, onUpdateNow }) => {
      toast(message, {
        id: UPDATE_TOAST_ID,
        duration: Infinity,
        closeButton: true,
        action: { label: "Update now", onClick: onUpdateNow },
      });
      return {
        progress: (label) =>
          toast(label, { id: UPDATE_TOAST_ID, duration: Infinity }),
        installing: () =>
          toast("Installing…", { id: UPDATE_TOAST_ID, duration: Infinity }),
        failed: () =>
          toast.error("Update failed", {
            id: UPDATE_TOAST_ID,
            duration: Infinity,
          }),
      };
    },
  };
}
