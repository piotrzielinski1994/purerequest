import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
} from "@pziel/pureui";
import { METHOD_COLOR } from "@/components/workspace/method-color";
import { TabLabel } from "@/components/workspace/tab-label";
import {
  type QuickOpenEntry,
  scoreQuickOpen,
} from "@/lib/workspace/quick-open";

// The breadcrumb is the " / "-joined ancestor folder path; the row only has
// space for its LAST segment (the nearest folder), pinned to the right.
const lastFolder = (breadcrumb: string): string =>
  breadcrumb.split(" / ").pop() ?? "";

type RequestQuickOpenProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: readonly QuickOpenEntry[];
  onSelect: (id: string) => void;
};

// cmdk owns the filtering + highlight so Enter selects the top-ranked row. It
// calls this per item with the item's `value` (the node id) and `keywords`
// ([name, breadcrumb, url]); we rank via the shared scorer. An empty search
// shows every row (score 1).
const quickOpenFilter = (
  _value: string,
  search: string,
  keywords?: string[],
): number => {
  if (search === "") {
    return 1;
  }
  const [name = "", breadcrumb = "", url = ""] = keywords ?? [];
  return scoreQuickOpen(search, { name, breadcrumb, url });
};

export function RequestQuickOpen({
  open,
  onOpenChange,
  entries,
  onSelect,
}: RequestQuickOpenProps) {
  const select = (id: string) => {
    onSelect(id);
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      filter={quickOpenFilter}
    >
      <CommandInput placeholder="Search requests…" />
      <CommandList>
        <CommandEmpty>No matching requests</CommandEmpty>
        {entries.map((entry) => (
          <CommandItem
            key={entry.id}
            value={entry.id}
            keywords={[entry.name, entry.breadcrumb, entry.url ?? ""]}
            onSelect={() => select(entry.id)}
            className="group"
          >
            {entry.method && (
              <span
                className={cn(
                  "shrink-0 font-mono text-[12px]",
                  METHOD_COLOR[entry.method],
                )}
              >
                {entry.method}
              </span>
            )}
            <TabLabel className="min-w-0 flex-1 max-w-none">
              {entry.name}
            </TabLabel>
            {entry.breadcrumb !== "" && (
              <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                {lastFolder(entry.breadcrumb)}
              </span>
            )}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
