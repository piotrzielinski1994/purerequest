import { useEffect, useState } from "react";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { useSettings } from "@/lib/settings/settings-context";
import { deserialize, serialize } from "@/lib/workspace/disk-format";
import type { WorkspaceFs } from "@/lib/workspace/fs";
import type { FolderPicker } from "@/lib/workspace/folder-picker";
import type { TreeNode } from "@/lib/workspace/model";

type LoadState =
  | { status: "loading" }
  | { status: "empty" }
  | {
      status: "loaded";
      tree: TreeNode[];
      consoleLines: string[];
      workspaceName: string;
    };

function readWorkspaceName(manifestRaw: string | undefined): string {
  if (manifestRaw === undefined) {
    return "Workspace";
  }
  try {
    const parsed = JSON.parse(manifestRaw) as { name?: string };
    return parsed.name ?? "Workspace";
  } catch {
    return "Workspace";
  }
}

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
  const { settings, saveOpenTabs } = useSettings();
  const workspacePath = settings.workspacePath;
  const [state, setState] = useState<LoadState>(
    workspacePath ? { status: "loading" } : { status: "empty" },
  );
  const [initialOpenRequestIds] = useState(settings.openRequestIds);

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
      setState({
        status: "loaded",
        tree: parsed.tree,
        consoleLines,
        workspaceName: readWorkspaceName(read.files["requi.workspace.json"]),
      });
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

  const workspaceName = state.workspaceName;
  return (
    <WorkspaceProvider
      key={workspacePath}
      tree={state.tree}
      consoleLines={state.consoleLines}
      initialOpenRequestIds={initialOpenRequestIds}
      onTabsChange={saveOpenTabs}
      onTreeChange={(tree) =>
        fs.writeWorkspace(workspacePath ?? "", serialize(tree, workspaceName))
      }
    >
      <WorkspaceLayout picker={picker} />
    </WorkspaceProvider>
  );
}
