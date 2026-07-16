import { useState } from "react";
import { CornerLeftUp, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { HighlightedInput } from "@/components/workspace/highlighted-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import {
  EditableKeyValueTable,
  type TokenHighlightContext,
} from "@/components/workspace/editable-key-value-table";
import { ScriptEditor } from "@/components/workspace/script-editor";
import { AccentField } from "@/components/workspace/accent-field";
import { Tooltip } from "@/components/ui/tooltip";
import type { ScriptStage } from "@/lib/scripts/model";
import type { Auth, AuthMode, ConfigScope, KeyValue } from "@/lib/workspace/model";
import { emptyAuth } from "@/lib/workspace/model";
import type { ResolvedValue } from "@/lib/workspace/resolve";
import { parseDotenv } from "@/lib/workspace/environment";

const AUTH_TYPE_LABELS: Record<AuthMode, string> = {
  inherit: "Inherit",
  none: "No Auth",
  bearer: "Bearer Token",
  basic: "Basic Auth",
};

// Shared grid cell + input styling so the auth fields read like the Params grid.
const AUTH_CELL = "border-r border-b border-border bg-background";
const AUTH_INPUT =
  "h-9 w-full bg-background font-mono text-xs outline-none placeholder:text-muted-foreground";

// One label-cell + value-cell row inside the auth grid. The value is a
// token-aware HighlightedInput (so `{{var}}` colors + hovers like everywhere
// else); a `secret` field masks + adds the show/hide toggle.
function AuthRow({
  label,
  value,
  secret = false,
  highlight,
  onCommit,
}: {
  label: string;
  value: string;
  secret?: boolean;
  highlight?: TokenHighlightContext;
  onCommit: (value: string) => void;
}) {
  return (
    <div className="contents">
      <div className={cn(AUTH_CELL, "flex items-center px-2")}>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className={cn(AUTH_CELL, "relative")}>
        <HighlightedInput
          ariaLabel={label}
          value={value}
          secret={secret}
          highlight={highlight}
          onChange={onCommit}
          className={AUTH_INPUT}
        />
      </div>
    </div>
  );
}

// The fields for the ACTIVE auth type. bearer/basic edit their own `types` slot
// (the other slot is retained untouched, so switching type preserves it);
// inherit/none carry no fields.
function AuthFields({
  auth,
  highlight,
  onChange,
}: {
  auth: Auth;
  highlight?: TokenHighlightContext;
  onChange: (auth: Auth) => void;
}) {
  if (auth.active === "inherit") {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        Inherited from parent folder
      </p>
    );
  }

  if (auth.active === "none") {
    return (
      <p className="p-3 text-sm text-muted-foreground">No authentication</p>
    );
  }

  return (
    <div
      role="grid"
      aria-label="Auth fields"
      className="grid border-t border-l border-border"
      style={{ gridTemplateColumns: "8rem 1fr" }}
    >
      {auth.active === "bearer" ? (
        <AuthRow
          label="Token"
          value={auth.types.bearer.token}
          highlight={highlight}
          onCommit={(token) =>
            onChange({ ...auth, types: { ...auth.types, bearer: { token } } })
          }
        />
      ) : (
        <>
          <AuthRow
            label="Username"
            value={auth.types.basic.username}
            highlight={highlight}
            onCommit={(username) =>
              onChange({
                ...auth,
                types: {
                  ...auth.types,
                  basic: { ...auth.types.basic, username },
                },
              })
            }
          />
          <AuthRow
            label="Password"
            value={auth.types.basic.password}
            secret
            highlight={highlight}
            onCommit={(password) =>
              onChange({
                ...auth,
                types: {
                  ...auth.types,
                  basic: { ...auth.types.basic, password },
                },
              })
            }
          />
        </>
      )}
    </div>
  );
}

export function AuthPanel({
  config,
  onChange,
  highlight,
}: {
  config: ConfigScope;
  onChange: (config: ConfigScope) => void;
  highlight?: TokenHighlightContext;
}) {
  const auth = config.auth ?? emptyAuth();

  const change = (nextAuth: Auth) => onChange({ ...config, auth: nextAuth });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10.25 items-stretch overflow-x-auto border-b bg-muted/30">
        <Select
          value={auth.active}
          onValueChange={(active) =>
            change({ ...auth, active: active as Auth["active"] })
          }
        >
          <SelectTrigger
            aria-label="Auth type"
            className="h-full! w-fit rounded-none border-0 border-r border-r-border bg-transparent text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
          >
            {AUTH_TYPE_LABELS[auth.active]}
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="inherit">Inherit</SelectItem>
            <SelectItem value="none">No Auth</SelectItem>
            <SelectItem value="bearer">Bearer Token</SelectItem>
            <SelectItem value="basic">Basic Auth</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <AuthFields auth={auth} highlight={highlight} onChange={change} />
    </div>
  );
}

// The folder-only Env tab: a sub-bar switching between "Envs" (a picked
// environment's vars, edited into config.environments[env]) and ".env" (the
// folder's own dotenv, edited as KEY=value rows). Both buffer into the folder
// draft via onConfigChange/onDotenvChange; the folder pane persists them in one
// save.
export function EnvPanel({
  config,
  dotenv,
  envNames,
  envColors,
  envOrigins,
  onEnvColorChange,
  highlight,
  reveal,
  onConfigChange,
  onDotenvChange,
}: {
  config: ConfigScope;
  dotenv: string;
  envNames: string[];
  envColors?: Record<string, string>;
  // env name -> nearest defining ancestor folder name (for the inherited marker).
  envOrigins?: Record<string, string>;
  onEnvColorChange?: (env: string, color: string | null) => void;
  highlight?: TokenHighlightContext;
  reveal: { nonce: number; view: "envs" | "dotenv"; env?: string } | null;
  onConfigChange: (config: ConfigScope) => void;
  onDotenvChange: (dotenv: string) => void;
}) {
  const envList = config.environments ?? [];
  const findEnv = (name: string) => envList.find((env) => env.name === name);
  const available = [
    ...new Set([...envNames, ...envList.map((env) => env.name)]),
  ].sort();
  const [picked, setPicked] = useState<string | null>(available[0] ?? null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newEnv, setNewEnv] = useState("");
  const [pendingDeleteEnv, setPendingDeleteEnv] = useState<string | null>(null);
  const [view, setView] = useState<"envs" | "dotenv">("envs");

  // A "go to source" jump selects the sub-view (Envs/.env) and, for an env var,
  // the env it lives in. Applied during render (the codebase's reseed idiom)
  // keyed by nonce, so the same jump re-fires but a later manual switch isn't
  // fought - and no setState-in-effect cascade.
  const [seenReveal, setSeenReveal] = useState<number | null>(null);
  if (reveal && seenReveal !== reveal.nonce) {
    setSeenReveal(reveal.nonce);
    setView(reveal.view);
    if (reveal.env !== undefined) {
      setPicked(reveal.env);
    }
  }

  const pickedExists = picked !== null && available.includes(picked);
  const activePicked = pickedExists ? picked : (available[0] ?? null);

  const addEnv = () => {
    const name = newEnv.trim();
    if (name === "" || available.includes(name)) {
      return;
    }
    onConfigChange({
      ...config,
      environments: [...envList, { name, variables: [] }],
    });
    setPicked(name);
    setNewEnv("");
    setIsAddOpen(false);
  };

  // Delete an env from THIS folder: drop its entry from config (draft) AND clear its
  // color (live). The union may still list it if an ancestor defines it, so it only
  // vanishes from the picker when no scope defines or colors it. Confirm first.
  const deleteEnv = (name: string) => {
    if (findEnv(name) !== undefined) {
      onConfigChange({
        ...config,
        environments: envList.filter((env) => env.name !== name),
      });
    }
    if (envColors?.[name] !== undefined) {
      onEnvColorChange?.(name, null);
    }
    setPicked(null);
    setPendingDeleteEnv(null);
  };

  const isPickedOwned =
    activePicked !== null && findEnv(activePicked) !== undefined;
  // A trash shows when the env is THIS folder's to remove: declared in its config OR
  // only colored here (then delete just clears the color). An env merely inherited
  // from a parent isn't this folder's to delete.
  const isPickedColoredHere =
    activePicked !== null && envColors?.[activePicked] !== undefined;
  const isPickedDeletable = isPickedOwned || isPickedColoredHere;
  // The folder name an env is INHERITED from: defined in an ANCESTOR and NOT declared
  // in THIS folder's config. Coloring it here doesn't make it owned - an inherited
  // env always shows the marker. `envOrigins` only maps a name to an ancestor when a
  // parent (not this folder) defines it, so a same-named env owned here returns null.
  const inheritedOrigin = (name: string): string | null =>
    findEnv(name) === undefined ? (envOrigins?.[name] ?? null) : null;
  const inheritedFrom =
    activePicked !== null ? inheritedOrigin(activePicked) : null;

  const envRows = activePicked ? (findEnv(activePicked)?.variables ?? []) : [];

  const dotenvRows = Object.entries(parseDotenv(dotenv)).map(
    ([key, value]) => ({ key, value }),
  );

  return (
    <>
    <Tabs
      value={view}
      onValueChange={(next) => setView(next as "envs" | "dotenv")}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <div className="flex h-10.25 items-stretch overflow-x-auto border-b bg-muted/30">
        <TabsList aria-label="Env views" className={PANE_TABS_LIST}>
          <TabsTrigger value="envs" className={PANE_TABS_TRIGGER}>
            Envs
          </TabsTrigger>
          <TabsTrigger value="dotenv" className={PANE_TABS_TRIGGER}>
            .env
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="envs" className="min-h-0 flex-1">
        <div className="flex h-10.25 items-stretch overflow-x-auto border-b bg-muted/30">
          <Select
            value={activePicked ?? ""}
            onValueChange={setPicked}
            disabled={available.length === 0}
          >
            {inheritedFrom !== null ? (
              <Tooltip content={`Inherited from ${inheritedFrom}`}>
                <SelectTrigger
                  aria-label="Environment"
                  className="h-full! w-fit min-w-32 rounded-none border-0 border-r border-r-border bg-transparent text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
                >
                  <span className="flex w-full items-center gap-1.5">
                    {activePicked}
                    <CornerLeftUp
                      aria-label={`Inherited from ${inheritedFrom}`}
                      className="size-3.5 text-muted-foreground"
                    />
                  </span>
                </SelectTrigger>
              </Tooltip>
            ) : (
              <SelectTrigger
                aria-label="Environment"
                className="h-full! w-fit min-w-32 rounded-none border-0 border-r border-r-border bg-transparent text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
              >
                {activePicked ?? "No environment"}
              </SelectTrigger>
            )}
            <SelectContent position="popper">
              {available.map((name) => {
                const from = inheritedOrigin(name);
                if (from === null) {
                  return (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  );
                }
                return (
                  <Tooltip
                    key={name}
                    side="right"
                    content={`Inherited from ${from}`}
                  >
                    <SelectItem value={name}>
                      <span className="flex w-full items-center gap-1.5">
                        {name}
                        <CornerLeftUp
                          aria-label={`Inherited from ${from}`}
                          className="size-3.5 text-muted-foreground"
                        />
                      </span>
                    </SelectItem>
                  </Tooltip>
                );
              })}
            </SelectContent>
          </Select>
          <button
            type="button"
            aria-label="Add environment"
            onClick={() => setIsAddOpen(true)}
            className="flex h-full items-center border-0 border-r border-r-border px-3 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
          {isPickedDeletable && (
            <button
              type="button"
              aria-label={`Delete environment ${activePicked}`}
              onClick={() => setPendingDeleteEnv(activePicked)}
              className="flex h-full items-center border-0 border-r border-r-border px-3 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          {onEnvColorChange && (
            <AccentField
              value={
                activePicked !== null
                  ? (envColors?.[activePicked] ?? null)
                  : null
              }
              disabled={activePicked === null}
              onChange={(color) =>
                activePicked !== null &&
                onEnvColorChange(activePicked, color)
              }
            />
          )}
        </div>
        {activePicked === null ? (
          <p className="p-3 text-sm text-muted-foreground">
            No environments yet. Add one to edit its variables.
          </p>
        ) : (
          <EditableKeyValueTable
            rows={envRows}
            keyPlaceholder="name"
            highlight={highlight}
            onChange={(next) =>
              onConfigChange({
                ...config,
                environments: findEnv(activePicked)
                  ? envList.map((env) =>
                      env.name === activePicked
                        ? { ...env, variables: next }
                        : env,
                    )
                  : [...envList, { name: activePicked, variables: next }],
              })
            }
          />
        )}
      </TabsContent>
      <TabsContent value="dotenv" className="min-h-0 flex-1">
        <EditableKeyValueTable
          rows={dotenvRows}
          highlight={highlight}
          onChange={(next) =>
            onDotenvChange(next.map((r) => `${r.key}=${r.value}`).join("\n"))
          }
        />
      </TabsContent>
    </Tabs>
    <Dialog
      open={isAddOpen}
      onOpenChange={(next) => {
        setIsAddOpen(next);
        if (!next) {
          setNewEnv("");
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>New environment</DialogTitle>
        </DialogHeader>
        <input
          aria-label="Environment name"
          value={newEnv}
          placeholder="name"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          onChange={(event) => setNewEnv(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              addEnv();
            }
          }}
          className="w-full bg-transparent p-2 font-mono text-xs shadow-none outline-none ring-1 ring-border focus-visible:ring-ring"
        />
        <DialogFooter>
          <Button
            type="button"
            disabled={
              newEnv.trim() === "" || available.includes(newEnv.trim())
            }
            onClick={addEnv}
          >
            Add
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsAddOpen(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog
      open={pendingDeleteEnv !== null}
      onOpenChange={(next) => {
        if (!next) {
          setPendingDeleteEnv(null);
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete environment "{pendingDeleteEnv ?? ""}"?</DialogTitle>
          <DialogDescription>
            Removes this environment&apos;s variables from this folder. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPendingDeleteEnv(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => deleteEnv(pendingDeleteEnv!)}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

// The scalar-config panel (the "Settings" tab). Holds the inheritable
// `timeoutMs`: an own value shows in the input; an unset scope leaves the input
// empty and its placeholder previews the RESOLVED effective value + origin
// (`30000 (default)` with no ancestor, `<value> (from <Scope>)` when inherited),
// mirroring the "Inherited from X" affordance the other panels use. Empty input
// strips the key (revert to inherit); a non-positive / non-integer entry is
// rejected so only a positive whole ms count (or a clear) ever commits.
export function GeneralPanel({
  config,
  effectiveTimeout,
  onChange,
}: {
  config: ConfigScope;
  effectiveTimeout: ResolvedValue<number>;
  onChange: (config: ConfigScope) => void;
}) {
  const placeholder =
    effectiveTimeout.from.scopeId === "default"
      ? `${effectiveTimeout.value} (default)`
      : `${effectiveTimeout.value} (from ${effectiveTimeout.from.scopeName})`;

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      const next = { ...config };
      delete next.timeoutMs;
      onChange(next);
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      return;
    }
    const parsed = Number(trimmed);
    if (parsed <= 0) {
      return;
    }
    onChange({ ...config, timeoutMs: parsed });
  };

  return (
    <div
      role="grid"
      aria-label="General fields"
      className="grid border-t border-l border-border"
      style={{ gridTemplateColumns: "8rem 1fr" }}
    >
      <div className="contents">
        <div className={cn(AUTH_CELL, "flex items-center px-2")}>
          <span className="text-xs text-muted-foreground">Timeout (ms)</span>
        </div>
        <div className={cn(AUTH_CELL, "relative")}>
          <input
            aria-label="Timeout"
            value={config.timeoutMs !== undefined ? String(config.timeoutMs) : ""}
            placeholder={placeholder}
            inputMode="numeric"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            onChange={(event) => commit(event.target.value)}
            className={cn(AUTH_INPUT, "px-2")}
          />
        </div>
      </div>
    </div>
  );
}

export function VarsPanel({
  config,
  onChange,
  highlight,
}: {
  config: ConfigScope;
  onChange: (config: ConfigScope) => void;
  highlight?: TokenHighlightContext;
}) {
  return (
    <EditableKeyValueTable
      rows={config.variables ?? []}
      keyPlaceholder="name"
      highlight={highlight}
      onChange={(variables) => onChange({ ...config, variables })}
    />
  );
}

export function HeadersPanel({
  config,
  onChange,
  highlight,
}: {
  config: ConfigScope;
  onChange: (config: ConfigScope) => void;
  highlight?: TokenHighlightContext;
}) {
  return (
    <EditableKeyValueTable
      rows={config.headers ?? []}
      withToggle
      highlight={highlight}
      onChange={(headers) => onChange({ ...config, headers })}
    />
  );
}

// The request Query grid: enabled/order/duplicate-key rows, bidirectionally
// mirrored to the URL by the caller. Query is request-owned now (no folder
// inheritance), so this panel edits a plain rows array, not a ConfigScope.
export function ParamsPanel({
  rows,
  onChange,
  highlight,
}: {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  highlight?: TokenHighlightContext;
}) {
  return (
    <EditableKeyValueTable
      rows={rows}
      withToggle
      highlight={highlight}
      onChange={onChange}
    />
  );
}

export function ScriptPanel({
  config,
  onChange,
}: {
  config: ConfigScope;
  onChange: (config: ConfigScope) => void;
}) {
  const commit = (patch: { pre?: string; post?: string }) =>
    onChange({
      ...config,
      scripts: { ...config.scripts, ...patch },
    });
  return (
    <Tabs defaultValue="pre" className="flex h-full min-h-0 flex-col gap-0">
      <div className="flex h-10.25 items-stretch overflow-x-auto border-b bg-muted/30">
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
          stage="pre"
          value={config.scripts?.pre ?? ""}
          onCommit={(pre) => commit({ pre })}
        />
      </TabsContent>
      <TabsContent value="post" className="min-h-0 flex-1">
        <ScriptField
          label="Post-response"
          stage="post"
          value={config.scripts?.post ?? ""}
          onCommit={(post) => commit({ post })}
        />
      </TabsContent>
    </Tabs>
  );
}

function ScriptField({
  label,
  stage,
  value,
  onCommit,
}: {
  label: string;
  stage: ScriptStage;
  value: string;
  onCommit: (value: string) => void;
}) {
  // Controlled: commit each edit straight into the parent draft so Cmd+S saves
  // the latest text even while the editor still has focus (no blur buffering).
  // The draft is in-memory now (persist only on Cmd+S), so per-keystroke commit
  // is cheap and removes the blur/unmount-flush gap that lost edits on save.
  return (
    <div className="h-full p-2">
      <ScriptEditor
        ariaLabel={label}
        stage={stage}
        value={value}
        onChange={onCommit}
      />
    </div>
  );
}
