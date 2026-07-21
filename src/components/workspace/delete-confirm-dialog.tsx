import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { countDescendants } from "@/lib/workspace/tree-edit";
import { findNode } from "@/lib/workspace/tree-locate";

export function DeleteConfirmDialog() {
  const { pendingDelete, tree, confirmPendingDelete, cancelPendingDelete } =
    useWorkspace();

  const nodes =
    pendingDelete !== null
      ? pendingDelete.ids
          .map((id) => findNode(tree, id))
          .filter((node): node is NonNullable<typeof node> => node !== null)
      : [];
  // A single target names itself; a multi-selection is summarized by count.
  const title =
    nodes.length === 1
      ? `Delete "${nodes[0].name}"?`
      : `Delete ${nodes.length} items?`;
  // Descendants across every target plus the targets themselves (each target is
  // itself a removed item), so the count matches what actually disappears.
  const count =
    nodes.reduce((total, node) => total + countDescendants(node), 0) +
    nodes.length;

  return (
    <Dialog
      open={pendingDelete !== null}
      onOpenChange={(next) => {
        if (!next) {
          cancelPendingDelete();
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Removes {count} {count === 1 ? "item" : "items"}. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={cancelPendingDelete}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmPendingDelete}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
