import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import { BodyPanel } from "@/components/workspace/body-panel";
import { RequestSettingsForm } from "@/components/workspace/config-editor";
import {
  AuthPanel,
  HeadersPanel,
  ParamsPanel,
  ScriptPanel,
  VarsPanel,
} from "@/components/workspace/config-panels";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { RequestNode } from "@/lib/workspace/model";

function RequestTabs({ request }: { request: RequestNode }) {
  const {
    activeRequestTab,
    setRequestTab,
    effectiveConfig,
    processEnv,
    activeEnvironment,
    setRequestConfig,
  } = useWorkspace();
  const highlight = {
    effective: effectiveConfig,
    processEnv,
    environment: activeEnvironment,
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
      <TabsContent value="params">
        <ParamsPanel
          config={request.config}
          onChange={onConfigChange}
          highlight={highlight}
        />
      </TabsContent>
      <TabsContent value="body" className="min-h-0 flex-1">
        <BodyPanel key={request.id} request={request} />
      </TabsContent>
      <TabsContent value="script">
        <ScriptPanel config={request.config} onChange={onConfigChange} />
      </TabsContent>
      <TabsContent value="settings" className="min-h-0 flex-1">
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
