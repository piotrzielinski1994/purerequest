import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { EnvSelector } from "./env-selector";

export function Sidebar() {
  return (
    <div className="flex h-full flex-col bg-muted/30">
      <div className="flex h-9 shrink-0 items-center border-b pl-3 text-sm font-semibold justify-between">
        ReqUI
        <div className="flex h-full items-stretch">
          <EnvSelector />
        </div>
      </div>
      <SidebarTree />
    </div>
  );
}
