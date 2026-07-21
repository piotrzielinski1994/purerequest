import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BodyPanel } from "@/components/workspace/body-panel";
import { RequestSettingsForm } from "@/components/workspace/config-editor";
import {
  AuthPanel,
  GeneralPanel,
  HeadersPanel,
  ParamsPanel,
  ScriptPanel,
  VarsPanel,
} from "@/components/workspace/config-panels";
import type { TokenHighlightContext } from "@/components/workspace/editable-key-value-table";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import { PathParamsPanel } from "@/components/workspace/path-params-panel";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { RequestNode } from "@/lib/workspace/model";
import { requestHttpVersion } from "@/lib/workspace/model";
import { DEFAULT_TIMEOUT_MS } from "@/lib/workspace/resolve";

const DEFAULT_TIMEOUT_RESOLVED = {
  value: DEFAULT_TIMEOUT_MS,
  from: { scopeId: "default", scopeName: "default" },
};

// The Params tab nests a Path/Query sub-bar. Query edits the request's own
// `params.query` AND bidirectionally mirrors the URL `?query` (via
// setRequestQueryParams); Path is the request-only `params.path`. Query is the
// default so the tab keeps behaving as the single Params tab did.
function ParamsSubTabs({
  request,
  highlight,
}: {
  request: RequestNode;
  highlight: TokenHighlightContext;
}) {
  const { setRequestQueryParams, paramsReveal } = useWorkspace();
  const [subTab, setSubTab] = useState<"path" | "query">("query");
  // A "go to source" jump from a `:name` token opens the Path sub-tab. Applied
  // during render (the codebase's reseed idiom) keyed by nonce, so re-revealing
  // the same target re-fires but a later manual switch isn't fought.
  const [seenReveal, setSeenReveal] = useState<number | null>(null);
  if (paramsReveal && seenReveal !== paramsReveal.nonce) {
    setSeenReveal(paramsReveal.nonce);
    setSubTab(paramsReveal.subTab);
  }
  return (
    <Tabs
      value={subTab}
      onValueChange={(value) => setSubTab(value as typeof subTab)}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-10.25 items-stretch overflow-x-auto border-b bg-muted/30">
        <TabsList aria-label="Param sections" className={PANE_TABS_LIST}>
          <TabsTrigger value="path" className={PANE_TABS_TRIGGER}>
            Path
          </TabsTrigger>
          <TabsTrigger value="query" className={PANE_TABS_TRIGGER}>
            Query
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="path">
        <PathParamsPanel request={request} highlight={highlight} />
      </TabsContent>
      <TabsContent value="query">
        <ParamsPanel
          rows={request.params.query}
          onChange={(rows) => setRequestQueryParams(request.id, rows)}
          highlight={highlight}
        />
      </TabsContent>
    </Tabs>
  );
}

function RequestTabs({ request }: { request: RequestNode }) {
  const {
    activeRequestTab,
    setRequestTab,
    effectiveConfig,
    processEnv,
    activeEnvironment,
    setRequestConfig,
    setRequestHttpVersion,
  } = useWorkspace();
  const highlight = {
    effective: effectiveConfig,
    processEnv,
    environment: activeEnvironment,
    ownScopeId: request.id,
  };
  const onConfigChange = (config: RequestNode["config"]) =>
    setRequestConfig(request.id, config);

  return (
    <Tabs
      value={activeRequestTab}
      onValueChange={(value) => setRequestTab(value as typeof activeRequestTab)}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-10.25 items-stretch overflow-x-auto border-b bg-muted/30">
        <TabsList aria-label="Request sections" className={PANE_TABS_LIST}>
          <TabsTrigger value="vars" className={PANE_TABS_TRIGGER}>
            Vars
          </TabsTrigger>
          <TabsTrigger value="auth" className={PANE_TABS_TRIGGER}>
            Auth
          </TabsTrigger>
          <TabsTrigger value="headers" className={PANE_TABS_TRIGGER}>
            Headers
          </TabsTrigger>
          <TabsTrigger value="params" className={PANE_TABS_TRIGGER}>
            Params
          </TabsTrigger>
          <TabsTrigger value="body" className={PANE_TABS_TRIGGER}>
            Body
          </TabsTrigger>
          <TabsTrigger value="script" className={PANE_TABS_TRIGGER}>
            Script
          </TabsTrigger>
          <TabsTrigger value="settings" className={PANE_TABS_TRIGGER}>
            Settings
          </TabsTrigger>
          <TabsTrigger value="raw" className={PANE_TABS_TRIGGER}>
            Raw
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="vars">
        <VarsPanel
          config={request.config}
          onChange={onConfigChange}
          highlight={highlight}
        />
      </TabsContent>
      <TabsContent value="auth">
        <AuthPanel
          config={request.config}
          onChange={onConfigChange}
          highlight={highlight}
        />
      </TabsContent>
      <TabsContent value="headers">
        <HeadersPanel
          config={request.config}
          onChange={onConfigChange}
          highlight={highlight}
        />
      </TabsContent>
      <TabsContent value="params" className="min-h-0 flex-1">
        <ParamsSubTabs request={request} highlight={highlight} />
      </TabsContent>
      <TabsContent value="body" className="min-h-0 flex-1">
        <BodyPanel key={request.id} request={request} />
      </TabsContent>
      <TabsContent value="script">
        <ScriptPanel config={request.config} onChange={onConfigChange} />
      </TabsContent>
      <TabsContent value="settings">
        <GeneralPanel
          config={request.config}
          effectiveTimeout={
            effectiveConfig?.timeoutMs ?? DEFAULT_TIMEOUT_RESOLVED
          }
          onChange={onConfigChange}
          httpVersion={requestHttpVersion(request)}
          onHttpVersionChange={(version) =>
            setRequestHttpVersion(request.id, version)
          }
        />
      </TabsContent>
      <TabsContent value="raw" className="min-h-0 flex-1">
        <RequestSettingsForm key={request.id} request={request} />
      </TabsContent>
    </Tabs>
  );
}

export function RequestPane() {
  const { activeRequest } = useWorkspace();

  if (!activeRequest) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No request selected
      </div>
    );
  }

  return <RequestTabs request={activeRequest} />;
}
