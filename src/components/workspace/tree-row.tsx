import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cn } from "@pziel/pureui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { METHOD_COLOR } from "@/components/workspace/method-color";
import { useTreeDnd } from "@/components/workspace/tree-dnd";
import {
  openContextMenuOnKey,
  useTreeNav,
} from "@/components/workspace/tree-nav";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyZoneId, findNode } from "@/lib/workspace/tree-locate";

function useRowDnd(id: string) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id });
  const { setNodeRef: setDropRef } = useDroppable({ id });
  const { indicator } = useTreeDnd();
  const setNodeRef = (el: HTMLElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };
  const dropBefore =
    indicator?.overId === id && indicator.position === "before";
  const dropAfter = indicator?.overId === id && indicator.position === "after";
  const dropInside =
    indicator?.overId === id && indicator.position === "inside";
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

// The selection mode a click implies: Cmd/Ctrl toggles one row, Shift ranges from
// the anchor, a plain click replaces. (macOS uses metaKey, others ctrlKey.)
function selectModeOf(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}) {
  if (event.shiftKey) {
    return "range" as const;
  }
  if (event.metaKey || event.ctrlKey) {
    return "toggle" as const;
  }
  return "replace" as const;
}

function RenameInput({ id, name }: { id: string; name: string }) {
  const { commitRename, cancelRename } = useWorkspace();
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  // A rename can open right as a radix ContextMenu closes; the menu's focus
  // teardown blurs this freshly-mounted input, and an unguarded blur-commit
  // would instantly persist the default name and close the editor. Ignore that
  // teardown blur (refocus instead) until the input has settled - a genuine
  // user blur after that still commits.
  const readyRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    // Re-assert focus on the next tick so it wins against a radix menu's focus
    // teardown that runs right after this mount (it would otherwise move focus
    // to the body). After that the input is "settled" and a blur commits.
    const settle = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
      readyRef.current = true;
    }, 0);
    return () => clearTimeout(settle);
  }, []);

  const finish = (commit: boolean) => {
    if (doneRef.current) {
      return;
    }
    doneRef.current = true;
    if (commit) {
      commitRename(id, value);
      return;
    }
    cancelRename();
  };

  return (
    <input
      ref={inputRef}
      aria-label="Rename"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => {
        if (!readyRef.current) {
          // Re-assert focus on the next tick, not synchronously: a synchronous
          // focus() inside onBlur ping-pongs with the radix teardown blur and
          // recurses until the stack overflows.
          const el = inputRef.current;
          setTimeout(() => {
            el?.focus();
            el?.select();
          }, 0);
          return;
        }
        finish(true);
      }}
      className="min-w-0 flex-1 border bg-background px-1 text-[13px] outline-none focus:border-primary"
    />
  );
}

function RowContextMenu({
  node,
  children,
}: {
  node: TreeNode;
  children: React.ReactNode;
}) {
  const {
    newRequest,
    newFolder,
    beginRename,
    duplicateNode,
    openConfigEditor,
    exportBruno,
    exportPostman,
    exportOpenapi,
    requestDeleteNode,
    expandedFolderIds,
    collapseFolder,
    expandFolder,
  } = useWorkspace();
  // Create actions belong only on a FOLDER row (create INSIDE it). A request is
  // a leaf - "new request on a request" is meaningless, so its menu is edit-only.
  const isFolder = node.kind === "folder";
  const isExpanded = expandedFolderIds.has(node.id);
  const insideTarget =
    isFolder && node.kind === "folder"
      ? { parentId: node.id, index: node.children.length }
      : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
        {insideTarget && (
          <>
            <ContextMenuItem onSelect={() => newRequest(insideTarget)}>
              New request
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => newFolder(insideTarget)}>
              New folder
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {isFolder && (
          <>
            <ContextMenuItem
              onSelect={() =>
                isExpanded ? collapseFolder(node.id) : expandFolder(node.id)
              }
            >
              {isExpanded ? "Collapse folder" : "Expand folder"}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={() => beginRename(node.id)}>
          Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => duplicateNode(node.id)}>
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => openConfigEditor(node.id)}>
          Edit
        </ContextMenuItem>
        {isFolder && (
          <ContextMenuItem onSelect={() => exportBruno(node.id)}>
            Export as Bruno...
          </ContextMenuItem>
        )}
        {isFolder && (
          <ContextMenuItem onSelect={() => exportPostman(node.id)}>
            Export as Postman...
          </ContextMenuItem>
        )}
        {isFolder && (
          <ContextMenuItem onSelect={() => exportOpenapi(node.id)}>
            Export as OpenAPI...
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => requestDeleteNode(node.id)}
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FolderRow({ node, depth }: { node: FolderNode; depth: number }) {
  const {
    tree,
    expandedFolderIds,
    selectedIds,
    selectNode,
    selectInTree,
    renamingNodeId,
    beginRename,
  } = useWorkspace();
  const { activeId } = useTreeDnd();
  const { rovingId, contextMenuBindings, registerRow, handleKeyDown } =
    useTreeNav();
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
  const isRenaming = renamingNodeId === node.id;
  const displayName = findNode(tree, node.id)?.name ?? node.name;
  const isSelected = selectedIds.has(node.id);

  return (
    <li className="relative">
      {dropBefore && <DropLine />}
      <RowContextMenu node={node}>
        <div
          ref={(el) => {
            setNodeRef(el);
            registerRow(node.id, el);
          }}
          {...attributes}
          {...listeners}
          role="treeitem"
          aria-expanded={isExpanded}
          aria-selected={isSelected}
          tabIndex={rovingId === node.id ? 0 : -1}
          onKeyDown={(event) => {
            if (isRenaming) {
              return;
            }
            if (openContextMenuOnKey(event, contextMenuBindings)) {
              return;
            }
            handleKeyDown(node.id, event);
          }}
          onClick={(event) => {
            const mode = selectModeOf(event);
            selectInTree(node.id, mode);
            // A plain click also selects + toggles the folder; a modifier click
            // only adjusts the multi-selection.
            if (mode === "replace") {
              selectNode(node.id);
            }
          }}
          onDoubleClick={() => beginRename(node.id)}
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          className={cn(
            "group flex w-max min-w-full cursor-pointer touch-none items-center gap-1 py-1 pr-2 text-[13px] outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
            isDragging && "opacity-50",
            isSelected && "bg-accent",
            dropInside && "ring-1 ring-inset ring-primary",
          )}
        >
          <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
          {isRenaming ? (
            <RenameInput id={node.id} name={displayName} />
          ) : (
            <span className="whitespace-nowrap">{displayName}</span>
          )}
        </div>
      </RowContextMenu>
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
  const {
    requestsById,
    selectedIds,
    selectNode,
    selectInTree,
    renamingNodeId,
    beginRename,
  } = useWorkspace();
  const { rovingId, contextMenuBindings, registerRow, handleKeyDown } =
    useTreeNav();
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    dropBefore,
    dropAfter,
  } = useRowDnd(node.id);
  const isRenaming = renamingNodeId === node.id;
  // Read the merged name (requestsById applies the session override) so an
  // auto-named / edited request's row reflects it - the tree node alone would
  // show the stale on-disk name.
  const displayName = requestsById.get(node.id)?.name ?? node.name;
  const isSelected = selectedIds.has(node.id);

  return (
    <li className="relative">
      {dropBefore && <DropLine />}
      <RowContextMenu node={node}>
        <div
          ref={(el) => {
            setNodeRef(el);
            registerRow(node.id, el);
          }}
          {...attributes}
          {...listeners}
          role="treeitem"
          aria-selected={isSelected}
          aria-label={`${node.method} ${displayName}`}
          tabIndex={rovingId === node.id ? 0 : -1}
          onKeyDown={(event) => {
            if (isRenaming) {
              return;
            }
            if (openContextMenuOnKey(event, contextMenuBindings)) {
              return;
            }
            handleKeyDown(node.id, event);
          }}
          onClick={(event) => {
            const mode = selectModeOf(event);
            selectInTree(node.id, mode);
            // A plain click also opens the request tab; a modifier click only
            // adjusts the multi-selection.
            if (mode === "replace") {
              selectNode(node.id);
            }
          }}
          onDoubleClick={() => beginRename(node.id)}
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          className={cn(
            "group flex w-max min-w-full cursor-pointer touch-none items-center gap-2 py-1 pr-2 text-[13px] outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
            isDragging && "opacity-50",
            isSelected && "bg-accent",
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
          {isRenaming ? (
            <RenameInput id={node.id} name={displayName} />
          ) : (
            <span className="whitespace-nowrap">{displayName}</span>
          )}
        </div>
      </RowContextMenu>
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
