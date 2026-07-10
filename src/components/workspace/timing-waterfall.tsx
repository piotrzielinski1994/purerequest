import { ScrollArea } from "@/components/ui/scroll-area";
import type { RequestResponse } from "@/lib/workspace/model";
import { buildWaterfallRows } from "@/lib/http/timing";
import { formatDuration } from "@/lib/http/format";

function TimingRow({
  label,
  ms,
  percent,
}: {
  label: string;
  ms: number;
  percent: number;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 font-mono text-xs">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-2 min-w-0 flex-1 bg-muted/30">
        <div
          className="h-full bg-foreground/70"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right text-muted-foreground">
        {formatDuration(ms)}
      </span>
    </div>
  );
}

export function TimingWaterfall({ response }: { response: RequestResponse }) {
  if (!response.timings) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No timing data for this response.
      </div>
    );
  }

  const rows = buildWaterfallRows(response.timings, response.timeMs);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col py-2">
        {rows.map((row) => (
          <TimingRow
            key={row.label}
            label={row.label}
            ms={row.ms}
            percent={row.percent}
          />
        ))}
        <div className="mx-3 my-1 border-t border-border" />
        <div className="flex items-center gap-3 px-3 py-1.5 font-mono text-xs">
          <span className="w-20 shrink-0 text-foreground">Total</span>
          <div className="min-w-0 flex-1" />
          <span className="w-16 shrink-0 text-right text-foreground">
            {formatDuration(response.timeMs)}
          </span>
        </div>
      </div>
    </ScrollArea>
  );
}
