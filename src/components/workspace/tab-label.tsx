import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

const MAX_SCROLL_SPEED_PX_PER_S = 90;

export function TabLabel({ children }: { children: React.ReactNode }) {
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
      className="block max-w-40 overflow-hidden"
    >
      <span
        ref={textRef}
        style={style}
        className="inline-block whitespace-nowrap transition-transform ease-linear group-hover:transform-[translateX(var(--tab-shift))]"
      >
        {children}
      </span>
    </span>
  );
}
