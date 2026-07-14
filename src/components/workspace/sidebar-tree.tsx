import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { TreeRow } from "@/components/workspace/tree-row";
import {
  TreeDndProvider,
  useTreeDnd,
  type DropIndicator,
} from "@/components/workspace/tree-dnd";
import { TreeNavProvider } from "@/components/workspace/tree-nav";
import { resolveTreeKey } from "@/lib/workspace/tree-keyboard";
import { flattenSelectable } from "@/lib/workspace/tree-select";
import { useShortcutOverrides } from "@/lib/settings/settings-context";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { cn } from "@/lib/utils";
import {
  findNode,
  dropTarget,
  locateNode,
  projectDropPosition,
  parseEmptyZoneId,
  rawDropTarget,
  ROOT_ZONE_ID,
} from "@/lib/workspace/tree-locate";
import { dragOverlayLabel } from "@/lib/workspace/drag-overlay-label";

// The drop target filling the empty space under the last row. During a drag it
// accepts a drop that means "move to the end of the workspace root" - the escape
// hatch when every folder is collapsed and there is no root row to aim between.
// At rest a click on it clears the selection (it covers the same empty area the
// tree <ul>'s clear-on-click used to occupy).
function RootDropZone({
  isDragActive,
  onClear,
}: {
  isDragActive: boolean;
  onClear: () => void;
}) {
  const { setNodeRef } = useDroppable({ id: ROOT_ZONE_ID });
  const { indicator } = useTreeDnd();
  const isOver = indicator?.overId === ROOT_ZONE_ID;

  return (
    <div
      ref={setNodeRef}
      aria-hidden="true"
      data-testid="root-drop-zone"
      onClick={onClear}
      className={cn(
        "min-h-40",
        isDragActive && isOver && "bg-accent/40",
      )}
    />
  );
}

function pointerY(event: DragOverEvent): number | null {
  const activator = event.activatorEvent;
  if (activator instanceof PointerEvent || activator instanceof MouseEvent) {
    return activator.clientY + event.delta.y;
  }
  // Fallback (e.g. keyboard sensor): dragged element's vertical center.
  const activeRect = event.active.rect.current.translated;
  return activeRect ? activeRect.top + activeRect.height / 2 : null;
}

function projectPosition(
  event: DragOverEvent,
  isOverFolder: boolean,
  isExpandedFolder: boolean,
): DropIndicator["position"] {
  const overRect = event.over?.rect;
  const y = pointerY(event);
  if (!overRect || y === null) {
    return "before";
  }
  return projectDropPosition({
    pointerY: y,
    rectTop: overRect.top,
    rectHeight: overRect.height,
    isOverFolder,
    isExpandedFolder,
  });
}

export function SidebarTree() {
  const {
    tree,
    isWorkspaceWritable,
    moveNode,
    moveNodes,
    selectedIds,
    selectedNodeId,
    clearSelection,
    expandedFolderIds,
    toggleFolder,
    selectNode,
    focusNode,
    selectInTree,
    newRequest,
    newFolder,
    collapseAllFolders,
    expandAllFolders,
    pendingPanelFocus,
    consumePanelFocus,
    revealRowId,
    consumeRevealRow,
  } = useWorkspace();
  const bindings = resolveShortcuts(useShortcutOverrides());
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const pendingFocusId = useRef<string | null>(null);

  const registerRow = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      rowRefs.current.set(id, el);
      return;
    }
    rowRefs.current.delete(id);
  }, []);

  const visibleIds = flattenSelectable(tree, expandedFolderIds);
  const rovingId =
    selectedNodeId !== null && visibleIds.includes(selectedNodeId)
      ? selectedNodeId
      : (visibleIds[0] ?? null);

  const handleKeyDown = useCallback(
    (focusedId: string, event: React.KeyboardEvent) => {
      const command = resolveTreeKey({
        tree,
        expandedIds: expandedFolderIds,
        focusedId,
        event: event.nativeEvent,
        bindings,
      });
      if (command.type === "none") {
        return;
      }
      event.preventDefault();
      // `expand`/`collapse` only ever fire against a folder in the opposite
      // state (the resolver guards that), so a single toggle serves all three.
      const runCommand: Record<typeof command.type, () => void> = {
        focus: () => focusNode(command.id),
        activate: () => selectNode(command.id),
        toggle: () => toggleFolder(command.id),
        expand: () => toggleFolder(command.id),
        collapse: () => toggleFolder(command.id),
        extend: () => selectInTree(command.id, "range"),
        move: () =>
          command.type === "move" && moveNode(command.id, command.target),
      };
      runCommand[command.type]();

      // Commands that shift the focused row refocus it after the re-render.
      const movesFocus =
        command.type === "focus" ||
        command.type === "extend" ||
        command.type === "move";
      if (movesFocus) {
        pendingFocusId.current = command.id;
      }
    },
    [
      tree,
      expandedFolderIds,
      bindings,
      focusNode,
      selectNode,
      toggleFolder,
      selectInTree,
      moveNode,
    ],
  );

  useEffect(() => {
    const id = pendingFocusId.current;
    if (id === null) {
      return;
    }
    pendingFocusId.current = null;
    rowRefs.current.get(id)?.focus();
  });

  // Toggling the sidebar visible focuses its roving row so arrow keys drive the
  // tree immediately. A one-shot flag: clear it whether or not a row exists (an
  // empty tree has none), so a stale request never re-fires.
  useEffect(() => {
    if (pendingPanelFocus !== "sidebar") {
      return;
    }
    if (rovingId !== null) {
      rowRefs.current.get(rovingId)?.focus();
    }
    consumePanelFocus();
  }, [pendingPanelFocus, rovingId, consumePanelFocus]);

  // Scroll a quick-open-revealed row into view once. Consume-once even when no
  // row matches (a since-collapsed/unknown id), so a stale reveal never re-fires.
  useEffect(() => {
    if (revealRowId === null) {
      return;
    }
    rowRefs.current.get(revealRowId)?.scrollIntoView({ block: "nearest" });
    consumeRevealRow();
  }, [revealRowId, consumeRevealRow]);
  const rootTarget = { parentId: null as string | null, index: tree.length };
  const [activeId, setActiveId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);
  // Spring-loaded folder expand: a collapsed folder opens only after the pointer
  // DWELLS over it during a drag, not on first touch. Without the dwell, dnd-kit's
  // edge auto-scroll drags the pointer across folder after folder near the bottom
  // and each opens instantly - a runaway cascade that buries the empty drop area.
  const springLoad = useRef<{ id: string; timer: number } | null>(null);
  const clearSpringLoad = () => {
    if (springLoad.current !== null) {
      window.clearTimeout(springLoad.current.timer);
      springLoad.current = null;
    }
  };
  useEffect(() => clearSpringLoad, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || overId === String(event.active.id)) {
      setIndicator(null);
      return;
    }
    // The empty-folder / root drop zone always means a fixed target - no
    // projection needed, and no folder to spring-load.
    if (parseEmptyZoneId(overId) !== null || overId === ROOT_ZONE_ID) {
      clearSpringLoad();
      setIndicator({ overId, position: "inside" });
      return;
    }
    const over = findNode(tree, overId);
    const isOverFolder = over?.kind === "folder";
    // Spring-load: arm a dwell timer the first time the pointer enters a
    // collapsed folder; it expands only if the pointer stays. Moving on to
    // another row (or off a folder) disarms it, so a fast pass-through during
    // auto-scroll opens nothing.
    if (isOverFolder && !expandedFolderIds.has(overId)) {
      if (springLoad.current?.id !== overId) {
        clearSpringLoad();
        springLoad.current = {
          id: overId,
          timer: window.setTimeout(() => {
            toggleFolder(overId);
            springLoad.current = null;
          }, 600),
        };
      }
    } else {
      clearSpringLoad();
    }
    const position = projectPosition(
      event,
      Boolean(isOverFolder),
      isOverFolder,
    );
    setIndicator({ overId, position });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const dragId = String(event.active.id);
    const current = indicator;
    clearSpringLoad();
    setActiveId(null);
    setIndicator(null);
    if (!current || current.overId === dragId) {
      return;
    }
    // Dragging a row that's part of a multi-selection moves the WHOLE selection;
    // dragging an unselected row moves just that one (and the over-row can't be a
    // dragged member). moveNodes wants the RAW drop index (it does its own
    // multi-node compensation); the single path keeps dropTarget's compensation.
    const isMultiDrag = selectedIds.has(dragId) && selectedIds.size > 1;
    if (isMultiDrag) {
      if (selectedIds.has(current.overId)) {
        return;
      }
      const raw = rawDropTarget(tree, current.overId, current.position);
      if (!raw) {
        return;
      }
      moveNodes([...selectedIds], raw);
      return;
    }
    const target = dropTarget(tree, dragId, current.overId, current.position);
    if (!target) {
      return;
    }
    const from = locateNode(tree, dragId);
    if (
      from &&
      from.parentId === target.parentId &&
      from.index === target.index
    ) {
      return;
    }
    moveNode(dragId, target);
  };

  const activeNode = activeId ? findNode(tree, activeId) : null;
  const isMultiActive =
    activeId !== null && selectedIds.has(activeId) && selectedIds.size > 1;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1" horizontal>
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={() => {
                clearSpringLoad();
                setActiveId(null);
                setIndicator(null);
              }}
            >
              <TreeDndProvider value={{ activeId, indicator }}>
                <TreeNavProvider
                  value={{
                    rovingId,
                    contextMenuBindings: bindings["open-context-menu"],
                    registerRow,
                    handleKeyDown,
                  }}
                >
                  <ul
                    role="tree"
                    aria-label="Collection"
                    // A plain left-click on the empty tree area clears the selection.
                    onClick={(event) => {
                      if (event.target === event.currentTarget) {
                        clearSelection();
                      }
                    }}
                  >
                    {tree.map((node) => (
                      <TreeRow key={node.id} node={node} depth={0} />
                    ))}
                  </ul>
                  {tree.length > 0 && (
                    <RootDropZone
                      isDragActive={activeId !== null}
                      onClear={clearSelection}
                    />
                  )}
                </TreeNavProvider>
                <DragOverlay>
                  {activeNode ? (
                    <div className="relative">
                      {/* A second offset card behind the chip reads as a stack when dragging many. */}
                      {isMultiActive ? (
                        <div className="absolute left-1 top-1 size-full bg-accent shadow" />
                      ) : null}
                      <div className="relative bg-accent px-2 py-1 text-[13px] shadow">
                        {dragOverlayLabel(
                          activeNode.id,
                          activeNode.name,
                          selectedIds,
                        )}
                      </div>
                    </div>
                  ) : null}
                </DragOverlay>
              </TreeDndProvider>
            </DndContext>
            {tree.length === 0 && isWorkspaceWritable && (
              <div className="flex flex-col gap-1 px-3 py-4 text-center">
                <p className="text-sm font-medium">No requests yet</p>
                <p className="text-xs text-muted-foreground">
                  Right-click here (or use the New request / New folder
                  shortcuts) to create your first request.
                </p>
              </div>
            )}
            {tree.length === 0 && !isWorkspaceWritable && (
              <div className="flex flex-col gap-1 px-3 py-4 text-center">
                <p className="text-sm font-medium">No workspace</p>
                <p className="text-xs text-muted-foreground">
                  Set "workspacePath" in settings.json to an exported workspace
                  folder.
                </p>
              </div>
            )}
          </ScrollArea>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
        <ContextMenuItem onSelect={() => newRequest(rootTarget)}>
          New request
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => newFolder(rootTarget)}>
          New folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => expandAllFolders()}>
          Expand all folders
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => collapseAllFolders()}>
          Collapse all folders
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
