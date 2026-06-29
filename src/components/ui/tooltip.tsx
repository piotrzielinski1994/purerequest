import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const HOVER_DELAY_MS = 500;

// A hover-only tooltip. Radix opens instantly on FOCUS (an a11y default) which
// ignores delayDuration - and our triggers (Select trigger/items) are focusable,
// so it flashed open with no delay. So we control `open` ourselves: a pointer-enter
// timer opens after HOVER_DELAY_MS, pointer-leave/blur closes, and Radix's own
// open requests are ignored (focus never opens it).
function Tooltip({
  content,
  side = "top",
  children,
}: {
  content: React.ReactNode;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
  children: React.ReactElement;
}) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<number | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  React.useEffect(() => clear, []);

  const onPointerEnter = () => {
    clear();
    timer.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  };
  const close = () => {
    clear();
    setOpen(false);
  };

  return (
    <TooltipPrimitive.Provider>
      <TooltipPrimitive.Root
        open={open}
        // Honour only close requests (Escape, pointer-down); opening is driven
        // solely by our hover timer, so focus can't flash it open.
        onOpenChange={(next) => {
          if (!next) {
            close();
          }
        }}
      >
        <TooltipPrimitive.Trigger
          asChild
          onPointerEnter={onPointerEnter}
          onPointerLeave={close}
          onBlur={close}
        >
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            data-slot="tooltip-content"
            side={side}
            sideOffset={4}
            className={cn(
              "z-50 w-fit border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export { Tooltip };
