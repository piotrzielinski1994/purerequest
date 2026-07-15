import { useCallback, type CSSProperties } from "react";
import type { PanelGroupHandle } from "@/components/workspace/workspace-context/types";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sidebar } from "@/components/workspace/sidebar";
import { Main } from "@/components/workspace/main";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useSettings } from "@/lib/settings/settings-context";
import type { FolderPicker } from "@/lib/workspace/folder-picker";
import type { BrunoCollectionReader } from "@/lib/bruno/reader";
import type { PostmanCollectionReader } from "@/lib/postman/reader";
import type { OpenapiReader } from "@/lib/openapi/reader";

export function WorkspaceLayout({
  picker,
  reader,
  postmanReader,
  openapiReader,
}: {
  picker?: FolderPicker;
  reader?: BrunoCollectionReader;
  postmanReader?: PostmanCollectionReader;
  openapiReader?: OpenapiReader;
}) {
  const { settings, saveLayout } = useSettings();
  const { activeAccentColor, registerPanelGroup } = useWorkspace();
  // The accent recolors the existing 1px borders by overriding the --border
  // token on the shell root (every divider/input border resolves from it). The
  // tint is the hex's own alpha pair (#rrggbbaa). Only --border is overridden.
  const accentStyle: CSSProperties | undefined = activeAccentColor
    ? ({ "--border": activeAccentColor } as CSSProperties)
    : undefined;

  const groupRef = useCallback(
    (handle: PanelGroupHandle | null) => registerPanelGroup("workspace", handle),
    [registerPanelGroup],
  );

  if (settings.sidebarHidden) {
    return (
      <div className="h-full w-full" style={accentStyle}>
        <Main
          picker={picker}
          reader={reader}
          postmanReader={postmanReader}
          openapiReader={openapiReader}
        />
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      groupRef={groupRef}
      orientation="horizontal"
      className="h-full w-full"
      style={accentStyle}
      defaultLayout={settings.layouts.workspace}
      onLayoutChanged={(layout) => saveLayout("workspace", layout)}
    >
      <ResizablePanel
        id="sidebar"
        defaultSize="20%"
        minSize="12%"
        maxSize="40%"
      >
        <Sidebar />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="content" defaultSize="80%">
        <Main
          picker={picker}
          reader={reader}
          postmanReader={postmanReader}
          openapiReader={openapiReader}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
