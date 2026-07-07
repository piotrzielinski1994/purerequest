import { useEffect, useMemo, useRef, useState } from "react";
import type { JSONSchema7 } from "json-schema";
import { CodeEditor } from "@/components/workspace/code-editor";
import { useEditorExtensions } from "@/components/workspace/use-editor-extensions";
import { makeSchemaExtensions } from "@/components/workspace/schema-intellisense";
import {
  folderConfigJsonSchema,
  requestSettingsJsonSchema,
} from "@/lib/config-schema/json-schemas";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type {
  BodyMode,
  ConfigScope,
  HttpMethod,
  KeyValue,
  RequestBody,
  RequestNode,
  RequestParams,
  TreeNode,
} from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import type { RequestPatch } from "@/lib/workspace/update-request";
import { updateNodeConfig } from "@/lib/workspace/update-config";
import { setFolderEnvironmentColors } from "@/lib/workspace/update-folder-env-color";
import { updateRequest } from "@/lib/workspace/update-request";
import { diskToBody } from "@/lib/workspace/body-codec";
import {
  bodyField,
  configField,
  folderConfigDoc,
  paramsField,
  readConfig,
  readFolderConfigDoc,
} from "@/lib/workspace/disk-format";

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Shared raw-JSON editor shell: seeds from `saved`, registers the active-editor
// descriptor (dot / confirm / Mod+S / popup-save). No Save bar - saving is via
// Mod+S or the close-confirm popup; invalid JSON shows a red lint underline and
// makes the descriptor non-saveable (`canSave:false`). `parse` returns null for
// invalid input; `commit` folds the parsed value into a tree.
export function RawJsonEditor<T>({
  id,
  saved,
  parse,
  onSave,
  commit,
  schema,
}: {
  id: string;
  saved: string;
  parse: (text: string) => T | null;
  onSave: (parsed: T) => void;
  commit: (parsed: T, tree: TreeNode[]) => TreeNode[];
  schema?: JSONSchema7;
}) {
  const { registerActiveEditor } = useWorkspace();
  const { configExtensions } = useEditorExtensions();
  // Schema editors layer JSON-Schema lint/complete/hover over the SHARED config
  // extensions (same base the plain config editor uses, so chrome can't drift);
  // no schema -> the base itself.
  const extensions = useMemo(
    () => makeSchemaExtensions(configExtensions, schema),
    [schema, configExtensions],
  );
  const [text, setText] = useState(saved);

  // Re-seed when the saved snapshot changes (node switch, or a sibling panel's
  // save landing a fresh config) - a once-only useState initializer would freeze
  // the first render's stale value until a remount. Same render-time compare the
  // editable key-value table uses; `saved` is a string so this compares by value.
  const [seed, setSeed] = useState(saved);
  if (seed !== saved) {
    setSeed(saved);
    setText(saved);
  }

  const parsed = parse(text);

  const behaviorRef = useRef<{
    save: () => void;
    commitToTree: (tree: TreeNode[]) => TreeNode[];
  }>({ save: () => {}, commitToTree: (tree) => tree });
  useEffect(() => {
    behaviorRef.current = {
      save: () => {
        if (parsed !== null) {
          onSave(parsed);
        }
      },
      commitToTree: (tree) => (parsed !== null ? commit(parsed, tree) : tree),
    };
  }, [parsed, onSave, commit]);

  const isDirty = text !== saved;
  const canSave = parsed !== null;
  useEffect(() => {
    registerActiveEditor({
      scope: { kind: "config", id },
      isDirty,
      canSave,
      save: () => behaviorRef.current.save(),
      commitToTree: (tree) => behaviorRef.current.commitToTree(tree),
    });
    return () => registerActiveEditor(null);
  }, [id, isDirty, canSave, registerActiveEditor]);

  return (
    <div className="h-full min-h-0">
      <CodeEditor value={text} onChange={setText} extensions={extensions} />
    </div>
  );
}

// Config-only editor for a folder node (folder has no url/body/method). The doc
// is the ON-DISK folder shape: flat config fields with env border colors folded
// into each `environments` entry as `color` (so what you see here === what's on
// disk === what the Env tab's accent picker sets). Saving splits the doc back into
// the folder's config + its env-color map.
export function ConfigEditorForm({
  id,
  config,
  environmentColors = {},
}: {
  id: string;
  config: ConfigScope;
  environmentColors?: Record<string, string>;
}) {
  const { saveFolderConfigDoc } = useWorkspace();
  const parseFolderDoc = (text: string) => {
    const obj = parseObject(text);
    return obj === null ? null : readFolderConfigDoc(obj);
  };
  return (
    <RawJsonEditor
      id={id}
      saved={JSON.stringify(folderConfigDoc(config, environmentColors), null, 2)}
      parse={parseFolderDoc}
      onSave={(parsed) =>
        saveFolderConfigDoc(id, parsed.config, parsed.environmentColors)
      }
      commit={(parsed, tree) =>
        setFolderEnvironmentColors(
          updateNodeConfig(tree, id, parsed.config),
          id,
          parsed.environmentColors,
        )
      }
      schema={folderConfigJsonSchema}
    />
  );
}

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const BODY_MODES: BodyMode[] = ["json", "none", "form", "multipart"];

function isKeyValueArray(value: unknown): value is KeyValue[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as KeyValue).key === "string" &&
        typeof (row as KeyValue).value === "string",
    )
  );
}

// Validate + narrow the `body` object. Omitted -> default empty body. Each
// `types` slot is optional; json is any JSON value (nested JSON or a raw string),
// form/multipart are rows.
function parseBody(value: unknown): RequestBody | null {
  if (value === undefined) {
    return emptyBody();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as { active?: unknown; types?: unknown };
  if (
    typeof obj.active !== "string" ||
    !(BODY_MODES as string[]).includes(obj.active)
  ) {
    return null;
  }
  const types = (obj.types ?? {}) as Record<string, unknown>;
  if (typeof types !== "object" || types === null || Array.isArray(types)) {
    return null;
  }
  const formValid = types.form === undefined || isKeyValueArray(types.form);
  const multipartValid =
    types.multipart === undefined || isKeyValueArray(types.multipart);
  if (!formValid || !multipartValid) {
    return null;
  }
  return {
    active: obj.active as BodyMode,
    types: {
      json: diskToBody(types.json),
      form: (types.form as KeyValue[] | undefined) ?? [],
      multipart: (types.multipart as KeyValue[] | undefined) ?? [],
    },
  };
}

// Validate + narrow the `params` object. Omitted -> default empty params. Both
// `path` and `query` are rows arrays (consistent with headers); both optional.
function parseParams(value: unknown): RequestParams | null {
  if (value === undefined) {
    return emptyParams();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as { path?: unknown; query?: unknown };
  const pathValid = obj.path === undefined || isKeyValueArray(obj.path);
  const queryValid = obj.query === undefined || isKeyValueArray(obj.query);
  if (!pathValid || !queryValid) {
    return null;
  }
  return {
    path: (obj.path as KeyValue[] | undefined) ?? [],
    query: (obj.query as KeyValue[] | undefined) ?? [],
  };
}

function parseRequest(text: string): RequestPatch | null {
  const obj = parseObject(text);
  if (!obj) {
    return null;
  }
  const hasString = (key: string) => typeof obj[key] === "string";
  const validMethod =
    typeof obj.method === "string" &&
    (METHODS as string[]).includes(obj.method);
  const body = parseBody(obj.body);
  const params = parseParams(obj.params);
  if (
    !hasString("name") ||
    !validMethod ||
    !hasString("url") ||
    body === null ||
    params === null
  ) {
    return null;
  }
  // Config fields live FLAT at the top level; readConfig picks them off (and still
  // honors a legacy nested `config` for a hand-pasted old doc). Deep field
  // validity is advisory (the schema linter warns), matching the old behavior.
  return {
    name: obj.name as string,
    method: obj.method as HttpMethod,
    url: obj.url as string,
    body,
    params,
    config: readConfig(obj as Parameters<typeof readConfig>[0]),
  };
}

// Full-request editor for a request's Settings sub-tab: the whole node
// (name/method/url/body/params + flat config fields) as one JSON doc. Body,
// params, and config use the disk layer's minimal-diff fields so the editor
// matches the on-disk shape exactly.
export function RequestSettingsForm({ request }: { request: RequestNode }) {
  const { saveRequestNode } = useWorkspace();
  const saved = JSON.stringify(
    {
      name: request.name,
      method: request.method,
      url: request.url,
      ...bodyField(request.body),
      ...paramsField(request.params),
      ...configField(request.config),
    },
    null,
    2,
  );
  return (
    <RawJsonEditor
      id={request.id}
      saved={saved}
      parse={parseRequest}
      onSave={(patch) => saveRequestNode(request.id, patch)}
      commit={(patch, tree) => updateRequest(tree, request.id, patch)}
      schema={requestSettingsJsonSchema}
    />
  );
}
