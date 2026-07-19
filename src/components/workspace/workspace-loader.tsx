import { useEffect, useState } from "react";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { useSettings } from "@/lib/settings/settings-context";
import { deserialize, serialize } from "@/lib/workspace/disk-format";
import {
  listEnvironmentNames,
  parseDotenv,
  type ProcessEnv,
} from "@/lib/workspace/environment";
import type { WorkspaceFs } from "@/lib/workspace/fs";
import type { FolderPicker } from "@/lib/workspace/folder-picker";
import type { BrunoCollectionReader } from "@/lib/bruno/reader";
import type { PostmanCollectionReader } from "@/lib/postman/reader";
import type { OpenapiReader } from "@/lib/openapi/reader";
import type { BrunoExportWriter } from "@/lib/bruno/writer";
import type { PostmanExportWriter } from "@/lib/postman/writer";
import type { OpenapiExportWriter } from "@/lib/openapi/writer";
import type { HttpClient } from "@/lib/http/model";
import type { ScriptRunner } from "@/lib/scripts/model";
import type { TreeNode } from "@/lib/workspace/model";

type LoadState =
  | { status: "loading" }
  | { status: "empty" }
  | {
      status: "loaded";
      tree: TreeNode[];
      consoleLines: string[];
      workspaceName: string;
      processEnv: ProcessEnv;
      envText: string;
    };

const DEFAULT_WORKSPACE_NAME = "Workspace";

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
  reader,
  postmanReader,
  openapiReader,
  brunoWriter,
  postmanWriter,
  openapiWriter,
  httpClient,
  scriptRunner,
}: {
  fs: WorkspaceFs;
  picker?: FolderPicker;
  reader?: BrunoCollectionReader;
  postmanReader?: PostmanCollectionReader;
  openapiReader?: OpenapiReader;
  brunoWriter?: BrunoExportWriter;
  postmanWriter?: PostmanExportWriter;
  openapiWriter?: OpenapiExportWriter;
  httpClient?: HttpClient;
  scriptRunner?: ScriptRunner;
}) {
  const { settings, saveOpenTabs, saveDraftTabs, saveActiveEnvironment } =
    useSettings();
  const workspacePath = settings.workspacePath;
  const [state, setState] = useState<LoadState>(
    workspacePath ? { status: "loading" } : { status: "empty" },
  );
  const [initialOpenRequestIds] = useState(settings.openRequestIds);
  const [initialDraftTabs] = useState(settings.draftTabs);

  useEffect(() => {
    if (!workspacePath) {
      return;
    }
    let isMounted = true;
    // A configured workspacePath that is fresh/unreadable/not-yet-a-workspace
    // still mounts a WRITABLE empty workspace (an empty tree + onTreeChange wired
    // to this path), so the first folder/request the user creates bootstraps the
    // dir on disk. Read-only empty is reserved for when NO path is set at all.
    const freshWorkspace = (): LoadState => ({
      status: "loaded",
      tree: [],
      consoleLines: [],
      workspaceName: DEFAULT_WORKSPACE_NAME,
      processEnv: {},
      envText: "",
    });
    fs.readWorkspace(workspacePath).then((read) => {
      if (!isMounted) {
        return;
      }
      if (!read.ok) {
        setState(freshWorkspace());
        return;
      }
      const parsed = deserialize(read.files);
      if (!parsed.ok) {
        setState(freshWorkspace());
        return;
      }
      const consoleLines = parsed.skipped.map(
        (path) => `[workspace] skipped malformed file: ${path}`,
      );
      setState({
        status: "loaded",
        tree: parsed.tree,
        consoleLines,
        workspaceName: readWorkspaceName(read.files["purerequest.workspace.json"]),
        processEnv: parseDotenv(read.files[".env"] ?? ""),
        envText: read.files[".env"] ?? "",
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
      <WorkspaceProvider
        tree={[]}
        consoleLines={EMPTY_CONSOLE_LINES}
        httpClient={httpClient}
        scriptRunner={scriptRunner}
        brunoWriter={brunoWriter}
        postmanWriter={postmanWriter}
        openapiWriter={openapiWriter}
        workspaceName={DEFAULT_WORKSPACE_NAME}
      >
        <WorkspaceLayout
          picker={picker}
          reader={reader}
          postmanReader={postmanReader}
          openapiReader={openapiReader}
        />
      </WorkspaceProvider>
    );
  }

  const workspaceName = state.workspaceName;
  const knownEnvironment = listEnvironmentNames(state.tree).includes(
    settings.activeEnvironment ?? "",
  )
    ? settings.activeEnvironment
    : undefined;
  return (
    <WorkspaceProvider
      key={workspacePath}
      tree={state.tree}
      consoleLines={state.consoleLines}
      initialOpenRequestIds={initialOpenRequestIds}
      initialDraftTabs={initialDraftTabs}
      onTabsChange={saveOpenTabs}
      onDraftTabsChange={saveDraftTabs}
      onTreeChange={(tree) =>
        fs.writeWorkspace(workspacePath ?? "", serialize(tree, workspaceName))
      }
      httpClient={httpClient}
      scriptRunner={scriptRunner}
      brunoWriter={brunoWriter}
      postmanWriter={postmanWriter}
      openapiWriter={openapiWriter}
      workspaceName={workspaceName}
      processEnv={state.processEnv}
      envText={state.envText}
      activeEnvironment={knownEnvironment}
      onActiveEnvironmentChange={saveActiveEnvironment}
      onEnvChange={(text) => fs.writeEnv(workspacePath ?? "", text)}
    >
      <WorkspaceLayout
        picker={picker}
        reader={reader}
        postmanReader={postmanReader}
        openapiReader={openapiReader}
      />
    </WorkspaceProvider>
  );
}
