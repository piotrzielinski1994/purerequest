import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ContentHeader } from "@/components/workspace/content-header";
import { UrlBar } from "@/components/workspace/url-bar";
import { RequestPane } from "@/components/workspace/request-pane";
import { ResponsePane } from "@/components/workspace/response-pane";
import { FolderPane } from "@/components/workspace/folder-pane";
import { ShortcutsSection } from "@/components/settings/shortcuts-section";
import { ThemeSection } from "@/components/settings/theme-section";
import { EnvSection } from "@/components/settings/env-section";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useSettings } from "@/lib/settings/settings-context";

function RequestView() {
  const { settings, saveLayout } = useSettings();

  return (
    <>
      <UrlBar />
      <ResizablePanelGroup
        orientation="horizontal"
        className="flex-1"
        defaultLayout={settings.layouts.content}
        onLayoutChanged={(layout) => saveLayout("content", layout)}
      >
        <ResizablePanel id="request" defaultSize="50%" minSize="20%">
          <RequestPane />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="response" defaultSize="50%" minSize="20%">
          <ResponsePane />
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  );
}

export function Content() {
  const { isSettingsActive, isEditorActive, editTarget } = useWorkspace();

  return (
    <div className="flex h-full flex-col">
      <ContentHeader />
      {renderBody()}
    </div>
  );

  function renderBody() {
    if (isSettingsActive) {
      return (
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-8 p-6">
            <ThemeSection />
            <EnvSection />
            <ShortcutsSection />
          </div>
        </ScrollArea>
      );
    }
    // The editor only owns the content area while it is the ACTIVE view; it can
    // stay open (its tab present) in the background while a request is active.
    if (isEditorActive && editTarget?.kind === "config") {
      return <FolderPane />;
    }
    return <RequestView />;
  }
}
