import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Folder, Plus, Settings, X } from "lucide-react";
import { useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { METHOD_COLOR } from "@/components/workspace/method-color";
import {
  EDITOR_TAB_ID,
  SETTINGS_TAB_ID,
} from "@/components/workspace/pane-tabs";
import { TabLabel } from "@/components/workspace/tab-label";
import { openContextMenuOnKey } from "@/components/workspace/tree-nav";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useShortcutOverrides } from "@/lib/settings/settings-context";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { cn } from "@/lib/utils";
import type { TreeNode } from "@/lib/workspace/model";
import { findNode } from "@/lib/workspace/tree-locate";

function editorTabLabel(
  editTarget: NonNullable<ReturnType<typeof useWorkspace>["editTarget"]>,
  tree: TreeNode[],
): string {
  const node = findNode(tree, editTarget.id);
  return node ? node.name : "config";
}

// One sortable tab chip - shared by request tabs and the Settings tab so both
// drag/reorder, close, and open a context menu identically. The WHOLE chip is the
// activate hit-area (the wrapper's onClick), not just the inner label, so there
// are no dead click zones (a pointer drag is distinguished by the dnd-kit
// activation distance, so a click still activates). The close button stops
// propagation so it never doubles as an activate.
function SortableTab({
  id,
  label,
  icon,
  isActive,
  isDirty,
  canCloseOthers,
  closeLabel,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseAll,
  contextMenuBindings,
}: {
  id: string;
  label: React.ReactNode;
  icon: React.ReactNode;
  isActive: boolean;
  isDirty: boolean;
  canCloseOthers: boolean;
  closeLabel: string;
  onActivate: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  contextMenuBindings: string[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={{ transform: CSS.Translate.toString(transform), transition }}
          {...attributes}
          {...listeners}
          role="tab"
          aria-selected={isActive}
          onClick={onActivate}
          onKeyDown={(event) => {
            listeners?.onKeyDown?.(event);
            openContextMenuOnKey(event, contextMenuBindings);
          }}
          className={cn(
            "group flex h-full cursor-grab touch-none items-center gap-1.5 border-r px-3 text-sm hover:bg-accent active:cursor-grabbing",
            isDragging && "opacity-50",
            isActive
              ? "-mb-px h-[calc(100%+1px)] bg-accent text-foreground shadow-[inset_0_-2px_0_0_var(--primary)]"
              : "bg-transparent text-muted-foreground",
          )}
        >
          {icon}
          {isDirty && (
            <span
              aria-label="Unsaved changes"
              className="size-2 shrink-0 rounded-full bg-foreground"
            />
          )}
          <TabLabel>{label}</TabLabel>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
        <ContextMenuItem onSelect={onClose}>Close</ContextMenuItem>
        <ContextMenuItem disabled={!canCloseOthers} onSelect={onCloseOthers}>
          Close other tabs
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseAll}>Close all</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// The folder config-editor tab as a sortable chip, so it drag/keyboard-reorders
// alongside request tabs. Distinct from SortableTab: its own Folder icon, its
// "close config editor" button, and activation via openConfigEditor (not a
// request id) - the editor lives in the transient editTarget slot.
function SortableEditorTab({
  label,
  isActive,
  isDirty,
  onActivate,
  onClose,
}: {
  label: React.ReactNode;
  isActive: boolean;
  isDirty: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: EDITOR_TAB_ID });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      onClick={onActivate}
      onKeyDown={(event) => listeners?.onKeyDown?.(event)}
      className={cn(
        "group flex h-full cursor-grab touch-none items-center gap-1 border-r px-3 text-sm hover:bg-accent active:cursor-grabbing",
        isDragging && "opacity-50",
        isActive
          ? "-mb-px h-[calc(100%+1px)] bg-accent text-foreground shadow-[inset_0_-2px_0_0_var(--primary)]"
          : "bg-transparent text-muted-foreground",
      )}
    >
      <Folder aria-hidden="true" className="size-3.5 shrink-0" />
      {isDirty && (
        <span
          aria-label="Unsaved changes"
          className="size-2 shrink-0 rounded-full bg-foreground"
        />
      )}
      <TabLabel>{label}</TabLabel>
      <button
        type="button"
        aria-label="Close config editor"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

export function ContentHeader() {
  const {
    openRequestIds,
    activeRequestId,
    requestsById,
    dirtyRequestIds,
    setActiveRequest,
    reorderRequests,
    requestCloseRequest,
    requestCloseOthers,
    requestCloseAll,
    editorDirty,
    isSettingsActive,
    editTarget,
    isEditorActive,
    tree,
    closeEditor,
    openConfigEditor,
    openSettings,
    newRequest,
  } = useWorkspace();
  const contextMenuBindings = resolveShortcuts(useShortcutOverrides())[
    "open-context-menu"
  ];

  // Where the editor tab sits among the request/Settings tabs. Session-only UI
  // state (the editor is a transient editTarget slot, never persisted); defaults
  // to the end and clamps to the current tab count on each render.
  const [editorTabIndex, setEditorTabIndex] = useState(Number.MAX_SAFE_INTEGER);
  const hasEditorTab = editTarget !== null;
  // The full ordered id list the SortableContext sorts over: request/Settings
  // tabs plus the editor tab spliced at its index (when open).
  const tabIds = hasEditorTab
    ? [
        ...openRequestIds.slice(0, editorTabIndex),
        EDITOR_TAB_ID,
        ...openRequestIds.slice(editorTabIndex),
      ]
    : openRequestIds;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const from = tabIds.indexOf(String(active.id));
    const to = tabIds.indexOf(String(over.id));
    if (from === -1 || to === -1) {
      return;
    }
    const reordered = arrayMove(tabIds, from, to);
    // Remember the editor tab's new slot, then persist the request/Settings order
    // (the editor id is excluded - it doesn't live in openRequestIds).
    const nextEditorIndex = reordered.indexOf(EDITOR_TAB_ID);
    if (nextEditorIndex !== -1) {
      setEditorTabIndex(nextEditorIndex);
    }
    reorderRequests(reordered.filter((id) => id !== EDITOR_TAB_ID));
  };

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b bg-muted/30">
      <div
        role="tablist"
        aria-label="Open requests"
        className="flex h-full min-w-0 items-stretch overflow-x-auto overflow-y-hidden"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={tabIds}
            strategy={horizontalListSortingStrategy}
          >
            {tabIds.map((id) => {
              if (id === EDITOR_TAB_ID && editTarget !== null) {
                return (
                  <SortableEditorTab
                    key={id}
                    label={editorTabLabel(editTarget, tree)}
                    isActive={isEditorActive}
                    isDirty={editorDirty}
                    onActivate={() => openConfigEditor(editTarget.id)}
                    onClose={closeEditor}
                  />
                );
              }
              const closeHandlers = {
                canCloseOthers: openRequestIds.length > 1,
                onClose: () => requestCloseRequest(id),
                onCloseOthers: () => requestCloseOthers(id),
                onCloseAll: () => requestCloseAll(),
                contextMenuBindings,
              };
              if (id === SETTINGS_TAB_ID) {
                return (
                  <SortableTab
                    key={id}
                    id={id}
                    label="Settings"
                    icon={
                      <Settings
                        aria-hidden="true"
                        className="size-3.5 shrink-0"
                      />
                    }
                    isActive={isSettingsActive}
                    isDirty={false}
                    closeLabel="Close settings"
                    onActivate={openSettings}
                    {...closeHandlers}
                  />
                );
              }
              const request = requestsById.get(id);
              if (!request) {
                return null;
              }
              return (
                <SortableTab
                  key={id}
                  id={id}
                  label={request.name}
                  icon={
                    <span
                      aria-hidden="true"
                      className={cn(
                        "shrink-0 font-mono text-[11px]",
                        METHOD_COLOR[request.method],
                      )}
                    >
                      {request.method}
                    </span>
                  }
                  isActive={
                    id === activeRequestId &&
                    !isSettingsActive &&
                    !isEditorActive
                  }
                  isDirty={dirtyRequestIds.has(id)}
                  closeLabel={`Close ${request.name}`}
                  onActivate={() => setActiveRequest(id)}
                  {...closeHandlers}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </div>
      <button
        type="button"
        aria-label="New request"
        onClick={() => newRequest()}
        className="shrink-0 px-2 py-1.5 text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
