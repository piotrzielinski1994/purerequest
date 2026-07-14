import { useState } from "react";
import { formatForDisplay } from "@tanstack/hotkeys";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings/settings-context";
import { useRecordHotkey } from "@/lib/shortcuts/record-hotkey";
import { findConflict } from "@/lib/shortcuts/resolve";
import {
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";

function actionName(id: ShortcutActionId): string {
  return SHORTCUT_ACTIONS.find((action) => action.id === id)?.name ?? id;
}

type ShortcutRowProps = {
  action: ShortcutAction;
  bindings: string[];
  effective: Record<ShortcutActionId, string[]>;
  hasOverride: boolean;
};

export function ShortcutRow({
  action,
  bindings,
  effective,
  hasOverride,
}: ShortcutRowProps) {
  const { addShortcut, removeShortcut, resetShortcut } = useSettings();
  const [conflictName, setConflictName] = useState<string | null>(null);

  const recorder = useRecordHotkey({
    onRecord: (hotkey) => {
      const owner = findConflict(hotkey, action.id, effective);
      if (owner !== null) {
        setConflictName(actionName(owner));
        return;
      }
      setConflictName(null);
      addShortcut(action.id, hotkey);
    },
    onCancel: () => setConflictName(null),
  });

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="flex-1 text-sm">{action.name}</span>
      <div className="flex flex-wrap items-center justify-end gap-1">
        {bindings.length === 0 && !recorder.isRecording && (
          <span className="text-xs text-muted-foreground">(disabled)</span>
        )}
        {bindings.map((binding) => (
          <span
            key={binding}
            className="flex items-center gap-1 border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-xs"
          >
            {formatForDisplay(binding)}
            <button
              type="button"
              aria-label={`Remove ${formatForDisplay(binding)} from ${action.name}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => removeShortcut(action.id, binding)}
            >
              ×
            </button>
          </span>
        ))}
        {recorder.isRecording && (
          <span className="font-mono text-xs text-muted-foreground">
            Press keys…
          </span>
        )}
        {conflictName !== null && (
          <span role="alert" className="text-xs text-destructive">
            {`${conflictName} already uses that shortcut`}
          </span>
        )}
      </div>
      {recorder.isRecording ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={recorder.cancelRecording}
        >
          Cancel
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Add shortcut for ${action.name}`}
          onClick={() => {
            setConflictName(null);
            recorder.startRecording();
          }}
        >
          Add
        </Button>
      )}
      {hasOverride && !recorder.isRecording && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Reset ${action.name}`}
          onClick={() => resetShortcut(action.id)}
        >
          Reset
        </Button>
      )}
    </div>
  );
}
