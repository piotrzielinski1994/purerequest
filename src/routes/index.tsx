import { useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { WorkspaceLoader } from "@/components/workspace/workspace-loader";
import { createTauriWorkspaceFs } from "@/lib/workspace/tauri-fs";
import { createInMemoryWorkspaceFs } from "@/lib/workspace/in-memory-fs";
import {
  createTauriFolderPicker,
  createNoopFolderPicker,
} from "@/lib/workspace/folder-picker";
import {
  createTauriBrunoReader,
  createNoopBrunoReader,
} from "@/lib/bruno/reader";
import { createTauriHttpClient } from "@/lib/http/tauri-client";
import { createFakeHttpClient } from "@/lib/http/fake-client";
import { createQuickJsScriptRunner } from "@/lib/scripts/quickjs-runner";
import { isDevBrowser } from "@/lib/runtime/environment";
import {
  DEMO_RESPONSE,
  DEMO_WORKSPACE_PATH,
  demoFiles,
} from "@/lib/workspace/demo-seed";
import type { WorkspaceFs } from "@/lib/workspace/fs";
import type { FolderPicker } from "@/lib/workspace/folder-picker";
import type { BrunoCollectionReader } from "@/lib/bruno/reader";
import type { HttpClient } from "@/lib/http/model";
import { rootRoute } from "@/routes/__root";

type Adapters = {
  fs: WorkspaceFs;
  picker: FolderPicker;
  reader: BrunoCollectionReader;
  httpClient: HttpClient;
};

function createAdapters(): Adapters {
  if (isDevBrowser()) {
    return {
      fs: createInMemoryWorkspaceFs({ [DEMO_WORKSPACE_PATH]: demoFiles() }),
      picker: createNoopFolderPicker(),
      reader: createNoopBrunoReader(),
      httpClient: createFakeHttpClient({ ok: true, response: DEMO_RESPONSE }),
    };
  }
  return {
    fs: createTauriWorkspaceFs(),
    picker: createTauriFolderPicker(),
    reader: createTauriBrunoReader(),
    httpClient: createTauriHttpClient(),
  };
}

function HomePage() {
  const [adapters] = useState(createAdapters);
  const [scriptRunner] = useState(createQuickJsScriptRunner);

  return (
    <WorkspaceLoader
      fs={adapters.fs}
      picker={adapters.picker}
      reader={adapters.reader}
      httpClient={adapters.httpClient}
      scriptRunner={scriptRunner}
    />
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
