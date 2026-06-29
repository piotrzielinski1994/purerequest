import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { TokenHighlight } from "@/components/workspace/var-token";
import {
  applyTokenCandidate,
  tokenCandidates,
  tokenCompletionAt,
  type TokenCandidate,
} from "@/components/workspace/token-complete";
import type { TokenHighlightContext } from "@/components/workspace/editable-key-value-table";

const KIND_COLOR: Record<TokenCandidate["kind"], string> = {
  variable: "text-emerald-500 dark:text-emerald-400",
  environment: "text-sky-600 dark:text-sky-400",
  dotenv: "text-amber-500 dark:text-amber-400",
};

// The ONE token-aware text input used everywhere a {{var}} value is edited (URL
// bar, key/value cells, auth fields). When `highlight` is set it renders the
// transparent-input-over-a-highlight-overlay trick so tokens are colored + each
// is hoverable (preview/edit card), AND offers a {{token}} autocomplete dropdown
// (variables, the active env's vars, and process.env keys). Without `highlight`,
// a plain input. A `secret` field masks the text and adds a show/hide eye toggle
// (the overlay only renders while revealed, so a masked secret never leaks its
// tokens on screen). `paddingClass` is applied to BOTH the input and the overlay
// so the colored text sits exactly over the typed text.
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

  // Token autocomplete is offered for any highlight-aware, non-secret field.
  const completionEnabled = highlight !== undefined && !secret;
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  // Closed after an explicit pick/Escape until the value/caret next changes, so a
  // pick doesn't immediately reopen on the same caret position.
  const [isDismissed, setIsDismissed] = useState(false);

  const allCandidates = completionEnabled
    ? tokenCandidates(
        highlight.effective,
        highlight.processEnv,
        highlight.ownScopeId,
      )
    : [];
  const completion =
    completionEnabled && !isDismissed
      ? tokenCompletionAt(value, caret, allCandidates)
      : null;
  const isOpen = completion !== null;
  const activeCandidate = completion?.candidates[
    Math.min(activeIndex, completion.candidates.length - 1)
  ];

  // Keep the highlighted option scrolled into view as ArrowUp/Down moves past the
  // visible window, so the user can always see the next selectable value.
  const activeOptionRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  const syncCaret = (el: HTMLInputElement) => {
    setCaret(el.selectionStart ?? el.value.length);
    setIsDismissed(false);
    setActiveIndex(0);
  };

  const pick = (candidate: TokenCandidate) => {
    if (!completion) {
      return;
    }
    const next = applyTokenCandidate(value, completion, caret, candidate);
    onChange(next.text);
    setIsDismissed(true);
    // Restore the caret after the inserted token on the next frame (after the
    // controlled value re-renders).
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
        setCaret(next.caret);
      }
    });
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (isOpen && completion) {
      const count = completion.candidates.length;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % count);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + count) % count);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        // Swallow so the parent's onKeyDown (e.g. URL "send on Enter") never fires.
        event.preventDefault();
        event.stopPropagation();
        if (activeCandidate) {
          pick(activeCandidate);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setIsDismissed(true);
        return;
      }
    }
    onKeyDown?.(event);
  };

  return (
    <div className="relative size-full">
      <input
        ref={ref}
        aria-label={ariaLabel}
        type={isMasked ? "password" : "text"}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        // Keep the native textbox role (callers query it by role); just advertise
        // the autocomplete affordance via aria-* (valid on a textbox).
        aria-expanded={completionEnabled ? isOpen : undefined}
        aria-autocomplete={completionEnabled ? "list" : undefined}
        aria-controls={
          isOpen ? "highlighted-input-token-listbox" : undefined
        }
        onChange={(event) => {
          onChange(event.target.value);
          syncCaret(event.target);
        }}
        onKeyUp={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onBlur={() => setIsDismissed(true)}
        onKeyDown={onInputKeyDown}
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
      {isOpen && completion && (
        <ul
          id="highlighted-input-token-listbox"
          role="listbox"
          aria-label="Token suggestions"
          className="absolute top-full left-0 z-50 mt-px max-h-56 w-72 overflow-y-auto border border-border bg-popover py-1 shadow-md"
        >
          {completion.candidates.map((candidate, index) => (
            <li
              key={candidate.name}
              ref={index === activeIndex ? activeOptionRef : undefined}
            >
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                // mousedown (not click) so the pick runs before the input's blur
                // would dismiss the dropdown.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(candidate);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-2 py-1 text-left font-mono text-xs",
                  index === activeIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground",
                )}
              >
                <span className={cn("truncate", KIND_COLOR[candidate.kind])}>
                  {candidate.name}
                </span>
                {candidate.source !== "" && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {candidate.source}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
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
