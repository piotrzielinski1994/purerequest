import type { TreeNode } from "@/lib/workspace/model";
import { parseDotenv } from "@/lib/workspace/environment";
import type { WorkspaceInternals } from "@/components/workspace/workspace-context/types";

export type PersistApi = {
  persistTree: (next: TreeNode[], failLabel: string) => void;
  saveEnv: (text: string) => void;
};

export function createPersist(internals: WorkspaceInternals): PersistApi {
  const {
    setTree,
    setEnvText,
    setProcessEnv,
    setConsoleLines,
    showToastRef,
    onTreeChangeRef,
    onEnvChangeRef,
  } = internals;

  // Optimistic save: the in-memory tree updates synchronously and we confirm
  // ("Saved") immediately, without awaiting the disk write - so Cmd+S never
  // mules behind the round-trip. The write still runs in the background; only a
  // REJECTED write surfaces (a "Save failed" toast + console line) so the user
  // is never silently left with an unpersisted change.
  const persistTree = (next: TreeNode[], failLabel: string) => {
    setTree(next);
    const persist = onTreeChangeRef.current;
    showToastRef.current("Saved");
    if (!persist) {
      return;
    }
    persist(next).then((result) => {
      if (result.ok) {
        return;
      }
      showToastRef.current(`Save failed: ${result.error}`);
      setConsoleLines((lines) => [
        ...lines,
        `[workspace] failed to persist ${failLabel}: ${result.error}`,
      ]);
    });
  };

  const saveEnv = (text: string) => {
    setEnvText(text);
    setProcessEnv(parseDotenv(text));
    const persist = onEnvChangeRef.current;
    if (!persist) {
      showToastRef.current("Saved");
      return;
    }
    Promise.resolve(persist(text)).then(() => showToastRef.current("Saved"));
  };

  return { persistTree, saveEnv };
}
