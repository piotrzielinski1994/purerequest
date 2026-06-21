import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import { EditableKeyValueTable } from "@/components/workspace/editable-key-value-table";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Auth, ConfigScope } from "@/components/workspace/mock-data";

const AUTH_TYPE_LABELS: Record<Auth["type"], string> = {
  inherit: "Inherit",
  none: "No Auth",
  bearer: "Bearer Token",
  basic: "Basic Auth",
};

function PasswordField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const Icon = isVisible ? EyeOff : Eye;
  const [draft, setDraft] = useState(value);
  const [seed, setSeed] = useState(value);
  if (seed !== value) {
    setSeed(value);
    setDraft(value);
  }

  return (
    <div className="relative">
      <Input
        id="auth-password"
        type={isVisible ? "text" : "password"}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== value) {
            onCommit(draft);
          }
        }}
        className="pr-9"
      />
      <button
        type="button"
        aria-label={isVisible ? "Hide password" : "Show password"}
        aria-pressed={isVisible}
        onClick={() => setIsVisible((visible) => !visible)}
        className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground hover:text-foreground"
      >
        <Icon className="size-4" />
      </button>
    </div>
  );
}

// Single-field commit-on-blur input (auth token / username).
function AuthTextField({
  id,
  label,
  value,
  mono = false,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  mono?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [seed, setSeed] = useState(value);
  if (seed !== value) {
    setSeed(value);
    setDraft(value);
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== value) {
            onCommit(draft);
          }
        }}
        className={mono ? "font-mono" : undefined}
      />
    </div>
  );
}

function AuthFields({
  auth,
  onChange,
}: {
  auth: Auth;
  onChange: (auth: Auth) => void;
}) {
  if (auth.type === "inherit") {
    return (
      <p className="text-sm text-muted-foreground">
        Inherited from parent folder
      </p>
    );
  }

  if (auth.type === "none") {
    return <p className="text-sm text-muted-foreground">No authentication</p>;
  }

  if (auth.type === "bearer") {
    return (
      <AuthTextField
        id="auth-token"
        label="Token"
        value={auth.token}
        mono
        onCommit={(token) => onChange({ type: "bearer", token })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <AuthTextField
        id="auth-username"
        label="Username"
        value={auth.username}
        onCommit={(username) => onChange({ ...auth, username })}
      />
      <div className="flex flex-col gap-1">
        <label
          htmlFor="auth-password"
          className="text-xs text-muted-foreground"
        >
          Password
        </label>
        <PasswordField
          value={auth.password}
          onCommit={(password) => onChange({ ...auth, password })}
        />
      </div>
    </div>
  );
}

// Switching auth type seeds sensible empty fields for the new variant.
export function authForType(type: Auth["type"]): Auth {
  if (type === "bearer") {
    return { type: "bearer", token: "" };
  }
  if (type === "basic") {
    return { type: "basic", username: "", password: "" };
  }
  return { type };
}

export function AuthPanel({ id, config }: { id: string; config: ConfigScope }) {
  const { saveNodeConfig } = useWorkspace();
  const auth = config.auth ?? { type: "inherit" };

  const change = (nextAuth: Auth) =>
    saveNodeConfig(id, { ...config, auth: nextAuth });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10.25 items-stretch border-b bg-muted/30">
        <Select
          value={auth.type}
          onValueChange={(type) => change(authForType(type as Auth["type"]))}
        >
          <SelectTrigger
            aria-label="Auth type"
            className="h-full! w-fit rounded-none border-0 border-r border-r-border bg-transparent text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
          >
            {AUTH_TYPE_LABELS[auth.type]}
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="inherit">Inherit</SelectItem>
            <SelectItem value="none">No Auth</SelectItem>
            <SelectItem value="bearer">Bearer Token</SelectItem>
            <SelectItem value="basic">Basic Auth</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="p-3">
        <AuthFields auth={auth} onChange={change} />
      </div>
    </div>
  );
}

export function VarsPanel({ id, config }: { id: string; config: ConfigScope }) {
  const { saveNodeConfig } = useWorkspace();
  const rows = Object.entries(config.variables ?? {}).map(([key, value]) => ({
    key,
    value,
  }));
  return (
    <EditableKeyValueTable
      rows={rows}
      keyPlaceholder="name"
      onChange={(next) =>
        saveNodeConfig(id, {
          ...config,
          variables: Object.fromEntries(next.map((r) => [r.key, r.value])),
        })
      }
    />
  );
}

export function HeadersPanel({
  id,
  config,
}: {
  id: string;
  config: ConfigScope;
}) {
  const { saveNodeConfig } = useWorkspace();
  return (
    <EditableKeyValueTable
      rows={config.headers ?? []}
      withToggle
      onChange={(headers) => saveNodeConfig(id, { ...config, headers })}
    />
  );
}

export function ParamsPanel({
  id,
  config,
}: {
  id: string;
  config: ConfigScope;
}) {
  const { saveNodeConfig } = useWorkspace();
  return (
    <EditableKeyValueTable
      rows={config.params ?? []}
      withToggle
      onChange={(params) => saveNodeConfig(id, { ...config, params })}
    />
  );
}

export function ScriptPanel({
  id,
  config,
}: {
  id: string;
  config: ConfigScope;
}) {
  const { saveNodeConfig } = useWorkspace();
  const commit = (patch: { pre?: string; post?: string }) =>
    saveNodeConfig(id, {
      ...config,
      scripts: { ...config.scripts, ...patch },
    });
  return (
    <Tabs defaultValue="pre" className="flex h-full min-h-0 flex-col gap-0">
      <div className="flex h-10.25 items-stretch border-b bg-muted/30">
        <TabsList aria-label="Script stage" className={PANE_TABS_LIST}>
          <TabsTrigger value="pre" className={PANE_TABS_TRIGGER}>
            Pre
          </TabsTrigger>
          <TabsTrigger value="post" className={PANE_TABS_TRIGGER}>
            Post
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="pre" className="min-h-0 flex-1">
        <ScriptField
          label="Pre-request"
          value={config.scripts?.pre ?? ""}
          onCommit={(pre) => commit({ pre })}
        />
      </TabsContent>
      <TabsContent value="post" className="min-h-0 flex-1">
        <ScriptField
          label="Post-response"
          value={config.scripts?.post ?? ""}
          onCommit={(post) => commit({ post })}
        />
      </TabsContent>
    </Tabs>
  );
}

function ScriptField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [seed, setSeed] = useState(value);
  if (seed !== value) {
    setSeed(value);
    setDraft(value);
  }
  return (
    <textarea
      aria-label={label}
      value={draft}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) {
          onCommit(draft);
        }
      }}
      className="h-full w-full resize-none bg-transparent p-2 font-mono text-xs shadow-none outline-none focus-visible:ring-0"
    />
  );
}
