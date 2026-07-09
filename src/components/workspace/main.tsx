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
import { DeleteConfirmDialog } from "@/components/workspace/delete-confirm-dialog";
import { CurlImportDialog } from "@/components/workspace/curl-import-dialog";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useSettings } from "@/lib/settings/settings-context";
import { useActionHotkeys } from "@/lib/shortcuts/use-action-hotkeys";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { cycleThemeMode } from "@/lib/theme/cycle-mode";
import { themeToggleMessage } from "@/lib/theme/toggle-message";
import { useToast } from "@/components/ui/toast";
import type { FolderPicker } from "@/lib/workspace/folder-picker";
import type { BrunoCollectionReader } from "@/lib/bruno/reader";
import type { PostmanCollectionReader } from "@/lib/postman/reader";

export function Main({
  picker,
  reader,
  postmanReader,
}: {
  picker?: FolderPicker;
  reader?: BrunoCollectionReader;
  postmanReader?: PostmanCollectionReader;
}) {
  const {
    settings,
    saveLayout,
    saveConsoleHidden,
    saveSidebarHidden,
    saveWorkspacePath,
    saveThemeMode,
  } = useSettings();
  const {
    openRequestIds,
    activeRequestId,
    selectedNodeId,
    isSettingsActive,
    editTarget,
    setActiveRequest,
    requestCloseRequest,
    requestCloseOthers,
    requestCloseAll,
    requestCloseEditor,
    openSettings,
    closeSettings,
    newRequest,
    newFolder,
    duplicateRequest,
    beginRename,
    requestDeleteNode,
    sendRequest,
    saveActive,
    copyAsCurl,
    openCurlImport,
    importBruno,
    importPostman,
  } = useWorkspace();
  const { show: showToast } = useToast();
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  const toggleTheme = () => {
    const next = cycleThemeMode(settings.theme.mode);
    saveThemeMode(next);
    const prefersDark =
      typeof window !== "undefined" &&
      !!window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    showToast(themeToggleMessage(next, prefersDark));
  };

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

  const importBrunoCollection = () => {
    if (!reader) {
      return;
    }
    reader.pick().then((picked) => {
      if (picked !== null) {
        importBruno(picked.files, picked.name);
      }
    });
  };

  const importPostmanCollection = () => {
    if (!postmanReader) {
      return;
    }
    postmanReader.pick().then((picked) => {
      if (picked !== null) {
        importPostman(picked.files, picked.name);
      }
    });
  };

  // The tree selection is the target for shortcut/palette ops; request-only ops
  // fall back to the active request tab.
  const targetNodeId = selectedNodeId ?? activeRequestId;

  const isEditableFocused = () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) {
      return false;
    }
    return (
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable
    );
  };

  const handlers: Partial<Record<ShortcutActionId, () => void>> = {
    "open-settings": openSettings,
    "close-settings": closeSettings,
    "toggle-console": () => saveConsoleHidden(!settings.consoleHidden),
    "toggle-sidebar": () => saveSidebarHidden(!settings.sidebarHidden),
    "toggle-theme": toggleTheme,
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
    "close-other-requests": () => {
      if (activeRequestId !== null) {
        requestCloseOthers(activeRequestId);
      }
    },
    "close-all-requests": () => requestCloseAll(),
    "new-request": () => newRequest(),
    "new-folder": () => newFolder(),
    "duplicate-request": () => {
      if (targetNodeId !== null) {
        duplicateRequest(targetNodeId);
      }
    },
    "rename-node": () => {
      if (targetNodeId !== null) {
        beginRename(targetNodeId);
      }
    },
    "delete-node": () => {
      if (isEditableFocused() || targetNodeId === null) {
        return;
      }
      requestDeleteNode(targetNodeId);
    },
    "open-workspace": openWorkspace,
    "send-request": () => {
      if (activeRequestId !== null) {
        sendRequest(activeRequestId);
      }
    },
    "save-active-editor": saveActive,
    "copy-as-curl": copyAsCurl,
    "import-curl": openCurlImport,
    "import-bruno": importBrunoCollection,
    "import-postman": importPostmanCollection,
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
      <DeleteConfirmDialog />
      <CurlImportDialog />
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
