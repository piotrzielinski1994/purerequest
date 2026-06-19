import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { TreeRow } from "@/components/workspace/tree-row";
import {
  TreeDndProvider,
  type DropIndicator,
} from "@/components/workspace/tree-dnd";
import {
  findNode,
  dropTarget,
  locateNode,
  projectDropPosition,
} from "@/lib/workspace/tree-locate";

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
  });
}

export function SidebarTree() {
  const { tree, moveNode, expandedFolderIds, toggleFolder } = useWorkspace();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);

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
    const over = findNode(tree, overId);
    const isOverFolder = over?.kind === "folder";
    const position = projectPosition(event, Boolean(isOverFolder));
    if (isOverFolder && position === "inside" && !expandedFolderIds.has(overId)) {
      toggleFolder(overId);
    }
    setIndicator({ overId, position });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const dragId = String(event.active.id);
    const current = indicator;
    setActiveId(null);
    setIndicator(null);
    if (!current || current.overId === dragId) {
      return;
    }
    const target = dropTarget(tree, dragId, current.overId, current.position);
    if (!target) {
      return;
    }
    const from = locateNode(tree, dragId);
    if (from && from.parentId === target.parentId && from.index === target.index) {
      return;
    }
    moveNode(dragId, target);
  };

  const activeNode = activeId ? findNode(tree, activeId) : null;

  return (
    <ScrollArea className="flex-1">
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setIndicator(null);
        }}
      >
        <TreeDndProvider value={{ activeId, indicator }}>
          <ul role="tree" aria-label="Collection">
            {tree.map((node) => (
              <TreeRow key={node.id} node={node} depth={0} />
            ))}
          </ul>
          <DragOverlay>
            {activeNode ? (
              <div className="rounded-sm bg-accent px-2 py-1 text-[13px] shadow">
                {activeNode.name}
              </div>
            ) : null}
          </DragOverlay>
        </TreeDndProvider>
      </DndContext>
      {tree.length === 0 && (
        <div className="flex flex-col gap-1 px-3 py-4 text-center">
          <p className="text-sm font-medium">No workspace</p>
          <p className="text-xs text-muted-foreground">
            Set "workspacePath" in settings.json to an exported workspace
            folder.
          </p>
        </div>
      )}
    </ScrollArea>
  );
}
