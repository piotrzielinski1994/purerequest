import { useEffect, useRef, useState } from "react";
import { CodeEditor } from "@/components/workspace/code-editor";
import { useEditorExtensions } from "@/components/workspace/use-editor-extensions";
import { useWorkspace } from "@/components/workspace/workspace-context";

// Raw-text editor for the workspace-root `.env` (the resolution base for every
// request's `{{process.env.KEY}}`). Per-folder `.env` files are edited in each
// folder's Env tab; this is the global base. Free text (always saveable), saved
// via the save shortcut / close-confirm through the active-editor seam.
function RootEnvEditor({ seed }: { seed: string }) {
  const { saveEnv, registerActiveEditor } = useWorkspace();
  const { envExtensions } = useEditorExtensions();
  const [text, setText] = useState(seed);

  const [lastSeed, setLastSeed] = useState(seed);
  if (lastSeed !== seed) {
    setLastSeed(seed);
    setText(seed);
  }

  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    saveRef.current = () => saveEnv(text);
  }, [text, saveEnv]);

  const isDirty = text !== seed;
  useEffect(() => {
    registerActiveEditor({
      scope: { kind: "env" },
      isDirty,
      canSave: true,
      save: () => saveRef.current(),
    });
    return () => registerActiveEditor(null);
  }, [isDirty, registerActiveEditor]);

  return (
    <div className="h-72 min-h-0 border border-border">
      <CodeEditor value={text} onChange={setText} extensions={envExtensions} />
    </div>
  );
}

export function EnvSection() {
  const { envText } = useWorkspace();
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-lg font-medium">Env</h2>
      <p className="text-sm text-muted-foreground">
        The workspace-root <code>.env</code>: the base for every request&apos;s{" "}
        <code>{"{{process.env.KEY}}"}</code>. A folder&apos;s own <code>.env</code>{" "}
        (edited in its Env tab) overrides these. Gitignore it. Save with the save
        shortcut.
      </p>
      <div className="mt-2">
        <RootEnvEditor seed={envText} />
      </div>
    </section>
  );
}
