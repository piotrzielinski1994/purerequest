import { useWorkspace } from "@/components/workspace/workspace-context";
import { cn } from "@/lib/utils";
import { Plus, Settings, X } from "lucide-react";
import { METHOD_COLOR } from "@/components/workspace/method-color";
import type { RequestNode } from "@/components/workspace/mock-data";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function RequestTab({
  id,
  request,
  isActive,
  onActivate,
  onClose,
}: {
  id: string;
  request: RequestNode;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={cn(
        "flex h-full cursor-grab touch-none items-center gap-1 border-r px-3 text-sm hover:bg-accent active:cursor-grabbing",
        isDragging && "opacity-50",
        isActive
          ? "-mb-px h-[calc(100%+1px)] bg-accent shadow-[inset_0_-2px_0_0_var(--primary)]"
          : "bg-transparent",
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        onClick={onActivate}
        className={cn(
          "flex items-center gap-1.5 truncate",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "shrink-0 font-mono text-[11px]",
            METHOD_COLOR[request.method],
          )}
        >
          {request.method}
        </span>
        {request.name}
      </button>
      <button
        type="button"
        aria-label={`Close ${request.name}`}
        onClick={onClose}
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
    setActiveRequest,
    reorderRequests,
    closeRequest,
    isSettingsOpen,
    isSettingsActive,
    openSettings,
    closeSettings,
    newRequest,
  } = useWorkspace();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const from = openRequestIds.indexOf(String(active.id));
    const to = openRequestIds.indexOf(String(over.id));
    if (from === -1 || to === -1) {
      return;
    }
    reorderRequests(arrayMove(openRequestIds, from, to));
  };

  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-muted/30">
      <div
        role="tablist"
        aria-label="Open requests"
        className="flex h-full items-stretch"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={openRequestIds}
            strategy={horizontalListSortingStrategy}
          >
            {openRequestIds.map((id) => {
              const request = requestsById.get(id);
              if (!request) {
                return null;
              }
              return (
                <RequestTab
                  key={id}
                  id={id}
                  request={request}
                  isActive={id === activeRequestId && !isSettingsActive}
                  onActivate={() => setActiveRequest(id)}
                  onClose={() => closeRequest(id)}
                />
              );
            })}
          </SortableContext>
        </DndContext>
        {isSettingsOpen && (
          <div
            className={cn(
              "flex h-full items-center gap-1 border-r px-3 text-sm hover:bg-accent",
              isSettingsActive
                ? "-mb-px h-[calc(100%+1px)] bg-accent shadow-[inset_0_-2px_0_0_var(--primary)]"
                : "bg-transparent",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isSettingsActive}
              onClick={openSettings}
              className={cn(
                "flex items-center gap-1.5 truncate",
                isSettingsActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Settings aria-hidden="true" className="size-3.5 shrink-0" />
              Settings
            </button>
            <button
              type="button"
              aria-label="Close settings"
              onClick={closeSettings}
              className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
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
