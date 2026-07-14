import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { openContextMenuOnKey } from "@/components/workspace/tree-nav";

// A focusable element whose onKeyDown delegates to openContextMenuOnKey with a
// supplied binding list; the observable effect is the synthetic `contextmenu`
// MouseEvent the helper dispatches, caught by the onContextMenu spy.

describe("openContextMenuOnKey", () => {
  // AC-002 — behavior: any binding in the list opens the menu.
  it("should open the context menu if a bound combo is pressed", async () => {
    const user = userEvent.setup();
    const onContextMenu = vi.fn();
    render(
      <button
        type="button"
        data-testid="target"
        onContextMenu={onContextMenu}
        onKeyDown={(event) => openContextMenuOnKey(event, ["Shift+F10"])}
      >
        row
      </button>,
    );

    await user.click(screen.getByTestId("target"));
    await user.keyboard("{Shift>}{F10}{/Shift}");

    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  // AC-002 — behavior: a non-first binding in the list also opens the menu.
  it("should open the menu if any (not just the first) binding matches", async () => {
    const user = userEvent.setup();
    const onContextMenu = vi.fn();
    render(
      <button
        type="button"
        data-testid="target"
        onContextMenu={onContextMenu}
        onKeyDown={(event) =>
          openContextMenuOnKey(event, ["Shift+F10", "Control+M"])
        }
      >
        row
      </button>,
    );

    await user.click(screen.getByTestId("target"));
    await user.keyboard("{Control>}m{/Control}");

    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  // E-2 — behavior: a disabled ([]) open-context-menu action opens nothing on a
  // former default key, but the always-on ContextMenu hardware key still works.
  it("should not open the menu for the former key if the binding list is empty", async () => {
    const user = userEvent.setup();
    const onContextMenu = vi.fn();
    render(
      <button
        type="button"
        data-testid="target"
        onContextMenu={onContextMenu}
        onKeyDown={(event) => openContextMenuOnKey(event, [])}
      >
        row
      </button>,
    );

    await user.click(screen.getByTestId("target"));
    await user.keyboard("{Shift>}{F10}{/Shift}");

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  // E-2 — behavior: the dedicated ContextMenu key always opens, even when the
  // configurable binding is disabled.
  it("should open the menu on the ContextMenu key even with an empty binding list", async () => {
    const user = userEvent.setup();
    const onContextMenu = vi.fn();
    render(
      <button
        type="button"
        data-testid="target"
        onContextMenu={onContextMenu}
        onKeyDown={(event) => openContextMenuOnKey(event, [])}
      >
        row
      </button>,
    );

    await user.click(screen.getByTestId("target"));
    await user.keyboard("{ContextMenu}");

    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });
});
