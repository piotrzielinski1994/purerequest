import { cn } from "@pziel/pureui";
import { useState } from "react";

// Accept #rrggbb or #rrggbbaa - the optional alpha pair lets the user dial the
// border's opacity (e.g. #dc262640 = faint red) instead of a fixed blend.
const HEX_COLOR = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;

// Presets carry a 50% alpha (`80`) so the recoloured borders read as a tint by
// default; the user can still type any #rrggbb(aa) for full control.
const ACCENT_PRESETS: { label: string; value: string | null }[] = [
  { label: "None", value: null },
  { label: "Green", value: "#16a34a80" },
  { label: "Blue", value: "#2563eb80" },
  { label: "Red", value: "#dc262680" },
];

// A flush bar control (lives in the Env toolbar, design.md "NO SPACING INSIDE A
// BAR"): a leading "Accent" label, preset swatches, the native picker, and a hex
// input - all h-full, sharing 1px dividers, no gaps. `disabled` greys it out when
// no env is selected.
export function AccentField({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  disabled?: boolean;
}) {
  const [hex, setHex] = useState(value ?? "");

  // Keep the hex text field in sync when the color changes from outside this field
  // (a preset swatch, the native picker, or switching the selected env); typing
  // drives it the other way. Sync during render (React's "adjust state on prop
  // change") rather than in an effect, so it never schedules a cascading re-render.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setHex(value ?? "");
  }

  const onHexChange = (next: string) => {
    setHex(next);
    if (next.length === 0) {
      onChange(null);
      return;
    }
    if (HEX_COLOR.test(next)) {
      onChange(next.toLowerCase());
    }
  };

  return (
    <div
      className={cn(
        "flex items-stretch border-r border-r-border",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <span className="flex h-full items-center border-r border-r-border px-3 text-xs text-muted-foreground">
        Accent
      </span>
      {ACCENT_PRESETS.map((preset) => {
        const isActive = value === preset.value;
        return (
          <button
            key={preset.label}
            type="button"
            aria-label={preset.label}
            aria-pressed={isActive}
            disabled={disabled}
            onClick={() => onChange(preset.value)}
            style={preset.value ? { backgroundColor: preset.value } : undefined}
            className={cn(
              "flex h-full w-8 shrink-0 items-center justify-center border-r border-r-border text-[10px]",
              isActive && "relative z-10 ring-1 ring-inset ring-foreground",
              !preset.value && "bg-transparent text-muted-foreground",
            )}
          >
            {preset.value ? null : "/"}
          </button>
        );
      })}
      <input
        type="color"
        aria-label="Accent color picker"
        disabled={disabled}
        // The native picker has no alpha channel; show the RGB part and keep the
        // user's chosen alpha pair when they nudge the hue.
        value={value ? value.slice(0, 7) : "#000000"}
        onChange={(event) =>
          onChange(
            event.target.value.toLowerCase() +
              (value && value.length === 9 ? value.slice(7) : ""),
          )
        }
        className="h-full w-8 shrink-0 cursor-pointer border-r border-r-border bg-transparent p-1"
      />
      <input
        aria-label="Hex"
        value={hex}
        disabled={disabled}
        onChange={(event) => onHexChange(event.target.value)}
        placeholder="#rrggbb(aa)"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="h-full w-32 bg-transparent px-2 font-mono text-xs shadow-none outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  );
}
