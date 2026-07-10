import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { KeyValueTable } from "@/components/workspace/key-value-table";
import { JsonViewer } from "@/components/workspace/json-viewer";
import { TimingWaterfall } from "@/components/workspace/timing-waterfall";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { RequestResponse } from "@/lib/workspace/model";
import { filterJson } from "@/lib/http/filter";
import {
  RESPONSE_RENDER_LIMIT_BYTES,
  formatBytes,
  formatDuration,
} from "@/lib/http/format";

function TooLargeBody({ body }: { body: string }) {
  const preview = body.slice(0, RESPONSE_RENDER_LIMIT_BYTES);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b bg-muted/30 p-3 font-mono text-xs text-muted-foreground">
        {`Response is ${formatBytes(body.length)} - showing the first ${formatBytes(
          preview.length,
        )}. Use a smaller request or a filter.`}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <pre className="p-3 font-mono text-xs">{preview}</pre>
      </ScrollArea>
    </div>
  );
}

function ResponseBody({ body }: { body: string }) {
  const [filter, setFilter] = useState("");

  if (body.length > RESPONSE_RENDER_LIMIT_BYTES) {
    return <TooLargeBody body={body} />;
  }

  const filtered = filterJson(body, filter);

  return (
    <>
      {filtered.ok ? (
        <ScrollArea className="min-h-0 flex-1">
          <JsonViewer text={filtered.text} />
        </ScrollArea>
      ) : (
        <div className="flex-1 overflow-auto p-3 font-mono text-xs text-muted-foreground">
          No match
        </div>
      )}
      <Input
        aria-label="Filter response"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter with a path, e.g. $.data.items[0]"
        className="h-9 rounded-none border-0 border-t bg-background px-3 font-mono text-xs shadow-none focus-visible:border-t-transparent focus-visible:bg-accent focus-visible:ring-[1px] focus-visible:ring-ring/50 focus-visible:ring-inset dark:bg-background"
      />
    </>
  );
}

function ResponseTabs({ response }: { response: RequestResponse }) {
  const { activeResponseTab, setResponseTab } = useWorkspace();

  return (
    <Tabs
      value={activeResponseTab}
      onValueChange={(value) =>
        setResponseTab(value as typeof activeResponseTab)
      }
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-10.25 items-stretch justify-between gap-2 overflow-x-auto border-b bg-muted/30">
        <TabsList aria-label="Response sections" className={PANE_TABS_LIST}>
          <TabsTrigger value="response" className={PANE_TABS_TRIGGER}>
            Response
          </TabsTrigger>
          <TabsTrigger value="headers" className={PANE_TABS_TRIGGER}>
            Headers
          </TabsTrigger>
          <TabsTrigger value="timing" className={PANE_TABS_TRIGGER}>
            Timing
          </TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-3 px-3 font-mono text-xs">
          <span className="text-green-600 dark:text-green-400">
            {response.status}
          </span>
          <span className="text-muted-foreground">
            {formatDuration(response.timeMs)}
          </span>
          <span className="text-muted-foreground">
            {formatBytes(response.sizeBytes)}
          </span>
        </div>
      </div>
      <TabsContent
        value="response"
        className="flex min-h-0 flex-col data-[state=inactive]:hidden"
      >
        <ResponseBody body={response.body} />
      </TabsContent>
      <TabsContent value="headers">
        <KeyValueTable rows={response.headers} emptyLabel="No headers" />
      </TabsContent>
      <TabsContent
        value="timing"
        className="flex min-h-0 flex-col data-[state=inactive]:hidden"
      >
        <TimingWaterfall response={response} />
      </TabsContent>
    </Tabs>
  );
}

function CenteredMessage({
  children,
  tone = "muted",
}: {
  children: string;
  tone?: "muted" | "error";
}) {
  return (
    <div
      className={
        tone === "error"
          ? "flex h-full items-center justify-center p-6 text-center text-sm text-red-600 dark:text-red-400"
          : "flex h-full items-center justify-center text-sm text-muted-foreground"
      }
    >
      {children}
    </div>
  );
}

export function ResponsePane() {
  const { activeRequest, responseState } = useWorkspace();

  if (!activeRequest) {
    return <CenteredMessage>No response</CenteredMessage>;
  }

  const state = responseState(activeRequest.id);

  if (state.status === "sending") {
    return <CenteredMessage>Sending…</CenteredMessage>;
  }
  if (state.status === "error") {
    return <CenteredMessage tone="error">{state.message}</CenteredMessage>;
  }

  const response =
    state.status === "success" ? state.response : activeRequest.response;
  if (!response) {
    return <CenteredMessage>No response</CenteredMessage>;
  }

  return (
    <ResponseTabs
      key={`${activeRequest.id}:${state.status}`}
      response={response}
    />
  );
}
