import { toast } from "sonner";
import type { TreeNode } from "@/lib/workspace/model";
import { parseDotenv } from "@/lib/workspace/environment";
import type { WorkspaceInternals } from "@/components/workspace/workspace-context/types";

export type PersistApi = {
  persistTree: (next: TreeNode[], failLabel: string, silent?: boolean) => void;
  saveEnv: (text: string, silent?: boolean) => void;
};

export function createPersist(internals: WorkspaceInternals): PersistApi {
  const {
    setTree,
    setEnvText,
    setProcessEnv,
    setConsoleLines,
    onTreeChangeRef,
    onEnvChangeRef,
  } = internals;

  // Optimistic save: the in-memory tree updates synchronously and we confirm
  // ("Saved") immediately, without awaiting the disk write - so Cmd+S never
  // mules behind the round-trip. The write still runs in the background; only a
  // REJECTED write surfaces (a "Save failed" toast + console line) so the user
  // is never silently left with an unpersisted change. `silent` suppresses the
  // success toast for background persists (e.g. a script setVar during a send),
  // where a "Saved" confirmation would be noise; the failure toast still fires.
  const persistTree = (next: TreeNode[], failLabel: string, silent = false) => {
    setTree(next);
    const persist = onTreeChangeRef.current;
    if (!silent) {
      toast("Saved");
    }
    if (!persist) {
      return;
    }
    persist(next).then((result) => {
      if (result.ok) {
        return;
      }
      toast(`Save failed: ${result.error}`);
      setConsoleLines((lines) => [
        ...lines,
        `[workspace] failed to persist ${failLabel}: ${result.error}`,
      ]);
    });
  };

  const saveEnv = (text: string, silent = false) => {
    setEnvText(text);
    setProcessEnv(parseDotenv(text));
    const persist = onEnvChangeRef.current;
    if (!persist) {
      if (!silent) {
        toast("Saved");
      }
      return;
    }
    Promise.resolve(persist(text)).then(() => {
      if (!silent) {
        toast("Saved");
      }
    });
  };

  return { persistTree, saveEnv };
}
