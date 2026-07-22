import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
} from "@pziel/pureui";
import { METHOD_COLOR } from "@/components/workspace/method-color";
import {
  type QuickOpenEntry,
  scoreQuickOpen,
} from "@/lib/workspace/quick-open";

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
            <span>{entry.name}</span>
            {entry.breadcrumb !== "" && (
              <span className="ml-auto truncate text-xs text-muted-foreground">
                {entry.breadcrumb}
              </span>
            )}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
