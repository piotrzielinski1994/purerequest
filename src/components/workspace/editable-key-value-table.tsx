import { useEffect, useRef, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeyValue } from "@/components/workspace/mock-data";

const BLANK: KeyValue = { key: "", value: "" };

const dropBlankKeys = (rows: KeyValue[]) =>
  rows.filter((row) => row.key.trim() !== "");

// Editable key/value grid (CSS grid: [checkbox] key value [delete]). Edits buffer
// in a local draft and commit to the parent on blur via onChange(rows). A pending
// (un-blurred) edit is also flushed on unmount, so switching tabs - which unmounts
// the panel and can swallow the input's blur - never loses the last keystroke.
// A trailing blank row is always shown; typing into it materializes the row + a
// fresh blank appears (no Add-row button). Optional per-row enable toggle
// (headers/params). A blank-key row is dropped on commit.
export function EditableKeyValueTable({
  rows,
  onChange,
  withToggle = false,
  keyPlaceholder = "key",
  valuePlaceholder = "value",
}: {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  withToggle?: boolean;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const [draft, setDraft] = useState<KeyValue[]>(rows);
  const [isDirty, setIsDirty] = useState(false);

  // Refs mirror state for the blur/unmount flush: a cleanup closure can't read
  // the latest state without re-subscribing the effect every render. Synced in an
  // effect (never during render) per react-hooks/refs.
  const draftRef = useRef(draft);
  const isDirtyRef = useRef(isDirty);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    draftRef.current = draft;
    isDirtyRef.current = isDirty;
    onChangeRef.current = onChange;
  });

  // Reseed when the upstream rows change identity (node switch / external save).
  const [seed, setSeed] = useState(rows);
  if (seed !== rows) {
    setSeed(rows);
    setDraft(rows);
    setIsDirty(false);
  }

  // Flush any pending (un-blurred) edit when the panel unmounts (tab switch).
  useEffect(
    () => () => {
      if (isDirtyRef.current) {
        onChangeRef.current(dropBlankKeys(draftRef.current));
      }
    },
    [],
  );

  // Commit immediately (toggle / delete - no typing, so no blur to wait for).
  const commitRows = (next: KeyValue[]) => {
    setDraft(next);
    setIsDirty(false);
    onChange(dropBlankKeys(next));
  };

  // Buffer a keystroke. Editing the trailing blank row (index === draft.length)
  // materializes it so a new blank row appears below. Commits on blur / unmount.
  const editCell = (index: number, patch: Partial<KeyValue>) => {
    setDraft((current) =>
      index < current.length
        ? current.map((row, i) => (i === index ? { ...row, ...patch } : row))
        : [...current, { ...BLANK, ...patch }],
    );
    setIsDirty(true);
  };

  const flush = () => {
    if (isDirtyRef.current) {
      onChange(dropBlankKeys(draftRef.current));
      setIsDirty(false);
    }
  };

  const cols = withToggle ? "2.25rem 1fr 1fr 2.25rem" : "1fr 1fr 2.25rem";
  const display = [...draft, BLANK];

  return (
    <div
      role="grid"
      className="grid border-t border-l border-border"
      style={{ gridTemplateColumns: cols }}
    >
      {display.map((row, index) => {
        const isBlankRow = index === draft.length;
        const isDisabled = row.enabled === false;
        const cell = "border-r border-b border-border bg-background";
        const input = cn(
          "h-9 w-full bg-background px-2 font-mono text-xs outline-none placeholder:text-muted-foreground",
          isDisabled && "text-muted-foreground line-through",
        );
        return (
          <div key={index} className="contents">
            {withToggle && (
              <div className={cell}>
                {!isBlankRow && (
                  <label className="relative flex size-full cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      aria-label={`Enable ${row.key || "row"}`}
                      checked={!isDisabled}
                      onChange={(event) =>
                        commitRows(
                          draftRef.current.map((r, i) =>
                            i === index
                              ? { ...r, enabled: event.target.checked }
                              : r,
                          ),
                        )
                      }
                      className="peer absolute inset-0 size-full cursor-pointer appearance-none outline-none"
                    />
                    <Check className="pointer-events-none size-3.5 opacity-0 peer-checked:opacity-100" />
                  </label>
                )}
              </div>
            )}
            <div className={cell}>
              <input
                aria-label={`${keyPlaceholder} ${index + 1}`}
                value={row.key}
                placeholder={isBlankRow ? keyPlaceholder : undefined}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => editCell(index, { key: event.target.value })}
                onBlur={flush}
                className={input}
              />
            </div>
            <div className={cell}>
              <input
                aria-label={`${valuePlaceholder} ${index + 1}`}
                value={row.value}
                placeholder={isBlankRow ? valuePlaceholder : undefined}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) =>
                  editCell(index, { value: event.target.value })
                }
                onBlur={flush}
                className={input}
              />
            </div>
            <div className={cn(cell, "flex items-center justify-center")}>
              {!isBlankRow && (
                <button
                  type="button"
                  aria-label={`Remove ${row.key || "row"}`}
                  onClick={() =>
                    commitRows(draftRef.current.filter((_, i) => i !== index))
                  }
                  className="flex items-center text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
