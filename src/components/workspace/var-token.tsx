import { useState } from "react";
import { Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  resolveTokenPreview,
  type TokenPreview,
} from "@/components/workspace/url-token";
import type { EffectiveConfig } from "@/lib/workspace/resolve";

// {{var}} or :param - the token grammar shared by the URL bar and config grids.
export const TOKEN_PATTERN = /(\{\{[^}]+\}\}|:[A-Za-z_][A-Za-z0-9_]*)/g;

function TokenValueEditor({ preview }: { preview: TokenPreview }) {
  const { setTokenValue } = useWorkspace();
  const { show } = useToast();
  const [draft, setDraft] = useState(preview.rawValue);

  const commit = () => {
    if (draft !== preview.rawValue) {
      setTokenValue(preview.target, draft);
    }
  };

  // When the raw value is itself a {{token}}, its fully-resolved form differs -
  // show it as a read-only line so a hover answers "what does this become?".
  const isIndirect = preview.value !== preview.rawValue;

  return (
    <div className="flex flex-col">
      <div className="flex items-stretch">
        <Input
          aria-label="Value"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
              (event.target as HTMLInputElement).blur();
            }
          }}
          className="h-9 flex-1 rounded-none border-0 bg-transparent font-mono text-xs shadow-none focus-visible:ring-0"
        />
        <button
          type="button"
          aria-label="Copy value"
          onClick={() => {
            navigator.clipboard?.writeText(isIndirect ? preview.value : draft);
            show("Copied to clipboard");
          }}
          className="flex shrink-0 items-center border-l px-2.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Copy className="size-3.5" />
        </button>
      </div>
      {isIndirect && (
        <div className="border-t px-2.5 py-1.5 font-mono text-xs">
          <span className="text-muted-foreground">= </span>
          <span className="text-emerald-500 dark:text-emerald-400">
            {preview.value}
          </span>
        </div>
      )}
    </div>
  );
}

function colorFor(preview: TokenPreview | null): string {
  if (!preview) {
    return "text-red-500 dark:text-red-400";
  }
  if (preview.kind === "dotenv") {
    return "text-amber-500 dark:text-amber-400";
  }
  if (preview.kind === "environment") {
    return "text-sky-600 dark:text-sky-400";
  }
  return "text-emerald-500 dark:text-emerald-400";
}

// A single {{var}} chip: resolution-aware color + a hover card previewing /
// editing the resolved value. With no effective config (e.g. a folder pane, no
// single resolution) it falls back to a flat emerald color and no hover.
export function VarTokenChip({
  token,
  name,
  effective,
  processEnv,
  environment,
}: {
  token: string;
  name: string;
  effective: EffectiveConfig | null;
  processEnv: Record<string, string>;
  environment: string | null;
}) {
  if (!effective) {
    return (
      <span className="text-emerald-500 dark:text-emerald-400">{token}</span>
    );
  }
  const preview = resolveTokenPreview(
    name,
    effective,
    processEnv,
    environment ?? undefined,
  );

  return (
    <HoverCard openDelay={80} closeDelay={40}>
      <HoverCardTrigger asChild>
        <span
          className={cn("pointer-events-auto cursor-default", colorFor(preview))}
        >
          {token}
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 overflow-hidden p-0">
        {preview ? (
          <TokenValueEditor key={preview.rawValue} preview={preview} />
        ) : (
          <span className="block p-3 font-mono text-xs text-muted-foreground">
            unresolved
          </span>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

// Render a string with its {{var}}/:param tokens colored. Plain text passes
// through verbatim.
export function TokenHighlight({
  text,
  effective,
  processEnv,
  environment,
}: {
  text: string;
  effective: EffectiveConfig | null;
  processEnv: Record<string, string>;
  environment: string | null;
}) {
  const parts = text.split(TOKEN_PATTERN);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("{{")) {
          return (
            <VarTokenChip
              key={index}
              token={part}
              name={part.slice(2, -2).trim()}
              effective={effective}
              processEnv={processEnv}
              environment={environment}
            />
          );
        }
        if (part.startsWith(":")) {
          return (
            <span key={index} className="text-sky-600 dark:text-sky-400">
              {part}
            </span>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}
