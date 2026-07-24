import { cn } from "@pziel/pureui";
import type { CSSProperties } from "react";
import { useLayoutEffect, useRef, useState } from "react";

const MAX_SCROLL_SPEED_PX_PER_S = 90;

// A single-line label that clips overflow and slides its text on hover (or when
// its ancestor is cmdk-selected) instead of wrapping or growing. `className`
// overrides the container width so callers other than tabs (e.g. the quick-open
// row, which fills flexible space) can widen it past the default tab cap.
export function TabLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) {
      return;
    }
    const next = Math.max(0, text.scrollWidth - container.clientWidth);
    setOverflow((prev) => (prev === next ? prev : next));
  }, [children]);

  const style = {
    "--tab-shift": `-${overflow}px`,
    transitionDuration: `${(overflow / MAX_SCROLL_SPEED_PX_PER_S) * 1000}ms`,
  } as CSSProperties;

  return (
    <span
      ref={containerRef}
      data-slot="tab-label"
      className={cn("block max-w-40 overflow-hidden", className)}
    >
      <span
        ref={textRef}
        style={style}
        className="inline-block whitespace-nowrap transition-transform ease-linear group-hover:transform-[translateX(var(--tab-shift))] group-data-[selected=true]:transform-[translateX(var(--tab-shift))]"
      >
        {children}
      </span>
    </span>
  );
}
