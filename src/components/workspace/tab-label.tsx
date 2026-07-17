import { useRef, useState } from "react";

const MAX_SCROLL_SPEED_PX_PER_S = 90;

export function TabLabel({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [offset, setOffset] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  const startScroll = () => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) {
      return;
    }
    const overflow = text.scrollWidth - container.clientWidth;
    if (overflow <= 0) {
      return;
    }
    setOffset(overflow);
    setDurationMs((overflow / MAX_SCROLL_SPEED_PX_PER_S) * 1000);
  };

  const endScroll = () => {
    setOffset(0);
  };

  return (
    <span
      ref={containerRef}
      data-slot="tab-label"
      onPointerEnter={startScroll}
      onPointerLeave={endScroll}
      className="block max-w-40 overflow-hidden"
    >
      <span
        ref={textRef}
        style={{
          transform: `translateX(-${offset}px)`,
          transitionDuration: `${durationMs}ms`,
        }}
        className="inline-block whitespace-nowrap transition-transform ease-linear"
      >
        {children}
      </span>
    </span>
  );
}
