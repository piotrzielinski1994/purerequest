import { describe, expect, it, vi } from "vitest";
import type { TauriWindow } from "@/lib/window/window-controller";
import {
  createNoopWindowController,
  createWindowController,
} from "@/lib/window/window-controller";

describe("createNoopWindowController", () => {
  // behavior: the browser/test controller reports not-fullscreen and ignores sets
  it("should report false for isFullscreen", async () => {
    const controller = createNoopWindowController();

    expect(await controller.isFullscreen()).toBe(false);
  });

  // behavior: setFullscreen is a no-op that resolves
  it("should resolve setFullscreen without throwing", async () => {
    const controller = createNoopWindowController();

    await expect(controller.setFullscreen(true)).resolves.toBeUndefined();
  });

  // behavior: onFullscreenChange never fires and returns a no-op unsubscribe
  it("should return an unsubscribe function from onFullscreenChange", async () => {
    const controller = createNoopWindowController();
    const listener = vi.fn();

    const unsubscribe = await controller.onFullscreenChange(listener);
    unsubscribe();

    expect(listener).not.toHaveBeenCalled();
  });
});

function fakeTauriWindow(initial: boolean): {
  win: TauriWindow;
  emitResize: () => void;
  state: { fullscreen: boolean };
} {
  const state = { fullscreen: initial };
  const resizeListeners: Array<() => void> = [];
  const win: TauriWindow = {
    isFullscreen: () => Promise.resolve(state.fullscreen),
    setFullscreen: (value: boolean) => {
      state.fullscreen = value;
      return Promise.resolve();
    },
    onResized: (handler: () => void) => {
      resizeListeners.push(handler);
      return Promise.resolve(() => {
        const index = resizeListeners.indexOf(handler);
        if (index !== -1) {
          resizeListeners.splice(index, 1);
        }
      });
    },
  };
  return {
    win,
    state,
    emitResize: () =>
      resizeListeners.forEach((handler) => {
        handler();
      }),
  };
}

describe("createWindowController over a Tauri window", () => {
  // behavior: reads the live fullscreen state from the window
  it("should report the window's current fullscreen state", async () => {
    const { win } = fakeTauriWindow(true);
    const controller = createWindowController(() => win);

    expect(await controller.isFullscreen()).toBe(true);
  });

  // behavior: applies a fullscreen change to the window
  it("should set the window fullscreen state", async () => {
    const { win, state } = fakeTauriWindow(false);
    const controller = createWindowController(() => win);

    await controller.setFullscreen(true);

    expect(state.fullscreen).toBe(true);
  });

  // side-effect-contract: a resize that flips fullscreen notifies the listener
  // with the new value (the window emits resize, not a dedicated fullscreen event)
  it("should notify the listener with the new fullscreen value on a resize", async () => {
    const fake = fakeTauriWindow(false);
    const controller = createWindowController(() => fake.win);
    const listener = vi.fn();

    await controller.onFullscreenChange(listener);
    fake.state.fullscreen = true;
    fake.emitResize();
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith(true);
  });

  // behavior: only changes are reported - a resize that does NOT flip fullscreen
  // (e.g. a plain window drag-resize) must not spam the listener
  it("should not notify the listener if a resize does not change fullscreen", async () => {
    const fake = fakeTauriWindow(false);
    const controller = createWindowController(() => fake.win);
    const listener = vi.fn();

    await controller.onFullscreenChange(listener);
    fake.emitResize();
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
  });

  // behavior: the returned unsubscribe detaches the underlying resize listener
  it("should stop notifying after the unsubscribe is called", async () => {
    const fake = fakeTauriWindow(false);
    const controller = createWindowController(() => fake.win);
    const listener = vi.fn();

    const unsubscribe = await controller.onFullscreenChange(listener);
    unsubscribe();
    fake.state.fullscreen = true;
    fake.emitResize();
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
  });
});
