import { useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import { ConfigEditorForm } from "@/components/workspace/config-editor";
import {
  AuthPanel,
  EnvPanel,
  GeneralPanel,
  HeadersPanel,
  ScriptPanel,
  VarsPanel,
} from "@/components/workspace/config-panels";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  environmentNamesForScope,
  environmentOrigins,
  resolveConfig,
  resolveProcessEnv,
} from "@/lib/workspace/resolve";
import { findNode } from "@/lib/workspace/tree-locate";
import { updateNodeConfig } from "@/lib/workspace/update-config";
import { updateFolderDotenv } from "@/lib/workspace/update-folder-dotenv";
import type { ConfigScope } from "@/lib/workspace/model";

type FolderTab =
  | "vars"
  | "auth"
  | "headers"
  | "script"
  | "env"
  | "settings"
  | "raw";

// Registers the folder's structured-config draft on the active-editor seam (so
// Cmd+S + close-confirm work) and renders the structured panels. Mounted ONLY on
// non-Settings sub-tabs - the Settings sub-tab's own RawJsonEditor owns the seam
// there. Making this a separately-mounted child (vs a `tab === "settings"`-gated
// effect in the parent) means it and the RawJsonEditor mount/unmount mutually
// exclusively, so React's unmount-before-mount ordering makes exactly one editor
// own the slot - no registration race that could clobber the Settings JSON save.
function FolderStructuredEditor({
  id,
  saved,
  savedDotenv,
  envColors,
  envNames,
  reveal,
}: {
  id: string;
  saved: ConfigScope;
  savedDotenv: string;
  envColors: Record<string, string>;
  envNames: string[];
  reveal: { nonce: number; view: "envs" | "dotenv"; env?: string } | null;
}) {
  const {
    saveFolder,
    setFolderEnvColor,
    registerActiveEditor,
    tree,
    activeEnvironment,
    rootProcessEnv,
  } = useWorkspace();

  // Local draft: structured-panel edits (config + the folder's .env) buffer here
  // and persist only on Cmd+S. Re-seed when the node OR its saved config/dotenv
  // changes identity - keyed by `id:configKey:dotenv` so a fresh-but-equal saved
  // object doesn't reset a pending edit.
  const savedKey = JSON.stringify(saved);
  const seedKey = `${id}:${savedKey}:${savedDotenv}`;
  const [draft, setDraft] = useState<ConfigScope>(saved);
  const [dotenvDraft, setDotenvDraft] = useState(savedDotenv);
  const [seed, setSeed] = useState(seedKey);
  if (seed !== seedKey) {
    setSeed(seedKey);
    setDraft(saved);
    setDotenvDraft(savedDotenv);
  }

  const isDirty =
    JSON.stringify(draft) !== savedKey || dotenvDraft !== savedDotenv;

  // save/commit read the LATEST drafts via a ref so the registration effect
  // doesn't re-run on every keystroke (and `saveFolder` is recreated each provider
  // render, so it's held in the ref too - keeping it out of the effect deps).
  const behaviorRef = useRef({ draft, dotenvDraft, saveFolder });
  useEffect(() => {
    behaviorRef.current = { draft, dotenvDraft, saveFolder };
  });

  useEffect(() => {
    registerActiveEditor({
      scope: { kind: "config", id },
      isDirty,
      canSave: true,
      save: () =>
        behaviorRef.current.saveFolder(
          id,
          behaviorRef.current.draft,
          behaviorRef.current.dotenvDraft,
        ),
      commitToTree: (currentTree) =>
        updateFolderDotenv(
          updateNodeConfig(currentTree, id, behaviorRef.current.draft),
          id,
          behaviorRef.current.dotenvDraft,
        ),
    });
    return () => registerActiveEditor(null);
  }, [id, isDirty, registerActiveEditor]);

  // Resolve THIS folder's own scope chain (root -> this folder) so its
  // {{token}} chips preview/hover like a request's. Resolved against the SAVED
  // tree (Bruno-style: previews reflect persisted values, not the in-flight
  // draft), folding the root `.env` over the folder chain for process.env.
  const highlight = {
    effective: resolveConfig(tree, id, {
      environment: activeEnvironment ?? undefined,
    }),
    processEnv: resolveProcessEnv(tree, id, rootProcessEnv),
    environment: activeEnvironment,
    ownScopeId: id,
  };

  // env name -> nearest defining folder name, so the panel can flag an env it
  // inherits from a parent (it's edited in the parent's scope, not this folder's).
  const envOrigins = environmentOrigins(tree, id);

  return (
    <>
      <TabsContent value="vars">
        <VarsPanel config={draft} onChange={setDraft} highlight={highlight} />
      </TabsContent>
      <TabsContent value="auth">
        <AuthPanel config={draft} onChange={setDraft} highlight={highlight} />
      </TabsContent>
      <TabsContent value="headers">
        <HeadersPanel config={draft} onChange={setDraft} highlight={highlight} />
      </TabsContent>
      <TabsContent value="script">
        <ScriptPanel config={draft} onChange={setDraft} />
      </TabsContent>
      <TabsContent value="settings">
        <GeneralPanel
          config={draft}
          effectiveTimeout={highlight.effective.timeoutMs}
          onChange={setDraft}
        />
      </TabsContent>
      <TabsContent value="env" className="min-h-0 flex-1">
        <EnvPanel
          config={draft}
          dotenv={dotenvDraft}
          envNames={envNames}
          envColors={envColors}
          envOrigins={envOrigins}
          onEnvColorChange={(env, color) => setFolderEnvColor(id, env, color)}
          highlight={highlight}
          reveal={reveal}
          onConfigChange={setDraft}
          onDotenvChange={setDotenvDraft}
        />
      </TabsContent>
    </>
  );
}

export function FolderPane() {
  const { editTarget, tree, revealTarget } = useWorkspace();
  const [tab, setTab] = useState<FolderTab>("vars");

  const node =
    editTarget?.kind === "config" ? findNode(tree, editTarget.id) : null;
  const folder = node && node.kind === "folder" ? node : null;
  // Scope the env picker to THIS folder's chain (env names declared along root ->
  // folder + any env this folder has colored), so it matches the sidebar combobox.
  // A sibling-only env must not leak in.
  const envNames = environmentNamesForScope(tree, folder?.id ?? null);

  // A "go to source" jump targeting THIS folder switches to the right tab.
  // Applied during render (the codebase's reseed idiom) keyed by nonce, so
  // re-revealing the same target re-fires but a later manual tab switch isn't
  // fought - and no setState-in-effect cascade.
  const reveal =
    revealTarget && folder && revealTarget.folderId === folder.id
      ? revealTarget
      : null;
  const [seenReveal, setSeenReveal] = useState<number | null>(null);
  if (reveal && seenReveal !== reveal.nonce) {
    setSeenReveal(reveal.nonce);
    setTab(reveal.view === "vars" ? "vars" : "env");
  }

  if (!folder) {
    return null;
  }

  const envReveal =
    reveal && (reveal.view === "envs" || reveal.view === "dotenv")
      ? { nonce: reveal.nonce, view: reveal.view, env: reveal.env }
      : null;

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as FolderTab)}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-10.25 items-stretch overflow-x-auto border-b bg-muted/30">
        <TabsList aria-label="Folder sections" className={PANE_TABS_LIST}>
          <TabsTrigger value="vars" className={PANE_TABS_TRIGGER}>
            Vars
          </TabsTrigger>
          <TabsTrigger value="auth" className={PANE_TABS_TRIGGER}>
            Auth
          </TabsTrigger>
          <TabsTrigger value="headers" className={PANE_TABS_TRIGGER}>
            Headers
          </TabsTrigger>
          <TabsTrigger value="script" className={PANE_TABS_TRIGGER}>
            Script
          </TabsTrigger>
          <TabsTrigger value="env" className={PANE_TABS_TRIGGER}>
            Env
          </TabsTrigger>
          <TabsTrigger value="settings" className={PANE_TABS_TRIGGER}>
            Settings
          </TabsTrigger>
          <TabsTrigger value="raw" className={PANE_TABS_TRIGGER}>
            Raw
          </TabsTrigger>
        </TabsList>
      </div>
      {tab === "raw" ? (
        <TabsContent value="raw" className="min-h-0 flex-1">
          <ConfigEditorForm
            key={folder.id}
            id={folder.id}
            config={folder.config}
            environmentColors={folder.environmentColors ?? {}}
          />
        </TabsContent>
      ) : (
        <FolderStructuredEditor
          id={folder.id}
          saved={folder.config}
          savedDotenv={folder.dotenv ?? ""}
          envColors={folder.environmentColors ?? {}}
          envNames={envNames}
          reveal={envReveal}
        />
      )}
    </Tabs>
  );
}
