import { ChevronDown, ChevronRight } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { METHOD_COLOR } from "@/components/workspace/method-color";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useTreeDnd } from "@/components/workspace/tree-dnd";
import { emptyZoneId } from "@/lib/workspace/tree-locate";
import type {
  FolderNode,
  RequestNode,
  TreeNode,
} from "@/components/workspace/mock-data";

function useRowDnd(id: string) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } =
    useDraggable({ id });
  const { setNodeRef: setDropRef } = useDroppable({ id });
  const { indicator } = useTreeDnd();
  const setNodeRef = (el: HTMLElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };
  const dropBefore = indicator?.overId === id && indicator.position === "before";
  const dropAfter = indicator?.overId === id && indicator.position === "after";
  const dropInside = indicator?.overId === id && indicator.position === "inside";
  return {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    dropBefore,
    dropAfter,
    dropInside,
  };
}

function FolderRow({ node, depth }: { node: FolderNode; depth: number }) {
  const { expandedFolderIds, selectedNodeId, selectNode } = useWorkspace();
  const { activeId } = useTreeDnd();
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    dropBefore,
    dropAfter,
    dropInside,
  } = useRowDnd(node.id);
  const isExpanded = expandedFolderIds.has(node.id);
  const Chevron = isExpanded ? ChevronDown : ChevronRight;
  const isEmpty = node.children.length === 0;
  const isDragActive = activeId !== null && activeId !== node.id;

  return (
    <li className="relative">
      {dropBefore && <DropLine />}
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        role="treeitem"
        aria-expanded={isExpanded}
        aria-selected={selectedNodeId === node.id}
        tabIndex={0}
        onClick={() => selectNode(node.id)}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        className={cn(
          "flex cursor-grab touch-none items-center gap-1 py-1 pr-2 text-[13px] hover:bg-accent active:cursor-grabbing",
          isDragging && "opacity-50",
          selectedNodeId === node.id && "bg-accent",
          dropInside && "ring-1 ring-inset ring-primary",
        )}
      >
        <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </div>
      {dropAfter && <DropLine />}
      {isExpanded ? (
        <ul role="group">
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} />
          ))}
          {isEmpty && isDragActive ? (
            <EmptyDropZone folderId={node.id} depth={depth + 1} />
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function EmptyDropZone({
  folderId,
  depth,
}: {
  folderId: string;
  depth: number;
}) {
  const zoneId = emptyZoneId(folderId);
  const { setNodeRef } = useDroppable({ id: zoneId });
  const { indicator } = useTreeDnd();
  const isOver = indicator?.overId === zoneId;

  return (
    <li>
      <div
        ref={setNodeRef}
        aria-hidden="true"
        data-testid="empty-drop-zone"
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={cn(
          "py-1 pr-2 text-[12px] italic text-muted-foreground",
          isOver && "ring-1 ring-inset ring-primary",
        )}
      >
        Drop here
      </div>
    </li>
  );
}

function RequestRow({ node, depth }: { node: RequestNode; depth: number }) {
  const { selectedNodeId, selectNode } = useWorkspace();
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    dropBefore,
    dropAfter,
  } = useRowDnd(node.id);

  return (
    <li className="relative">
      {dropBefore && <DropLine />}
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        role="treeitem"
        aria-selected={selectedNodeId === node.id}
        aria-label={`${node.method} ${node.name}`}
        tabIndex={0}
        onClick={() => selectNode(node.id)}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={cn(
          "flex cursor-grab touch-none items-center gap-2 py-1 pr-2 text-[13px] hover:bg-accent active:cursor-grabbing",
          isDragging && "opacity-50",
          selectedNodeId === node.id && "bg-accent",
        )}
      >
        <span
          className={cn(
            "shrink-0 font-mono text-[12px]",
            METHOD_COLOR[node.method],
          )}
        >
          {node.method}
        </span>
        <span className="truncate">{node.name}</span>
      </div>
      {dropAfter && <DropLine />}
    </li>
  );
}

function DropLine() {
  return (
    <div
      aria-hidden="true"
      data-testid="drop-line"
      className="pointer-events-none h-0.5 bg-primary"
    />
  );
}

export function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  if (node.kind === "folder") {
    return <FolderRow node={node} depth={depth} />;
  }
  return <RequestRow node={node} depth={depth} />;
}
