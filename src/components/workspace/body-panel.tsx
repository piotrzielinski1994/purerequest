import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { BodyEditor } from "@/components/workspace/body-editor";
import { EditableKeyValueTable } from "@/components/workspace/editable-key-value-table";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { BodyMode, RequestNode } from "@/components/workspace/mock-data";

const BODY_MODE_LABELS: Record<BodyMode, string> = {
  json: "JSON",
  none: "None",
  form: "Form URL Encoded",
  multipart: "Multipart Form",
};

export function BodyPanel({ request }: { request: RequestNode }) {
  const { setRequestBody, setRequestBodyMode, setRequestForm } = useWorkspace();
  const mode = request.bodyMode ?? "json";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10.25 items-stretch border-b bg-muted/30">
        <Select
          value={mode}
          onValueChange={(next) =>
            setRequestBodyMode(request.id, next as BodyMode)
          }
        >
          <SelectTrigger
            aria-label="Body type"
            className="h-full! w-fit rounded-none border-0 border-r border-r-border bg-transparent text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
          >
            {BODY_MODE_LABELS[mode]}
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="json">JSON</SelectItem>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="form">Form URL Encoded</SelectItem>
            <SelectItem value="multipart">Multipart Form</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="min-h-0 flex-1">
        {mode === "json" && (
          <BodyEditor
            key={request.id}
            value={request.body}
            onChange={(body) => setRequestBody(request.id, body)}
          />
        )}
        {mode === "none" && (
          <p className="p-3 text-sm text-muted-foreground">
            This request has no body.
          </p>
        )}
        {(mode === "form" || mode === "multipart") && (
          <EditableKeyValueTable
            rows={request.bodyForm ?? []}
            withToggle
            onChange={(rows) => setRequestForm(request.id, rows)}
          />
        )}
      </div>
    </div>
  );
}
