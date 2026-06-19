import { createContext, useContext } from "react";

export type DropPosition = "before" | "after" | "inside";

export type DropIndicator = { overId: string; position: DropPosition };

export type TreeDndState = {
  activeId: string | null;
  indicator: DropIndicator | null;
};

const TreeDndContext = createContext<TreeDndState>({
  activeId: null,
  indicator: null,
});

export const TreeDndProvider = TreeDndContext.Provider;

export function useTreeDnd(): TreeDndState {
  return useContext(TreeDndContext);
}
