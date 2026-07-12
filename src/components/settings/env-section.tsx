import { useEffect, useRef, useState } from "react";
import { EditableKeyValueTable } from "@/components/workspace/editable-key-value-table";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { parseDotenv } from "@/lib/workspace/environment";
import type { KeyValue } from "@/lib/workspace/model";

// The workspace-root `.env` (the resolution base for every request's
// `{{process.env.KEY}}`), edited as a KEY=value grid so it reads exactly like the
// folder Env views - a full-bleed grid, no heading/description chrome. Rows buffer
// in a draft and persist only on the save shortcut, via the active-editor seam.
export function EnvSection() {
  const { envText, saveEnv, registerActiveEditor } = useWorkspace();
  const seedRows: KeyValue[] = Object.entries(parseDotenv(envText)).map(
    ([key, value]) => ({ key, value }),
  );

  const [rows, setRows] = useState<KeyValue[]>(seedRows);

  const [lastSeed, setLastSeed] = useState(envText);
  if (lastSeed !== envText) {
    setLastSeed(envText);
    setRows(seedRows);
  }

  const serialized = rows.map((row) => `${row.key}=${row.value}`).join("\n");
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    saveRef.current = () => saveEnv(serialized);
  }, [serialized, saveEnv]);

  const isDirty = serialized !== envText;
  useEffect(() => {
    registerActiveEditor({
      scope: { kind: "env" },
      isDirty,
      canSave: true,
      save: () => saveRef.current(),
    });
    return () => registerActiveEditor(null);
  }, [isDirty, registerActiveEditor]);

  return <EditableKeyValueTable rows={rows} onChange={setRows} />;
}
