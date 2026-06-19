import { useEffect, useState } from "react";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { useSettings } from "@/lib/settings/settings-context";
import { deserialize } from "@/lib/workspace/disk-format";
import type { WorkspaceFs } from "@/lib/workspace/fs";
import type { FolderPicker } from "@/lib/workspace/folder-picker";
import type { TreeNode } from "@/lib/workspace/model";

type LoadState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "loaded"; tree: TreeNode[]; consoleLines: string[] };

const EMPTY_CONSOLE_LINES = [
  '[workspace] Set "workspacePath" in settings.json to an exported workspace folder.',
];

export function WorkspaceLoader({
  fs,
  picker,
}: {
  fs: WorkspaceFs;
  picker?: FolderPicker;
}) {
  const { settings } = useSettings();
  const workspacePath = settings.workspacePath;
  const [state, setState] = useState<LoadState>(
    workspacePath ? { status: "loading" } : { status: "empty" },
  );

  useEffect(() => {
    if (!workspacePath) {
      return;
    }
    let isMounted = true;
    fs.readWorkspace(workspacePath).then((read) => {
      if (!isMounted) {
        return;
      }
      if (!read.ok) {
        setState({ status: "empty" });
        return;
      }
      const parsed = deserialize(read.files);
      if (!parsed.ok) {
        setState({ status: "empty" });
        return;
      }
      const consoleLines = parsed.skipped.map(
        (path) => `[workspace] skipped malformed file: ${path}`,
      );
      setState({ status: "loaded", tree: parsed.tree, consoleLines });
    });
    return () => {
      isMounted = false;
    };
  }, [fs, workspacePath]);

  if (state.status === "loading") {
    return null;
  }

  if (state.status === "empty") {
    return (
      <WorkspaceProvider tree={[]} consoleLines={EMPTY_CONSOLE_LINES}>
        <WorkspaceLayout picker={picker} />
      </WorkspaceProvider>
    );
  }

  return (
    <WorkspaceProvider tree={state.tree} consoleLines={state.consoleLines}>
      <WorkspaceLayout picker={picker} />
    </WorkspaceProvider>
  );
}
