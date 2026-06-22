import { useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { WorkspaceLoader } from "@/components/workspace/workspace-loader";
import { createTauriWorkspaceFs } from "@/lib/workspace/tauri-fs";
import { createTauriFolderPicker } from "@/lib/workspace/folder-picker";
import { createTauriHttpClient } from "@/lib/http/tauri-client";
import { createQuickJsScriptRunner } from "@/lib/scripts/quickjs-runner";
import { rootRoute } from "@/routes/__root";

function HomePage() {
  const [workspaceFs] = useState(createTauriWorkspaceFs);
  const [picker] = useState(createTauriFolderPicker);
  const [httpClient] = useState(createTauriHttpClient);
  const [scriptRunner] = useState(createQuickJsScriptRunner);

  return (
    <WorkspaceLoader
      fs={workspaceFs}
      picker={picker}
      httpClient={httpClient}
      scriptRunner={scriptRunner}
    />
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
