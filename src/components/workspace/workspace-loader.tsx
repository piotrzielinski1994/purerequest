import type { FolderPicker } from "@pziel/pureui";
import { useEffect, useState } from "react";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { logMessage } from "@/lib/logging/tauri-log-sink";
import type { BrunoCollectionReader } from "@/lib/bruno/reader";
import type { BrunoExportWriter } from "@/lib/bruno/writer";
import type { HttpClient } from "@/lib/http/model";
import type { LogStream } from "@/lib/logging/log-stream";
import type { OpenapiReader } from "@/lib/openapi/reader";
import type { OpenapiExportWriter } from "@/lib/openapi/writer";
import type { PostmanCollectionReader } from "@/lib/postman/reader";
import type { PostmanExportWriter } from "@/lib/postman/writer";
import type { ScriptRunner } from "@/lib/scripts/model";
import { useSettings } from "@/lib/settings/settings-context";
import { deserialize, serialize } from "@/lib/workspace/disk-format";
import {
  listEnvironmentNames,
  type ProcessEnv,
  parseDotenv,
} from "@/lib/workspace/environment";
import type { WorkspaceFs } from "@/lib/workspace/fs";
import type { TreeNode } from "@/lib/workspace/model";

type LoadState =
  | { status: "loading"; workspacePath: string; logLines: string[] }
  | { status: "empty" }
  | {
      status: "loaded";
      tree: TreeNode[];
      logLines: string[];
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

const EMPTY_LOG_LINES = [
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
  logStream,
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
  logStream?: LogStream;
}) {
  const { settings, saveOpenTabs, saveDraftTabs, saveActiveEnvironment } =
    useSettings();
  const workspacePath = settings.workspacePath;
  const [state, setState] = useState<LoadState>(() =>
    workspacePath
      ? {
          status: "loading",
          workspacePath,
          logLines: [`[workspace] loading ${workspacePath}...`],
        }
      : { status: "empty" },
  );
  const [initialOpenRequestIds] = useState(settings.openRequestIds);
  const [initialDraftTabs] = useState(settings.draftTabs);

  useEffect(() => {
    if (!workspacePath) {
      setState({ status: "empty" });
      return;
    }
    // Immediate feedback: show loading indicator + log before the async read.
    setState({
      status: "loading",
      workspacePath,
      logLines: [`[workspace] loading ${workspacePath}...`],
    });
    void logMessage("info", `[workspace] loading ${workspacePath}...`);
    const start = performance.now();
    let isMounted = true;
    // A configured workspacePath that is fresh/unreadable/not-yet-a-workspace
    // still mounts a WRITABLE empty workspace (an empty tree + onTreeChange wired
    // to this path), so the first folder/request the user creates bootstraps the
    // dir on disk. Read-only empty is reserved for when NO path is set at all.
    const freshWorkspace = (logLines: string[]): LoadState => ({
      status: "loaded",
      tree: [],
      logLines,
      workspaceName: DEFAULT_WORKSPACE_NAME,
      processEnv: {},
      envText: "",
    });
    fs.readWorkspace(workspacePath).then((read) => {
      if (!isMounted) {
        return;
      }
      const elapsed = Math.round(performance.now() - start);
      if (!read.ok) {
        void logMessage(
          "warn",
          `[workspace] failed to read workspace: ${read.error} (${elapsed}ms)`,
        );
        setState(
          freshWorkspace([
            `[workspace] failed to read workspace: ${read.error} (${elapsed}ms)`,
            `[workspace] initialized empty workspace at ${workspacePath}`,
          ]),
        );
        return;
      }
      const parsed = deserialize(read.files);
      if (!parsed.ok) {
        void logMessage(
          "warn",
          `[workspace] failed to parse workspace: ${parsed.error} (${elapsed}ms)`,
        );
        setState(
          freshWorkspace([
            `[workspace] failed to parse workspace: ${parsed.error} (${elapsed}ms)`,
            `[workspace] initialized empty workspace at ${workspacePath}`,
          ]),
        );
        return;
      }
      const skipped = parsed.skipped.map(
        (path) => `[workspace] skipped malformed file: ${path}`,
      );
      const fileCount = Object.keys(read.files).length;
      void logMessage(
        "info",
        `[workspace] loaded ${workspacePath} (${fileCount} files, ${elapsed}ms)`,
      );
      setState({
        status: "loaded",
        tree: parsed.tree,
        logLines: [
          `[workspace] loaded ${workspacePath} (${fileCount} files, ${elapsed}ms)`,
          ...skipped,
        ],
        workspaceName: readWorkspaceName(
          read.files["purerequest.workspace.json"],
        ),
        processEnv: parseDotenv(read.files[".env"] ?? ""),
        envText: read.files[".env"] ?? "",
      });
    });
    return () => {
      isMounted = false;
    };
  }, [fs, workspacePath]);

  if (state.status === "loading") {
    return (
      <WorkspaceProvider
        key={`${state.workspacePath}::loading`}
        tree={[]}
        isLoading
        initialLogLines={state.logLines}
        httpClient={httpClient}
        scriptRunner={scriptRunner}
        brunoWriter={brunoWriter}
        postmanWriter={postmanWriter}
        openapiWriter={openapiWriter}
        workspaceName={DEFAULT_WORKSPACE_NAME}
        logStream={logStream}
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

  if (state.status === "empty") {
    return (
      <WorkspaceProvider
        tree={[]}
        initialLogLines={EMPTY_LOG_LINES}
        httpClient={httpClient}
        scriptRunner={scriptRunner}
        brunoWriter={brunoWriter}
        postmanWriter={postmanWriter}
        openapiWriter={openapiWriter}
        workspaceName={DEFAULT_WORKSPACE_NAME}
        logStream={logStream}
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
      initialLogLines={state.logLines}
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
      logStream={logStream}
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
