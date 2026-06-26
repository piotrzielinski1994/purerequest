import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { TokenHighlight } from "@/components/workspace/var-token";
import type { TokenHighlightContext } from "@/components/workspace/editable-key-value-table";

// The ONE token-aware text input used everywhere a {{var}} value is edited (URL
// bar, key/value cells, auth fields). When `highlight` is set it renders the
// transparent-input-over-a-highlight-overlay trick so tokens are colored + each
// is hoverable (preview/edit card); without it, a plain input. A `secret` field
// masks the text and adds a show/hide eye toggle (the overlay only renders while
// revealed, so a masked secret never leaks its tokens on screen). `paddingClass`
// is applied to BOTH the input and the overlay so the colored text sits exactly
// over the typed text (they must share horizontal padding to align).
export function HighlightedInput({
  value,
  onChange,
  highlight,
  secret = false,
  ariaLabel,
  placeholder,
  inputRef,
  onKeyDown,
  paddingClass = "px-2",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  highlight?: TokenHighlightContext;
  secret?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  paddingClass?: string;
  className?: string;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const Icon = isVisible ? EyeOff : Eye;
  const isMasked = secret && !isVisible;
  // Highlight overlay only when there's a context, the field isn't masked, and
  // there's text to color (an empty field shows its placeholder, not an overlay).
  const showOverlay = highlight !== undefined && !isMasked && value !== "";

  return (
    <div className="relative size-full">
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        type={isMasked ? "password" : "text"}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn(
          paddingClass,
          className,
          secret && "pr-9",
          showOverlay && "text-transparent caret-foreground",
        )}
      />
      {showOverlay && (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center truncate font-mono text-xs whitespace-pre",
            paddingClass,
            secret && "pr-9",
          )}
        >
          <TokenHighlight
            text={value}
            effective={highlight.effective}
            processEnv={highlight.processEnv}
            environment={highlight.environment}
          />
        </div>
      )}
      {secret && (
        <button
          type="button"
          aria-label={isVisible ? "Hide password" : "Show password"}
          aria-pressed={isVisible}
          onClick={() => setIsVisible((visible) => !visible)}
          className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground hover:text-foreground"
        >
          <Icon className="size-3.5" />
        </button>
      )}
    </div>
  );
}
