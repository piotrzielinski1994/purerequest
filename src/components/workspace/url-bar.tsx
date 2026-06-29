import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { METHOD_COLOR } from "@/components/workspace/method-color";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { HighlightedInput } from "@/components/workspace/highlighted-input";
import { cn } from "@/lib/utils";
import type { EffectiveConfig } from "@/lib/workspace/resolve";
import type { HttpMethod } from "@/lib/workspace/model";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function UrlField({
  url,
  effective,
  processEnv,
  environment,
  ownScopeId,
  inputRef,
  onChange,
  onSend,
}: {
  url: string;
  effective: EffectiveConfig | null;
  processEnv: Record<string, string>;
  environment: string | null;
  ownScopeId: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (url: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="relative flex-1">
      <HighlightedInput
        ariaLabel="URL"
        value={url}
        onChange={onChange}
        inputRef={inputRef}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSend();
          }
        }}
        highlight={{ effective, processEnv, environment, ownScopeId }}
        paddingClass="px-3"
        className="size-full bg-transparent font-mono text-xs whitespace-pre outline-none"
      />
    </div>
  );
}

export function UrlBar() {
  const {
    activeRequest,
    responseState,
    effectiveConfig,
    processEnv,
    activeEnvironment,
    setRequestUrl,
    setRequestMethod,
    sendRequest,
    cancelRequest,
    focusUrlNonce,
  } = useWorkspace();

  const inputRef = useRef<HTMLInputElement>(null);
  // Focus the URL input when a new request bumps the nonce. The consumed-nonce
  // ref lives HERE (UrlBar is always mounted) not in UrlField, which unmounts in
  // the empty state - so creating the FIRST request (input mounts this render)
  // still focuses. Skip the initial value so it doesn't grab focus on load.
  const seenNonce = useRef(focusUrlNonce);
  useEffect(() => {
    if (focusUrlNonce === seenNonce.current) {
      return;
    }
    seenNonce.current = focusUrlNonce;
    inputRef.current?.focus();
    // When the create came from a radix ContextMenu item, the menu's focus
    // teardown runs right after this and would steal focus back - re-assert on
    // the next tick so the URL input wins the race.
    const settle = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(settle);
  }, [focusUrlNonce]);

  if (!activeRequest) {
    return (
      <div
        role="group"
        aria-label="URL bar"
        className="flex h-10.25 items-center border-b bg-muted/30 px-3 text-sm text-muted-foreground"
      >
        No request selected
      </div>
    );
  }

  const isSending = responseState(activeRequest.id).status === "sending";

  return (
    <div
      role="group"
      aria-label="URL bar"
      className="flex h-10.25 items-stretch border-b bg-muted/30"
    >
      <Select
        value={activeRequest.method}
        onValueChange={(method) =>
          setRequestMethod(activeRequest.id, method as HttpMethod)
        }
      >
        <SelectTrigger
          aria-label="Method"
          className={cn(
            "h-full! w-fit rounded-none border-0 border-r border-r-border bg-transparent font-mono text-xs font-bold shadow-none focus-visible:ring-0 dark:bg-transparent",
            METHOD_COLOR[activeRequest.method],
          )}
        >
          {activeRequest.method}
        </SelectTrigger>
        <SelectContent position="popper">
          {METHODS.map((method) => (
            <SelectItem key={method} value={method}>
              {method}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <UrlField
        url={activeRequest.url}
        effective={effectiveConfig}
        processEnv={processEnv}
        environment={activeEnvironment}
        ownScopeId={activeRequest.id}
        inputRef={inputRef}
        onChange={(url) => setRequestUrl(activeRequest.id, url)}
        onSend={() =>
          isSending
            ? cancelRequest(activeRequest.id)
            : sendRequest(activeRequest.id)
        }
      />
      {isSending ? (
        <Button
          type="button"
          variant="destructive"
          onClick={() => cancelRequest(activeRequest.id)}
          className="h-full rounded-none border-0 border-l border-l-border"
        >
          Stop
        </Button>
      ) : (
        <Button
          type="button"
          onClick={() => sendRequest(activeRequest.id)}
          className="h-full rounded-none border-0 border-l border-l-border"
        >
          Send
        </Button>
      )}
    </div>
  );
}
