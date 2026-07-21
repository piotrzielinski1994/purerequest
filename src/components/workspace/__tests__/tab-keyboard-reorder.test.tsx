import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ContentHeader } from "@/components/workspace/content-header";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { fixtureTree } from "./fixtures";

async function renderHeader(openIds: string[], activeId = openIds[0]) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  const result = render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenRequestIds={openIds}
        initialActiveRequestId={activeId}
      >
        <ContentHeader />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
  // SettingsProvider renders null until its async store.load resolves.
  await screen.findByRole("tablist", { name: /open requests/i });
  return result;
}

// The tab's accessible name is just the request name (the method chip is
// aria-hidden). Comparing accessible names gives a method-free order.
const tabNames = () =>
  within(screen.getByRole("tablist", { name: /open requests/i }))
    .getAllByRole("tab")
    .map((tab) =>
      (tab.getAttribute("aria-label") ?? tab.textContent ?? "")
        .replace(/^(GET|POST|PUT|PATCH|DELETE)/, "")
        .trim(),
    );

describe("tab keyboard reorder (AC-009)", () => {
  it("should give each request tab a keyboard-draggable handle in the Tab order", async () => {
    await renderHeader(["req-profile", "req-token"]);

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    // Every sortable tab wrapper carries the dnd-kit draggable attributes: a
    // tabindex (focusable) + aria-roledescription so a keyboard user can grab it.
    const handles = within(tablist)
      .getAllByRole("tab")
      .map((tab) => tab.closest("[aria-roledescription]"));

    expect(handles.every((h) => h !== null)).toBe(true);
    handles.forEach((h) => {
      expect(h).toHaveAttribute("tabindex", expect.stringMatching(/^-?\d+$/));
    });
  });

  it("should pick up a tab if Space is pressed on a focused tab (KeyboardSensor wired)", async () => {
    const user = userEvent.setup();
    await renderHeader(["req-profile", "req-token"]);

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const handle = within(tablist)
      .getByRole("tab", { name: "profile" })
      .closest("[aria-roledescription]") as HTMLElement;
    handle.focus();
    await user.keyboard(" ");

    // dnd-kit's KeyboardSensor marks the grabbed sortable aria-pressed=true on
    // pickup. A PointerSensor ignores Space entirely, so this only turns true
    // when a KeyboardSensor is registered and processed the keydown.
    expect(handle).toHaveAttribute("aria-pressed", "true");
  });

  // The full pick-up -> Arrow -> drop reorder needs real element rects for
  // dnd-kit's sortableKeyboardCoordinates collision math; jsdom reports all-zero
  // rects, so the Arrow step can't find a neighbour to move over. The keyboard
  // reorder is exercised end-to-end in the Playwright spec (real browser rects);
  // here we assert the two observable halves jsdom CAN see: the tab is a
  // keyboard-grabbable sortable, and Space toggles its grabbed state off again.
  it("should release a grabbed tab if Space is pressed twice (keyboard drag lifecycle)", async () => {
    const user = userEvent.setup();
    await renderHeader(["req-profile", "req-token"]);

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const handle = within(tablist)
      .getByRole("tab", { name: "profile" })
      .closest("[aria-roledescription]") as HTMLElement;
    handle.focus();

    await user.keyboard(" "); // pick up
    expect(handle).toHaveAttribute("aria-pressed", "true");

    await user.keyboard(" "); // drop in place
    // dnd-kit clears aria-pressed on drop (back to the not-grabbed default).
    expect(handle.getAttribute("aria-pressed")).not.toBe("true");
    // Dropping in place leaves the order untouched.
    expect(tabNames()).toEqual(["profile", "token"]);
  });
});

describe("tab context-menu key (AC-010)", () => {
  it("should open the tab context menu if Shift+F10 is pressed on a focused tab", async () => {
    const user = userEvent.setup();
    await renderHeader(["req-profile", "req-token"]);

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const handle = within(tablist)
      .getByRole("tab", { name: "profile" })
      .closest("[aria-roledescription]") as HTMLElement;
    handle.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");

    expect(
      await screen.findByRole("menuitem", { name: /^close$/i }),
    ).toBeInTheDocument();
  });
});
