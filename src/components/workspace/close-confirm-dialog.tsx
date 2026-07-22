import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pziel/pureui";
import { useWorkspace } from "@/components/workspace/workspace-context";

export function CloseConfirmDialog() {
  const {
    pendingClose,
    popupCanSave,
    dirtyRequestIds,
    openRequestIds,
    requestsById,
    confirmPendingClose,
    savePendingClose,
    cancelPendingClose,
  } = useWorkspace();

  const isOpen = pendingClose !== null;

  const describe = () => {
    if (pendingClose === null) {
      return "";
    }
    if (pendingClose.kind === "one") {
      return `${requestsById.get(pendingClose.id)?.name ?? pendingClose.id} has unsaved changes.`;
    }
    if (pendingClose.kind === "editor") {
      return "This editor has unsaved changes.";
    }
    if (pendingClose.kind === "others") {
      const count = openRequestIds.filter(
        (id) => id !== pendingClose.id && dirtyRequestIds.has(id),
      ).length;
      const noun = count === 1 ? "request has" : "requests have";
      return `${count} other open ${noun} unsaved changes.`;
    }
    return `${openRequestIds.filter((id) => dirtyRequestIds.has(id)).length} open requests have unsaved changes.`;
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) {
          cancelPendingClose();
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            {describe()}
            {!popupCanSave && " Fix the invalid JSON to save, or discard."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            disabled={!popupCanSave}
            onClick={savePendingClose}
          >
            Save
          </Button>
          <Button type="button" variant="outline" onClick={cancelPendingClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmPendingClose}
          >
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
