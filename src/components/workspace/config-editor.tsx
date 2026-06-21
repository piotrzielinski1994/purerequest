import { useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import {
  darculaChrome,
  darculaHighlight,
  emptyTolerantJsonLinter,
} from "@/components/workspace/editor-theme";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type {
  ConfigScope,
  HttpMethod,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";
import type { RequestPatch } from "@/lib/workspace/update-request";
import { updateNodeConfig } from "@/lib/workspace/update-config";
import { updateRequest } from "@/lib/workspace/update-request";
import { bodyToStored, storedToBody } from "@/lib/workspace/body-codec";

const extensions = [
  json(),
  linter(emptyTolerantJsonLinter()),
  lintGutter(),
  darculaChrome,
  syntaxHighlighting(darculaHighlight),
];

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
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
function RawJsonEditor<T>({
  id,
  saved,
  parse,
  onSave,
  commit,
}: {
  id: string;
  saved: string;
  parse: (text: string) => T | null;
  onSave: (parsed: T) => void;
  commit: (parsed: T, tree: TreeNode[]) => TreeNode[];
}) {
  const { registerActiveEditor } = useWorkspace();
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
      <CodeMirror
        value={text}
        onChange={setText}
        theme="none"
        extensions={extensions}
        height="100%"
        className="h-full text-xs"
      />
    </div>
  );
}

// Config-only editor for a folder node (folder has no url/body/method).
export function ConfigEditorForm({
  id,
  config,
}: {
  id: string;
  config: ConfigScope;
}) {
  const { saveNodeConfig } = useWorkspace();
  return (
    <RawJsonEditor
      id={id}
      saved={JSON.stringify(config, null, 2)}
      parse={parseObject}
      onSave={(parsed) => saveNodeConfig(id, parsed as ConfigScope)}
      commit={(parsed, tree) =>
        updateNodeConfig(tree, id, parsed as ConfigScope)
      }
    />
  );
}

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function isStoredBody(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const tagged = value as { type?: unknown; payload?: unknown };
  if (tagged.type === "json") {
    return "payload" in tagged;
  }
  if (tagged.type === "text") {
    return typeof tagged.payload === "string";
  }
  return false;
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
  const validConfig =
    typeof obj.config === "object" &&
    obj.config !== null &&
    !Array.isArray(obj.config);
  if (
    !hasString("name") ||
    !validMethod ||
    !hasString("url") ||
    !isStoredBody(obj.body) ||
    !validConfig
  ) {
    return null;
  }
  return {
    name: obj.name as string,
    method: obj.method as HttpMethod,
    url: obj.url as string,
    body: storedToBody(obj.body),
    config: obj.config as ConfigScope,
  };
}

// Full-request editor for a request's Settings sub-tab: the whole node
// (name/method/url/body/config) as one JSON doc.
export function RequestSettingsForm({ request }: { request: RequestNode }) {
  const { saveRequestNode } = useWorkspace();
  const saved = JSON.stringify(
    {
      name: request.name,
      method: request.method,
      url: request.url,
      body: bodyToStored(request.body),
      config: request.config,
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
    />
  );
}
