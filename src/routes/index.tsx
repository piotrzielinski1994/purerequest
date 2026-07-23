import { createNoopFolderPicker, type FolderPicker } from "@pziel/pureui";
import { createRoute } from "@tanstack/react-router";
import { useState } from "react";
import { WorkspaceLoader } from "@/components/workspace/workspace-loader";
import type { BrunoCollectionReader } from "@/lib/bruno/reader";
import {
  createNoopBrunoReader,
  createTauriBrunoReader,
} from "@/lib/bruno/reader";
import type { BrunoExportWriter } from "@/lib/bruno/writer";
import {
  createNoopBrunoWriter,
  createTauriBrunoWriter,
} from "@/lib/bruno/writer";
import { createFakeHttpClient } from "@/lib/http/fake-client";
import type { HttpClient } from "@/lib/http/model";
import { createTauriHttpClient } from "@/lib/http/tauri-client";
import type { OpenapiReader } from "@/lib/openapi/reader";
import {
  createNoopOpenapiReader,
  createTauriOpenapiReader,
} from "@/lib/openapi/reader";
import type { OpenapiExportWriter } from "@/lib/openapi/writer";
import {
  createNoopOpenapiWriter,
  createTauriOpenapiWriter,
} from "@/lib/openapi/writer";
import type { PostmanCollectionReader } from "@/lib/postman/reader";
import {
  createNoopPostmanReader,
  createTauriPostmanReader,
} from "@/lib/postman/reader";
import type { PostmanExportWriter } from "@/lib/postman/writer";
import {
  createNoopPostmanWriter,
  createTauriPostmanWriter,
} from "@/lib/postman/writer";
import { isDevBrowser } from "@/lib/runtime/environment";
import { createQuickJsScriptRunner } from "@/lib/scripts/quickjs-runner";
import {
  DEMO_RESPONSE,
  DEMO_WORKSPACE_PATH,
  demoFiles,
} from "@/lib/workspace/demo-seed";
import type { WorkspaceFs } from "@/lib/workspace/fs";
import { createInMemoryWorkspaceFs } from "@/lib/workspace/in-memory-fs";
import { createTauriFolderPicker } from "@/lib/workspace/tauri-folder-picker";
import { createTauriWorkspaceFs } from "@/lib/workspace/tauri-fs";
import { rootRoute } from "@/routes/__root";

type Adapters = {
  fs: WorkspaceFs;
  picker: FolderPicker;
  reader: BrunoCollectionReader;
  postmanReader: PostmanCollectionReader;
  openapiReader: OpenapiReader;
  brunoWriter: BrunoExportWriter;
  postmanWriter: PostmanExportWriter;
  openapiWriter: OpenapiExportWriter;
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
      openapiWriter: createNoopOpenapiWriter(),
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
    openapiWriter: createTauriOpenapiWriter(),
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
      openapiWriter={adapters.openapiWriter}
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
