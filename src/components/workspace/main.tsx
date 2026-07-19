import { useCallback, useEffect, useState } from "react";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import type { PanelGroupHandle } from "@/components/workspace/workspace-context/types";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  PANEL_RESIZE_STEP,
  resolveFocusedPanel,
  stepLayout,
  type PanelResizeTarget,
} from "@/lib/workspace/panel-resize";
import { Content } from "@/components/workspace/content";
import { Console } from "@/components/workspace/console";
import {
  CommandPalette,
  type PaletteCommand,
} from "@/components/workspace/command-palette";
import { RequestQuickOpen } from "@/components/workspace/request-quick-open";
import { buildQuickOpenEntries } from "@/lib/workspace/quick-open";
import { CloseConfirmDialog } from "@/components/workspace/close-confirm-dialog";
import { DeleteConfirmDialog } from "@/components/workspace/delete-confirm-dialog";
import { CurlImportDialog } from "@/components/workspace/curl-import-dialog";
import { CodeGenDialog } from "@/components/workspace/code-gen-dialog";
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
import type { OpenapiReader } from "@/lib/openapi/reader";

// Open the find panel on a snapshotted CodeMirror view. Find has no global toggle - each
// editor owns its own Cmd+F (CM keymap) - so the palette can't just re-fire the keystroke:
// the modal traps focus, and CM's keymap ignores synthetic KeyboardEvents (it reads keyCode,
// not `key`). Instead the palette snapshots the focused EditorView on open and drives
// openSearchPanel directly, matching how panel-resize snapshots its focused target.
function openFindOn(view: EditorView | null) {
  if (view === null) {
    return;
  }
  view.focus();
  openSearchPanel(view);
}

export function Main({
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
  const {
    settings,
    saveLayout,
    saveConsoleHidden,
    saveSidebarHidden,
    saveWorkspacePath,
    saveThemeMode,
  } = useSettings();
  const {
    tree,
    openRequestIds,
    activeRequestId,
    selectedNodeId,
    isEditorActive,
    editTarget,
    revealNode,
    requestsById,
    openConfigEditor,
    collapseAllFolders,
    expandAllFolders,
    setActiveRequest,
    requestCloseRequest,
    requestCloseOthers,
    requestCloseAll,
    requestCloseEditor,
    openSettings,
    closeSettings,
    newRequest,
    newFolder,
    duplicateNode,
    beginRename,
    requestDeleteNode,
    sendRequest,
    saveActive,
    openCodeGen,
    openCurlImport,
    importBruno,
    importPostman,
    importOpenapi,
    exportBruno,
    exportPostman,
    requestPanelFocus,
    registerPanelGroup,
    getPanelGroup,
  } = useWorkspace();
  const { show: showToast } = useToast();
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false);

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

  const importOpenapiDocument = () => {
    if (!openapiReader) {
      return;
    }
    openapiReader.pick().then((picked) => {
      if (picked !== null) {
        importOpenapi(picked.text, picked.name);
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

  const mainGroupRef = useCallback(
    (handle: PanelGroupHandle | null) => registerPanelGroup("main", handle),
    [registerPanelGroup],
  );

  // The last panel the pointer interacted with. Clicking a blank (non-focusable)
  // area of the sidebar/console does not move DOM focus into it, so
  // `document.activeElement` alone can't tell a resize which panel is active;
  // this tracks the last-clicked panel (null when the last click was outside a
  // resizable panel, e.g. the content area) as the fallback target.
  const [pointerTarget, setPointerTarget] =
    useState<PanelResizeTarget | null>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const next = resolveFocusedPanel(event.target as Element | null);
      setPointerTarget((current) =>
        current?.panelId === next?.panelId ? current : next,
      );
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // The panel focused when the command palette opened. Running a resize action
  // from the palette can't read `document.activeElement` (focus is trapped in
  // the modal), so it falls back to this snapshot.
  const [paletteResizeTarget, setPaletteResizeTarget] =
    useState<PanelResizeTarget | null>(null);
  // The CodeMirror view focused when the palette opened, so the palette "Find" command can
  // reopen its search panel after the modal stole focus (see openFindOn).
  const [paletteFindTarget, setPaletteFindTarget] = useState<EditorView | null>(
    null,
  );
  const openPalette = () => {
    setPaletteResizeTarget(
      resolveFocusedPanel(document.activeElement) ?? pointerTarget,
    );
    setPaletteFindTarget(
      document.activeElement instanceof HTMLElement
        ? EditorView.findFromDOM(document.activeElement)
        : null,
    );
    setIsPaletteOpen(true);
  };

  const resizeFocusedPanel = (deltaPct: number) => {
    const target =
      resolveFocusedPanel(document.activeElement) ??
      (isPaletteOpen ? paletteResizeTarget : pointerTarget);
    if (target === null) {
      return;
    }
    const handle = getPanelGroup(target.group);
    if (handle === null) {
      return;
    }
    handle.setLayout(stepLayout(handle.getLayout(), target, deltaPct));
  };

  const handlers: Partial<Record<ShortcutActionId, () => void>> = {
    "open-settings": openSettings,
    "close-settings": closeSettings,
    "toggle-console": () => {
      const nextHidden = !settings.consoleHidden;
      saveConsoleHidden(nextHidden);
      requestPanelFocus(nextHidden ? "content" : "console");
    },
    "toggle-sidebar": () => {
      const nextHidden = !settings.sidebarHidden;
      saveSidebarHidden(nextHidden);
      requestPanelFocus(nextHidden ? "content" : "sidebar");
    },
    "toggle-theme": toggleTheme,
    "next-request": () => stepRequest(1),
    "prev-request": () => stepRequest(-1),
    "close-request": () => {
      if (isEditorActive && editTarget !== null) {
        requestCloseEditor();
        return;
      }
      // Settings is a real tab now: Mod+W closes it (removes the tab), unlike Esc
      // which only deactivates. The active tab id (incl. the synthetic settings
      // id) routes through the same close path.
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
    "duplicate-node": () => {
      if (targetNodeId !== null) {
        duplicateNode(targetNodeId);
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
    "copy-as-code": openCodeGen,
    "import-curl": openCurlImport,
    "import-bruno": importBrunoCollection,
    "import-postman": importPostmanCollection,
    "import-openapi": importOpenapiDocument,
    "export-bruno": () => exportBruno(selectedNodeId ?? undefined),
    "export-postman": () => exportPostman(selectedNodeId ?? undefined),
    "open-quick-open": () => setIsQuickOpenOpen(true),
    "collapse-all-folders": collapseAllFolders,
    "expand-all-folders": expandAllFolders,
    "panel-expand": () => resizeFocusedPanel(PANEL_RESIZE_STEP),
    "panel-shrink": () => resizeFocusedPanel(-PANEL_RESIZE_STEP),
  };

  useActionHotkeys({
    ...handlers,
    "open-command-palette": openPalette,
  });

  const effective = resolveShortcuts(settings.shortcuts);
  // Find is palette-runnable but NOT a global hotkey: each CodeMirror surface owns
  // its own Cmd+F (CM keymap), so the palette re-fires the binding at the focused
  // surface rather than routing through the global hotkey layer.
  const paletteRuns: Partial<Record<ShortcutActionId, () => void>> = {
    ...handlers,
    "open-find": () => openFindOn(paletteFindTarget),
  };
  const commands: PaletteCommand[] = SHORTCUT_ACTIONS.filter(
    (action) => action.id !== "open-command-palette",
  )
    .map((action) => {
      const run = paletteRuns[action.id];
      if (!run) {
        return null;
      }
      // A disabled action (empty binding list) shows no shortcut chip but is
      // still runnable from the palette; otherwise show its first binding.
      return { action, binding: effective[action.id][0] ?? "", run };
    })
    .filter((command): command is PaletteCommand => command !== null);

  const palette = (
    <>
      <CommandPalette
        open={isPaletteOpen}
        onOpenChange={setIsPaletteOpen}
        commands={commands}
      />
      <RequestQuickOpen
        open={isQuickOpenOpen}
        onOpenChange={setIsQuickOpenOpen}
        entries={buildQuickOpenEntries(tree)}
        onSelect={(id) => {
          revealNode(id);
          // A request reveal opens its tab (handled by revealNode); a folder
          // additionally opens its edit card, so quick-open lands on something
          // editable rather than just a highlighted row.
          if (!requestsById.has(id)) {
            openConfigEditor(id);
          }
        }}
      />
      <CloseConfirmDialog />
      <DeleteConfirmDialog />
      <CurlImportDialog />
      <CodeGenDialog />
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
        groupRef={mainGroupRef}
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
