import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useWindowFullscreenSync } from "@/lib/window/use-window-fullscreen-sync";
import type { WindowController } from "@/lib/window/window-controller";

function makeController(
  overrides: Partial<WindowController> = {},
): WindowController & {
  setFullscreenSpy: ReturnType<typeof vi.fn>;
  emitChange: (value: boolean) => void;
} {
  let listener: ((value: boolean) => void) | null = null;
  const setFullscreenSpy = vi.fn(() => Promise.resolve());
  return {
    isFullscreen: () => Promise.resolve(false),
    setFullscreen: setFullscreenSpy,
    onFullscreenChange: (cb) => {
      listener = cb;
      return Promise.resolve(() => {
        listener = null;
      });
    },
    setFullscreenSpy,
    emitChange: (value) => listener?.(value),
    ...overrides,
  };
}

function Harness({
  controller,
  saved,
  onSave,
}: {
  controller: WindowController;
  saved: boolean;
  onSave: (value: boolean) => void;
}) {
  useWindowFullscreenSync({ controller, saved, onSave });
  return null;
}

describe("useWindowFullscreenSync", () => {
  // behavior: a saved-true setting restores the window to fullscreen on launch
  it("should set the window fullscreen on mount if the saved setting is true", async () => {
    const controller = makeController();
    render(<Harness controller={controller} saved={true} onSave={vi.fn()} />);

    await waitFor(() => {
      expect(controller.setFullscreenSpy).toHaveBeenCalledWith(true);
    });
  });

  // behavior: a saved-false setting does NOT force the window out of fullscreen on
  // mount - it only restores the "remembered fullscreen" case (YAGNI: don't fight
  // a window the OS/user opened fullscreen)
  it("should not call setFullscreen on mount if the saved setting is false", async () => {
    const controller = makeController();
    render(<Harness controller={controller} saved={false} onSave={vi.fn()} />);

    await Promise.resolve();
    await Promise.resolve();
    expect(controller.setFullscreenSpy).not.toHaveBeenCalled();
  });

  // side-effect-contract: a runtime fullscreen change is persisted via onSave
  it("should persist via onSave when the window fullscreen state changes", async () => {
    const controller = makeController();
    const onSave = vi.fn();
    render(<Harness controller={controller} saved={false} onSave={onSave} />);

    await waitFor(() => {
      // wait until the change subscription is wired
      controller.emitChange(true);
      expect(onSave).toHaveBeenCalledWith(true);
    });
  });

  // behavior: the restore-on-mount runs once, not on every saved-prop change, so a
  // later persist (saved flips to true) does not re-issue setFullscreen
  it("should only restore once on mount even if the saved prop changes later", async () => {
    const controller = makeController();
    const { rerender } = render(
      <Harness controller={controller} saved={true} onSave={vi.fn()} />,
    );

    await waitFor(() => {
      expect(controller.setFullscreenSpy).toHaveBeenCalledTimes(1);
    });

    rerender(<Harness controller={controller} saved={true} onSave={vi.fn()} />);
    await Promise.resolve();
    expect(controller.setFullscreenSpy).toHaveBeenCalledTimes(1);
  });
});
