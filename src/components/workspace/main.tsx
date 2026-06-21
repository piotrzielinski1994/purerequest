import { useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Content } from "@/components/workspace/content";
import { Console } from "@/components/workspace/console";
import {
  CommandPalette,
  type PaletteCommand,
} from "@/components/workspace/command-palette";
import { CloseConfirmDialog } from "@/components/workspace/close-confirm-dialog";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useSettings } from "@/lib/settings/settings-context";
import { useActionHotkeys } from "@/lib/shortcuts/use-action-hotkeys";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import type { FolderPicker } from "@/lib/workspace/folder-picker";

export function Main({ picker }: { picker?: FolderPicker }) {
  const { settings, saveLayout, saveConsoleHidden, saveSidebarHidden, saveWorkspacePath } =
    useSettings();
  const {
    openRequestIds,
    activeRequestId,
    isSettingsActive,
    editTarget,
    setActiveRequest,
    requestCloseRequest,
    requestCloseAll,
    requestCloseEditor,
    openSettings,
    closeSettings,
    newRequest,
    sendRequest,
    saveActiveEditor,
    saveActiveRequest,
  } = useWorkspace();
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  const stepRequest = (delta: number) => {
    if (activeRequestId === null) {
      return;
    }
    const index = openRequestIds.indexOf(activeRequestId);
    if (index === -1) {
      return;
    }
    const next =
      openRequestIds[
        (index + delta + openRequestIds.length) % openRequestIds.length
      ];
    setActiveRequest(next);
  };

  const openWorkspace = () => {
    if (!picker) {
      return;
    }
    picker.pick().then((path) => {
      if (path !== null) {
        saveWorkspacePath(path);
      }
    });
  };

  const handlers: Partial<Record<ShortcutActionId, () => void>> = {
    "open-settings": openSettings,
    "close-settings": closeSettings,
    "toggle-console": () => saveConsoleHidden(!settings.consoleHidden),
    "toggle-sidebar": () => saveSidebarHidden(!settings.sidebarHidden),
    "next-request": () => stepRequest(1),
    "prev-request": () => stepRequest(-1),
    "close-request": () => {
      if (isSettingsActive) {
        closeSettings();
        return;
      }
      if (editTarget !== null) {
        requestCloseEditor();
        return;
      }
      if (activeRequestId !== null) {
        requestCloseRequest(activeRequestId);
      }
    },
    "close-all-requests": () => requestCloseAll(),
    "new-request": () => newRequest(),
    "open-workspace": openWorkspace,
    "send-request": () => {
      if (activeRequestId !== null) {
        sendRequest(activeRequestId);
      }
    },
    "save-active-editor": () => {
      if (!saveActiveEditor()) {
        saveActiveRequest();
      }
    },
  };

  useActionHotkeys({
    ...handlers,
    "open-command-palette": () => setIsPaletteOpen(true),
  });

  const effective = resolveShortcuts(settings.shortcuts);
  const commands: PaletteCommand[] = SHORTCUT_ACTIONS.filter(
    (action) => action.id !== "open-command-palette",
  )
    .map((action) => {
      const run = handlers[action.id];
      if (!run) {
        return null;
      }
      return { action, binding: effective[action.id], run };
    })
    .filter((command): command is PaletteCommand => command !== null);

  const palette = (
    <>
      <CommandPalette
        open={isPaletteOpen}
        onOpenChange={setIsPaletteOpen}
        commands={commands}
      />
      <CloseConfirmDialog />
    </>
  );

  if (settings.consoleHidden) {
    return (
      <div className="h-full">
        <Content />
        {palette}
      </div>
    );
  }

  return (
    <>
      <ResizablePanelGroup
        orientation="vertical"
        className="h-full"
        defaultLayout={settings.layouts.main}
        onLayoutChanged={(layout) => saveLayout("main", layout)}
      >
        <ResizablePanel id="content" defaultSize="75%" minSize="30%">
          <Content />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="console" defaultSize="25%" minSize="10%">
          <Console />
        </ResizablePanel>
      </ResizablePanelGroup>
      {palette}
    </>
  );
}
