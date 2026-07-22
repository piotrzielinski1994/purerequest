import { cn } from "@pziel/pureui";
import { Check, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HighlightedInput } from "@/components/workspace/highlighted-input";
import type { KeyValue } from "@/lib/workspace/model";
import type { EffectiveConfig } from "@/lib/workspace/resolve";

const BLANK: KeyValue = { key: "", value: "" };

// Resolution context for {{var}} highlighting in value cells. `effective` null
// (e.g. a folder pane, no single resolution) -> tokens get a flat color, no hover.
export type TokenHighlightContext = {
  effective: EffectiveConfig | null;
  processEnv: Record<string, string>;
  environment: string | null;
  // The scope being edited; token-autocomplete blanks the source label for a
  // variable defined in this scope (its name would otherwise repeat a long path).
  ownScopeId?: string;
  // The active request + its `:name` path-param values, so a `:name` token in the
  // URL gets the same hover preview/edit card as a {{var}}. Absent -> `:name`
  // tokens stay a flat color, no hover (e.g. a folder pane or a value cell).
  requestId?: string | null;
  pathValues?: Record<string, string>;
};

const dropBlankKeys = (rows: KeyValue[]) =>
  rows.filter((row) => row.key.trim() !== "");

// Editable key/value grid (CSS grid: [checkbox] key value [delete]). Each edit
// commits to the parent draft immediately via onChange(rows) - NOT buffered until
// blur - so Cmd+S saves the latest keystroke even while a cell still has focus
// (the parent draft is in-memory; disk persist happens only on Cmd+S). A trailing
// blank row is always shown; typing into it materializes the row + a fresh blank
// appears (no Add-row button). Optional per-row enable toggle (headers/params). A
// blank-key row is dropped on commit.
export function EditableKeyValueTable({
  rows,
  onChange,
  withToggle = false,
  keyPlaceholder = "key",
  valuePlaceholder = "value",
  highlight,
}: {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  withToggle?: boolean;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  highlight?: TokenHighlightContext;
}) {
  const [draft, setDraft] = useState<KeyValue[]>(rows);

  // `draftRef` mirrors `draft` so an edit handler reads the latest rows without a
  // stale closure (synced in an effect, never during render, per react-hooks/refs).
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });

  // Reseed when the upstream rows change identity (node switch / external save).
  const [seed, setSeed] = useState(rows);
  if (seed !== rows) {
    setSeed(rows);
    setDraft(rows);
  }

  // Apply an edit to the local draft AND commit it to the parent draft in the same
  // call. Committing on every change (not just blur) means Cmd+S saves the latest
  // edit even while the cell still has focus - the parent draft is in-memory now
  // (persist only on Cmd+S), so per-keystroke commit is cheap and removes the
  // blur/unmount-flush gap that lost edits on save.
  const apply = (next: KeyValue[]) => {
    draftRef.current = next;
    setDraft(next);
    onChange(dropBlankKeys(next));
  };

  // Editing the trailing blank row (index === draft.length) materializes it so a
  // new blank row appears below.
  const editCell = (index: number, patch: Partial<KeyValue>) =>
    apply(
      index < draftRef.current.length
        ? draftRef.current.map((row, i) =>
            i === index ? { ...row, ...patch } : row,
          )
        : [...draftRef.current, { ...BLANK, ...patch }],
    );

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
                        apply(
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
                onChange={(event) =>
                  editCell(index, { key: event.target.value })
                }
                className={input}
              />
            </div>
            <div className={cn(cell, "relative")}>
              <HighlightedInput
                ariaLabel={`${valuePlaceholder} ${index + 1}`}
                value={row.value}
                placeholder={isBlankRow ? valuePlaceholder : undefined}
                highlight={highlight}
                onChange={(value) => editCell(index, { value })}
                className={input}
              />
            </div>
            <div className={cn(cell, "flex items-center justify-center")}>
              {!isBlankRow && (
                <button
                  type="button"
                  aria-label={`Remove ${row.key || "row"}`}
                  onClick={() =>
                    apply(draftRef.current.filter((_, i) => i !== index))
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
