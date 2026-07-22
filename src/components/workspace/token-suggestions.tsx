import { cn } from "@pziel/pureui";
import { useEffect, useRef } from "react";
import type { TokenCandidate } from "@/components/workspace/token-complete";
import { TOKEN_KIND_COLOR } from "@/components/workspace/token-suggestion-style";

// The React listbox rendered under a token-aware text input (`HighlightedInput`).
// One kind-colored row per candidate: the name (left, kind color, truncated) and
// its source (right, muted, hidden when blank) - no icons, matching the CodeMirror
// `{{token}}` popup styled by `makeChrome` from the SAME kind-color contract
// (`token-suggestion-style.ts`), so both surfaces look identical.
export function TokenSuggestionList({
  id,
  candidates,
  activeIndex,
  onPick,
  onActivate,
}: {
  id: string;
  candidates: TokenCandidate[];
  activeIndex: number;
  onPick: (candidate: TokenCandidate) => void;
  onActivate: (index: number) => void;
}) {
  // Keep the highlighted option scrolled into view as the active index moves past
  // the visible window.
  const activeOptionRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Token suggestions"
      className="absolute top-full left-0 z-50 mt-px max-h-56 w-72 overflow-y-auto border border-border bg-popover py-1 shadow-md"
    >
      {candidates.map((candidate, index) => (
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
              onPick(candidate);
            }}
            onMouseEnter={() => onActivate(index)}
            className={cn(
              "flex w-full items-center justify-between gap-2 px-2 py-1 text-left font-mono text-xs",
              index === activeIndex
                ? "bg-accent text-accent-foreground"
                : "text-foreground",
            )}
          >
            <span className={cn("truncate", TOKEN_KIND_COLOR[candidate.kind])}>
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
  );
}
