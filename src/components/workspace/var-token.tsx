import { cn } from "@pziel/pureui";
import { Copy, PencilLine } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import {
  resolvePathTokenPreview,
  resolveTokenPreview,
  type TokenPreview,
} from "@/components/workspace/url-token";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { EffectiveConfig } from "@/lib/workspace/resolve";

// {{var}} or :param - the token grammar shared by the URL bar and config grids.
export const TOKEN_PATTERN = /(\{\{[^}]+\}\}|:[A-Za-z_][A-Za-z0-9_]*)/g;

function TokenValueEditor({ preview }: { preview: TokenPreview }) {
  const { setTokenValue, revealTokenSource } = useWorkspace();
  // Seed the input with the FULLY-RESOLVED value, not the raw token. A var whose
  // raw value is itself a {{token}} chain (e.g. CUSTOMER_ID = {{process.env.X}})
  // still shows the final string here - hover answers "what does this become?".
  const [draft, setDraft] = useState(preview.value);

  const commit = () => {
    if (draft !== preview.value) {
      // Write to the DRILLED terminal source (the real literal / `.env` key),
      // not the nearest row - editing a `{{process.env.X}}` pointer updates the
      // value it points at, leaving the pointer intact. The pencil below still
      // navigates to `target` (the nearest defining row).
      setTokenValue(preview.writeTarget, draft);
    }
  };

  // Every token popup is the same single-line shape: one editable input (the
  // raw value) + a copy button (copies the fully-resolved value). No separate
  // `= resolved` line - the input itself is the value, kept identical whether
  // the value is a literal or an indirect {{token}} chain.
  return (
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
          navigator.clipboard?.writeText(preview.value);
          toast("Copied to clipboard");
        }}
        className="flex shrink-0 items-center border-l px-2.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Copy className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Go to source"
        onClick={() => revealTokenSource(preview.target)}
        className="flex shrink-0 items-center border-l px-2.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <PencilLine className="size-3.5" />
      </button>
    </div>
  );
}

// The color of a resolved token by kind; a null preview (unresolved, with a
// resolution context present) is red. The no-context case never reaches here -
// TokenChip renders a flat span for it before this is called.
function colorFor(preview: TokenPreview | null): string {
  if (!preview) {
    return "text-red-500 dark:text-red-400";
  }
  if (preview.kind === "dotenv") {
    return "text-amber-500 dark:text-amber-400";
  }
  if (preview.kind === "environment" || preview.kind === "path") {
    return "text-sky-600 dark:text-sky-400";
  }
  return "text-emerald-500 dark:text-emerald-400";
}

// The shared chip shell: a kind-colored token wrapped in a hover card that
// previews / edits the resolved value (or an "unresolved" note). `flatColor`
// renders a plain, non-hoverable span when no resolution context is available.
function TokenChip({
  token,
  preview,
  hasContext,
  flatColor,
}: {
  token: string;
  preview: TokenPreview | null;
  hasContext: boolean;
  flatColor: string;
}) {
  if (!hasContext) {
    return <span className={flatColor}>{token}</span>;
  }
  return (
    <HoverCard openDelay={80} closeDelay={40}>
      <HoverCardTrigger asChild>
        <span
          className={cn(
            "pointer-events-auto cursor-default",
            colorFor(preview),
          )}
        >
          {token}
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 overflow-hidden p-0">
        {preview ? (
          <TokenValueEditor key={preview.value} preview={preview} />
        ) : (
          <span className="block p-3 font-mono text-xs text-muted-foreground">
            unresolved
          </span>
        )}
      </HoverCardContent>
    </HoverCard>
  );
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
  return (
    <TokenChip
      token={token}
      hasContext={effective !== null}
      flatColor="text-emerald-500 dark:text-emerald-400"
      preview={
        effective
          ? resolveTokenPreview(
              name,
              effective,
              processEnv,
              environment ?? undefined,
            )
          : null
      }
    />
  );
}

// A single `:name` path-param chip: same hover preview/edit card as a {{var}},
// but its value comes from the request's path values (not the resolved config).
// With no effective config OR no request context it stays a flat sky color.
export function PathTokenChip({
  token,
  name,
  effective,
  processEnv,
  requestId,
  pathValues,
}: {
  token: string;
  name: string;
  effective: EffectiveConfig | null;
  processEnv: Record<string, string>;
  requestId: string | null;
  pathValues: Record<string, string>;
}) {
  return (
    <TokenChip
      token={token}
      hasContext={effective !== null && requestId !== null}
      flatColor="text-sky-600 dark:text-sky-400"
      preview={
        effective
          ? resolvePathTokenPreview(
              name,
              requestId,
              pathValues,
              effective,
              processEnv,
            )
          : null
      }
    />
  );
}

// Render a string with its {{var}}/:param tokens colored. Plain text passes
// through verbatim. `requestId`/`pathValues` (present for the URL bar) give a
// `:name` token the same hover preview/edit card as a {{var}}; without them a
// `:name` stays a flat sky color.
export function TokenHighlight({
  text,
  effective,
  processEnv,
  environment,
  requestId = null,
  pathValues = {},
}: {
  text: string;
  effective: EffectiveConfig | null;
  processEnv: Record<string, string>;
  environment: string | null;
  requestId?: string | null;
  pathValues?: Record<string, string>;
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
            <PathTokenChip
              key={index}
              token={part}
              name={part.slice(1)}
              effective={effective}
              processEnv={processEnv}
              requestId={requestId}
              pathValues={pathValues}
            />
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}
