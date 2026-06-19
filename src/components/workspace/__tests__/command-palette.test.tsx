import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatForDisplay } from "@tanstack/hotkeys";

import { CommandPalette } from "@/components/workspace/command-palette";
import {
  SHORTCUT_ACTIONS,
  type ShortcutAction,
} from "@/lib/shortcuts/registry";

const TOGGLE_CONSOLE = SHORTCUT_ACTIONS.find((a) => a.id === "toggle-console")!;
const TOGGLE_SIDEBAR = SHORTCUT_ACTIONS.find((a) => a.id === "toggle-sidebar")!;
const NEW_REQUEST = SHORTCUT_ACTIONS.find((a) => a.id === "new-request")!;

type Command = {
  action: ShortcutAction;
  binding: string;
  run: () => void;
};

function makeCommand(action: ShortcutAction, run = vi.fn()): Command {
  return { action, binding: action.defaultHotkey, run };
}

describe("CommandPalette", () => {
  // AC-003 — behavior
  it("should render a row per supplied command showing its name and formatted shortcut", async () => {
    const commands = [
      makeCommand(TOGGLE_CONSOLE),
      makeCommand(TOGGLE_SIDEBAR),
      makeCommand(NEW_REQUEST),
    ];

    render(
      <CommandPalette open onOpenChange={vi.fn()} commands={commands} />,
    );

    for (const command of commands) {
      expect(
        await screen.findByText(command.action.name),
      ).toBeInTheDocument();
      expect(
        screen.getByText(formatForDisplay(command.binding)),
      ).toBeInTheDocument();
    }
  });

  // AC-004 — behavior
  it("should filter rows to matches when text is typed into the input", async () => {
    const user = userEvent.setup();
    const commands = [
      makeCommand(TOGGLE_CONSOLE),
      makeCommand(TOGGLE_SIDEBAR),
      makeCommand(NEW_REQUEST),
    ];

    render(
      <CommandPalette open onOpenChange={vi.fn()} commands={commands} />,
    );
    await screen.findByText(TOGGLE_CONSOLE.name);

    await user.type(screen.getByRole("combobox"), "console");

    await waitFor(() => {
      expect(
        screen.queryByText(TOGGLE_SIDEBAR.name),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText(TOGGLE_CONSOLE.name)).toBeInTheDocument();
    expect(screen.queryByText(NEW_REQUEST.name)).not.toBeInTheDocument();
  });

  // AC-004 — behavior
  it("should show the empty-state message if the query matches nothing", async () => {
    const user = userEvent.setup();
    const commands = [makeCommand(TOGGLE_CONSOLE), makeCommand(TOGGLE_SIDEBAR)];

    render(
      <CommandPalette open onOpenChange={vi.fn()} commands={commands} />,
    );
    await screen.findByText(TOGGLE_CONSOLE.name);

    await user.type(screen.getByRole("combobox"), "zzzzz");

    expect(await screen.findByText(/no matching commands/i)).toBeInTheDocument();
    expect(screen.queryByText(TOGGLE_CONSOLE.name)).not.toBeInTheDocument();
  });

  // AC-005, AC-006 — side-effect-contract
  it("should run the highlighted command then close if Enter is pressed", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const consoleRun = vi.fn();
    const commands = [
      makeCommand(TOGGLE_CONSOLE, consoleRun),
      makeCommand(TOGGLE_SIDEBAR),
    ];

    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        commands={commands}
      />,
    );
    await screen.findByText(TOGGLE_CONSOLE.name);

    // Narrow to one command so it is the highlighted row, then run it.
    await user.type(screen.getByRole("combobox"), "console");
    await screen.findByText(TOGGLE_CONSOLE.name);
    await user.keyboard("{Enter}");

    expect(consoleRun).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // AC-005, AC-006 — side-effect-contract
  it("should run the second filtered command if ArrowDown then Enter is pressed", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const firstRun = vi.fn();
    const secondRun = vi.fn();
    // Both names contain "toggle" so the filter keeps two rows to arrow across.
    const commands = [
      makeCommand(TOGGLE_CONSOLE, firstRun),
      makeCommand(TOGGLE_SIDEBAR, secondRun),
    ];

    render(
      <CommandPalette open onOpenChange={onOpenChange} commands={commands} />,
    );
    await screen.findByText(TOGGLE_CONSOLE.name);

    await user.type(screen.getByRole("combobox"), "toggle");
    await screen.findByText(TOGGLE_SIDEBAR.name);
    await user.keyboard("{ArrowDown}{Enter}");

    expect(secondRun).toHaveBeenCalledTimes(1);
    expect(firstRun).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // AC-007 — side-effect-contract
  it("should run the command and close if a row is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const sidebarRun = vi.fn();
    const commands = [
      makeCommand(TOGGLE_CONSOLE),
      makeCommand(TOGGLE_SIDEBAR, sidebarRun),
    ];

    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        commands={commands}
      />,
    );

    await user.click(await screen.findByText(TOGGLE_SIDEBAR.name));

    expect(sidebarRun).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
