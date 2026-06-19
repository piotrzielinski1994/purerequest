import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { KeyValueTable } from "@/components/workspace/key-value-table";
import { BodyEditor } from "@/components/workspace/body-editor";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Auth, RequestNode } from "@/components/workspace/mock-data";
import type { EffectiveConfig, ResolvedValue } from "@/lib/workspace/resolve";

const AUTH_TYPE_LABELS: Record<Auth["type"], string> = {
  inherit: "Inherit",
  none: "No Auth",
  bearer: "Bearer Token",
  basic: "Basic Auth",
};

function AuthFields({ auth }: { auth: Auth }) {
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
      <div className="flex flex-col gap-1">
        <label htmlFor="auth-token" className="text-xs text-muted-foreground">
          Token
        </label>
        <Input
          id="auth-token"
          readOnly
          value={auth.token}
          className="font-mono"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="auth-username"
          className="text-xs text-muted-foreground"
        >
          Username
        </label>
        <Input id="auth-username" readOnly value={auth.username} />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="auth-password"
          className="text-xs text-muted-foreground"
        >
          Password
        </label>
        <PasswordField value={auth.password} />
      </div>
    </div>
  );
}

function PasswordField({ value }: { value: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const Icon = isVisible ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input
        id="auth-password"
        type={isVisible ? "text" : "password"}
        readOnly
        value={value}
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

function AuthPanel({ auth }: { auth: Auth }) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Type</label>
        <Select value={auth.type}>
          <SelectTrigger aria-label="Auth type" className="w-48 text-xs">
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
      <AuthFields auth={auth} />
    </div>
  );
}

function EffectiveRow({
  label,
  resolved,
}: {
  label: string;
  resolved: ResolvedValue<string>;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="font-mono">{resolved.value}</span>
        <span className="text-xs text-muted-foreground">
          ← {resolved.from.scopeName}
        </span>
      </span>
    </div>
  );
}

function EffectiveSection({
  title,
  entries,
}: {
  title: string;
  entries: Record<string, ResolvedValue<string>>;
}) {
  const keys = Object.keys(entries);
  if (keys.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold tracking-wide uppercase">{title}</h3>
      {keys.map((key) => (
        <EffectiveRow key={key} label={key} resolved={entries[key]} />
      ))}
    </div>
  );
}

function EffectivePanel({ effective }: { effective: EffectiveConfig }) {
  const authValue =
    effective.auth.value.type === "bearer"
      ? effective.auth.value.token
      : effective.auth.value.type;

  return (
    <div className="flex flex-col gap-4 p-3 text-sm">
      <EffectiveSection title="Variables" entries={effective.variables} />
      <EffectiveSection title="Headers" entries={effective.headers} />
      <EffectiveSection title="Params" entries={effective.params} />
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold tracking-wide uppercase">Auth</h3>
        <EffectiveRow
          label={effective.auth.value.type}
          resolved={{ value: authValue, from: effective.auth.from }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold tracking-wide uppercase">
          Timeout
        </h3>
        <EffectiveRow
          label="timeoutMs"
          resolved={{
            value: String(effective.timeoutMs.value),
            from: effective.timeoutMs.from,
          }}
        />
      </div>
    </div>
  );
}

function RequestTabs({ request }: { request: RequestNode }) {
  const { activeRequestTab, setRequestTab, setRequestBody, effectiveConfig } =
    useWorkspace();

  return (
    <Tabs
      value={activeRequestTab}
      onValueChange={(value) => setRequestTab(value as typeof activeRequestTab)}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-10.25 items-stretch border-b bg-muted/30">
        <TabsList aria-label="Request sections" className={PANE_TABS_LIST}>
          <TabsTrigger value="auth" className={PANE_TABS_TRIGGER}>
            Auth
          </TabsTrigger>
          <TabsTrigger value="headers" className={PANE_TABS_TRIGGER}>
            Headers
          </TabsTrigger>
          <TabsTrigger value="params" className={PANE_TABS_TRIGGER}>
            Params
          </TabsTrigger>
          <TabsTrigger value="body" className={PANE_TABS_TRIGGER}>
            Body
          </TabsTrigger>
          <TabsTrigger value="script" className={PANE_TABS_TRIGGER}>
            Script
          </TabsTrigger>
          <TabsTrigger value="effective" className={PANE_TABS_TRIGGER}>
            Effective
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="auth">
        <AuthPanel auth={request.config.auth ?? { type: "inherit" }} />
      </TabsContent>
      <TabsContent value="headers">
        <KeyValueTable
          rows={request.config.headers ?? []}
          emptyLabel="No headers"
        />
      </TabsContent>
      <TabsContent value="params">
        <KeyValueTable
          rows={request.config.params ?? []}
          emptyLabel="No query params"
        />
      </TabsContent>
      <TabsContent value="body" className="min-h-0 flex-1">
        <BodyEditor
          key={request.id}
          value={request.body}
          onChange={(body) => setRequestBody(request.id, body)}
        />
      </TabsContent>
      <TabsContent value="script">
        <pre className="p-3 font-mono text-xs text-muted-foreground">
          {request.config.scripts?.pre || "// no pre-request script"}
        </pre>
      </TabsContent>
      <TabsContent value="effective">
        {effectiveConfig ? (
          <EffectivePanel effective={effectiveConfig} />
        ) : (
          <p className="p-3 text-sm text-muted-foreground">
            No resolved config
          </p>
        )}
      </TabsContent>
    </Tabs>
  );
}

export function RequestPane() {
  const { activeRequest } = useWorkspace();

  if (!activeRequest) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No request selected
      </div>
    );
  }

  return <RequestTabs request={activeRequest} />;
}
