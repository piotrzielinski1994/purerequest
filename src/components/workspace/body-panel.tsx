import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { BodyEditor } from "@/components/workspace/body-editor";
import { GraphqlBodyEditor } from "@/components/workspace/graphql-body-editor";
import { EditableKeyValueTable } from "@/components/workspace/editable-key-value-table";
import { tokenCandidates } from "@/components/workspace/token-complete";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { BodyMode, RequestNode } from "@/lib/workspace/model";

const BODY_MODE_LABELS: Record<BodyMode, string> = {
  json: "JSON",
  none: "None",
  form: "Form URL Encoded",
  multipart: "Multipart Form",
  graphql: "GraphQL",
};

export function BodyPanel({ request }: { request: RequestNode }) {
  const {
    setRequestBody,
    setRequestBodyMode,
    setRequestForm,
    setRequestGraphqlQuery,
    setRequestGraphqlVariables,
    effectiveConfig,
    processEnv,
    activeEnvironment,
  } = useWorkspace();
  const mode = request.body.active;
  const highlight = {
    effective: effectiveConfig,
    processEnv,
    environment: activeEnvironment,
  };
  const candidates = tokenCandidates(effectiveConfig, processEnv, request.id);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10.25 items-stretch overflow-x-auto border-b bg-muted/30">
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
            <SelectItem value="graphql">GraphQL</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="min-h-0 flex-1">
        {mode === "json" && (
          <BodyEditor
            key={request.id}
            value={request.body.types.json}
            candidates={candidates}
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
            rows={request.body.types[mode]}
            withToggle
            highlight={highlight}
            onChange={(rows) => setRequestForm(request.id, rows)}
          />
        )}
        {mode === "graphql" && (
          <GraphqlBodyEditor
            key={request.id}
            query={request.body.types.graphql.query}
            variables={request.body.types.graphql.variables}
            candidates={candidates}
            onQueryChange={(query) => setRequestGraphqlQuery(request.id, query)}
            onVariablesChange={(vars) =>
              setRequestGraphqlVariables(request.id, vars)
            }
          />
        )}
      </div>
    </div>
  );
}
