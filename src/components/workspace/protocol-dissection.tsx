import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type {
  DissectionField,
  DissectionLayer,
  DissectionReach,
  DissectionSegment,
  RequestResponse,
} from "@/lib/workspace/model";

// A flattened field the tree renders as one row: keeps its nesting depth and a stable path key.
type FlatField = {
  field: DissectionField;
  depth: number;
  key: string;
};

function flattenFields(
  fields: DissectionField[],
  depth = 0,
  prefix = "",
): FlatField[] {
  return fields.flatMap((field, index) => {
    const key = `${prefix}${index}:${field.label}`;
    const row: FlatField = { field, depth, key };
    const children = field.children
      ? flattenFields(field.children, depth + 1, `${key}/`)
      : [];
    return [row, ...children];
  });
}

// Which hex byte indices a field covers (for highlighting). A pure byte field covers its whole
// byteLength; a bit field still highlights the containing byte(s) since hex is byte-granular.
function fieldByteRange(field: DissectionField): [number, number] | null {
  if (field.byteOffset === undefined || field.byteLength === undefined) {
    return null;
  }
  return [field.byteOffset, field.byteOffset + field.byteLength];
}

function HexView({
  hex,
  truncated,
  byteLen,
  highlight,
}: {
  hex: string;
  truncated: boolean;
  byteLen: number;
  highlight: [number, number] | null;
}) {
  const bytes = hex.length === 0 ? [] : hex.split(" ");

  return (
    <div className="bg-muted/30 p-2 font-mono text-xs leading-relaxed">
      <div className="flex flex-wrap gap-x-1 gap-y-0.5">
        {bytes.map((byte, index) => {
          const isLit =
            highlight !== null &&
            index >= highlight[0] &&
            index < highlight[1];
          return (
            <span
              key={index}
              className={cn(
                "px-0.5",
                isLit
                  ? "bg-foreground text-background"
                  : "text-muted-foreground",
              )}
            >
              {byte}
            </span>
          );
        })}
      </div>
      {truncated ? (
        <div className="mt-1 text-muted-foreground">
          {`… showing first ${bytes.length} of ${byteLen} bytes`}
        </div>
      ) : null}
    </div>
  );
}

function bitLabel(field: DissectionField): string | null {
  if (field.bitOffset === undefined || field.bitLength === undefined) {
    return null;
  }
  const end = field.bitOffset + field.bitLength - 1;
  const range =
    field.bitLength === 1
      ? `bit ${field.bitOffset}`
      : `bits ${field.bitOffset}-${end}`;
  return range;
}

function byteLabel(field: DissectionField): string | null {
  if (field.byteOffset === undefined || field.byteLength === undefined) {
    return null;
  }
  if (field.byteLength === 1) {
    return `byte ${field.byteOffset}`;
  }
  return `bytes ${field.byteOffset}-${field.byteOffset + field.byteLength - 1}`;
}

function FieldTree({
  segment,
}: {
  segment: DissectionSegment;
}) {
  const rows = flattenFields(segment.fields);
  const [selectedKey, setSelectedKey] = useState<string | null>(
    rows[0]?.key ?? null,
  );
  const selected = rows.find((row) => row.key === selectedKey);
  const highlight = selected ? fieldByteRange(selected.field) : null;

  return (
    <div className="flex flex-col">
      <HexView
        hex={segment.hex}
        truncated={segment.truncated}
        byteLen={segment.byteLen}
        highlight={highlight}
      />
      <div className="flex flex-col">
        {rows.map((row) => {
          const isSelected = row.key === selectedKey;
          const bits = bitLabel(row.field);
          const bytes = byteLabel(row.field);
          const position = bits ?? bytes;
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => setSelectedKey(row.key)}
              className={cn(
                "flex flex-col gap-0.5 border-b border-border px-3 py-1.5 text-left",
                isSelected ? "bg-accent" : "hover:bg-muted/40",
              )}
              style={{ paddingLeft: `${0.75 + row.depth * 1.25}rem` }}
            >
              <div className="flex items-baseline gap-3 font-mono text-xs">
                <span className="w-40 shrink-0 text-muted-foreground">
                  {row.field.label}
                </span>
                <span className="min-w-0 flex-1 break-words text-foreground">
                  {row.field.value}
                </span>
                {position ? (
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {position}
                  </span>
                ) : null}
              </div>
              {isSelected ? (
                <p className="pl-[calc(10rem+0.75rem)] text-xs leading-snug text-muted-foreground">
                  {row.field.meaning}
                </p>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const REACH_LABEL: Record<DissectionReach, string> = {
  decoded: "decoded",
  facts: "facts only",
  privileged: "needs capture driver",
  unreachable: "not observable",
};

function ReachBadge({ reach }: { reach: DissectionReach }) {
  return (
    <span
      className={cn(
        "shrink-0 px-1 py-px font-mono text-[10px] uppercase tracking-wide",
        reach === "decoded"
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground",
      )}
    >
      {REACH_LABEL[reach]}
    </span>
  );
}

// A clickable header row with a chevron that expands/collapses its section.
function CollapsibleHeader({
  expanded,
  onToggle,
  osi,
  title,
  meta,
  reach,
  tone,
}: {
  expanded: boolean;
  onToggle: () => void;
  osi?: number;
  title: string;
  meta?: string;
  reach?: DissectionReach;
  tone: "layer" | "segment";
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        "flex w-full items-baseline gap-2 px-3 text-left",
        tone === "layer"
          ? "bg-muted/50 py-2"
          : "bg-muted/20 py-1 text-[11px]",
        reach === "unreachable" && "opacity-60",
      )}
    >
      <Chevron
        className={cn(
          "size-3 shrink-0 self-center text-muted-foreground",
          tone === "segment" && "size-2.5",
        )}
      />
      {osi !== undefined ? (
        <span className="shrink-0 self-center font-mono text-[10px] text-muted-foreground">
          L{osi}
        </span>
      ) : null}
      <span className="font-mono text-xs text-foreground">{title}</span>
      {reach ? <ReachBadge reach={reach} /> : null}
      {meta ? (
        <span className="ml-auto truncate text-xs text-muted-foreground">
          {meta}
        </span>
      ) : null}
    </button>
  );
}

function SegmentSection({ segment }: { segment: DissectionSegment }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <CollapsibleHeader
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
        title={segment.title}
        tone="segment"
      />
      {expanded ? <FieldTree segment={segment} /> : null}
    </div>
  );
}

function LayerSection({ layer }: { layer: DissectionLayer }) {
  // Open the layers with content worth reading; collapse the ones we don't decode here
  // (uncaptured L2 + hardware L1) by default.
  const [expanded, setExpanded] = useState(
    layer.reach === "decoded" || layer.reach === "facts",
  );
  return (
    <div className="border-b border-border">
      <CollapsibleHeader
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
        osi={layer.osi}
        title={layer.name}
        meta={layer.summary}
        reach={layer.reach}
        tone="layer"
      />
      {expanded ? (
        <>
          {layer.fields.length > 0 ? (
            <div className="flex flex-col border-b border-border">
              {layer.fields.map((field) => (
                <div
                  key={`${layer.name}:${field.label}`}
                  className="flex flex-col gap-0.5 px-3 py-1.5"
                >
                  <div className="flex items-baseline gap-3 font-mono text-xs">
                    <span className="w-40 shrink-0 text-muted-foreground">
                      {field.label}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-foreground">
                      {field.value}
                    </span>
                  </div>
                  <p className="pl-[calc(10rem+0.75rem)] text-xs leading-snug text-muted-foreground">
                    {field.meaning}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          {layer.segments.map((segment, index) => (
            <SegmentSection
              key={`${layer.name}:${segment.title}:${index}`}
              segment={segment}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

export function ProtocolDissection({
  response,
}: {
  response: RequestResponse;
}) {
  if (!response.dissection || response.dissection.layers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No protocol dissection for this response.
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col">
        {response.dissection.layers.map((layer) => (
          <LayerSection key={layer.name} layer={layer} />
        ))}
      </div>
    </ScrollArea>
  );
}
