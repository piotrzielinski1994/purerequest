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
import {
  createTauriPostmanReader,
  createNoopPostmanReader,
} from "@/lib/postman/reader";
import {
  createTauriOpenapiReader,
  createNoopOpenapiReader,
} from "@/lib/openapi/reader";
import {
  createTauriBrunoWriter,
  createNoopBrunoWriter,
} from "@/lib/bruno/writer";
import {
  createTauriPostmanWriter,
  createNoopPostmanWriter,
} from "@/lib/postman/writer";
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
import type { PostmanCollectionReader } from "@/lib/postman/reader";
import type { OpenapiReader } from "@/lib/openapi/reader";
import type { BrunoExportWriter } from "@/lib/bruno/writer";
import type { PostmanExportWriter } from "@/lib/postman/writer";
import type { HttpClient } from "@/lib/http/model";
import { rootRoute } from "@/routes/__root";

type Adapters = {
  fs: WorkspaceFs;
  picker: FolderPicker;
  reader: BrunoCollectionReader;
  postmanReader: PostmanCollectionReader;
  openapiReader: OpenapiReader;
  brunoWriter: BrunoExportWriter;
  postmanWriter: PostmanExportWriter;
  httpClient: HttpClient;
};

function createAdapters(): Adapters {
  if (isDevBrowser()) {
    return {
      fs: createInMemoryWorkspaceFs({ [DEMO_WORKSPACE_PATH]: demoFiles() }),
      picker: createNoopFolderPicker(),
      reader: createNoopBrunoReader(),
      postmanReader: createNoopPostmanReader(),
      openapiReader: createNoopOpenapiReader(),
      brunoWriter: createNoopBrunoWriter(),
      postmanWriter: createNoopPostmanWriter(),
      httpClient: createFakeHttpClient({ ok: true, response: DEMO_RESPONSE }),
    };
  }
  return {
    fs: createTauriWorkspaceFs(),
    picker: createTauriFolderPicker(),
    reader: createTauriBrunoReader(),
    postmanReader: createTauriPostmanReader(),
    openapiReader: createTauriOpenapiReader(),
    brunoWriter: createTauriBrunoWriter(),
    postmanWriter: createTauriPostmanWriter(),
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
      postmanReader={adapters.postmanReader}
      openapiReader={adapters.openapiReader}
      brunoWriter={adapters.brunoWriter}
      postmanWriter={adapters.postmanWriter}
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
