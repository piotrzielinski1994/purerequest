import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PANE_TABS_LIST, PANE_TABS_TRIGGER } from "@/components/workspace/pane-tabs";
import { ConfigEditorForm } from "@/components/workspace/config-editor";
import {
  AuthPanel,
  HeadersPanel,
  ParamsPanel,
  ScriptPanel,
  VarsPanel,
} from "@/components/workspace/config-panels";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { findNode } from "@/lib/workspace/tree-locate";

type FolderTab = "vars" | "auth" | "headers" | "params" | "script" | "settings";

export function FolderPane() {
  const { editTarget, tree } = useWorkspace();
  const [tab, setTab] = useState<FolderTab>("vars");
  if (editTarget?.kind !== "config") {
    return null;
  }
  const node = findNode(tree, editTarget.id);
  if (!node || node.kind !== "folder") {
    return null;
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as FolderTab)}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-10.25 items-stretch border-b bg-muted/30">
        <TabsList aria-label="Folder sections" className={PANE_TABS_LIST}>
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
          <TabsTrigger value="script" className={PANE_TABS_TRIGGER}>
            Script
          </TabsTrigger>
          <TabsTrigger value="settings" className={PANE_TABS_TRIGGER}>
            Settings
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="vars">
        <VarsPanel id={node.id} config={node.config} />
      </TabsContent>
      <TabsContent value="auth">
        <AuthPanel id={node.id} config={node.config} />
      </TabsContent>
      <TabsContent value="headers">
        <HeadersPanel id={node.id} config={node.config} />
      </TabsContent>
      <TabsContent value="params">
        <ParamsPanel id={node.id} config={node.config} />
      </TabsContent>
      <TabsContent value="script">
        <ScriptPanel id={node.id} config={node.config} />
      </TabsContent>
      <TabsContent value="settings" className="min-h-0 flex-1">
        <ConfigEditorForm key={node.id} id={node.id} config={node.config} />
      </TabsContent>
    </Tabs>
  );
}
