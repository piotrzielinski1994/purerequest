import { describe, expect, it } from "vitest";

import { installContextMenuSuppressor } from "@/app/suppress-native-context-menu";

describe("installContextMenuSuppressor", () => {
  // behavior: a right-click anywhere has its default (the native menu) prevented.
  it("should prevent the default on a contextmenu event", () => {
    const cleanup = installContextMenuSuppressor(document);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });

    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    cleanup();
  });

  // behavior: after cleanup the listener no longer suppresses the native menu.
  it("should stop suppressing once cleaned up", () => {
    const cleanup = installContextMenuSuppressor(document);
    cleanup();
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });

    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  // behavior: it does NOT stop propagation, so a component's own contextmenu
  // handler (e.g. a Radix trigger) still runs.
  it("should not stop propagation to other contextmenu listeners", () => {
    const cleanup = installContextMenuSuppressor(document);
    let sawEvent = false;
    const spy = () => {
      sawEvent = true;
    };
    document.body.addEventListener("contextmenu", spy);

    document.body.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );

    expect(sawEvent).toBe(true);
    document.body.removeEventListener("contextmenu", spy);
    cleanup();
  });
});
