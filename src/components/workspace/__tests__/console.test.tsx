import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Console } from "@/components/workspace/console";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { fixtureTree } from "./fixtures";

function stubMatchMedia(matches = false) {
  window.matchMedia = ((query: string) => {
    void query;
    return {
      matches,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    };
  }) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  // @ts-expect-error - drop the stub between tests.
  delete window.matchMedia;
});

describe("Console", () => {
  // AC-012 — behavior
  it("should render each console log line", () => {
    const consoleLines = [
      "[12:00:00] Ready.",
      "[12:00:01] Loaded mock collection.",
      "[12:00:02] No active request.",
    ];

    render(
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={consoleLines}
        initialExpandedIds={[]}
      >
        <Console />
      </WorkspaceProvider>,
    );

    // Lines render as token-colored spans (numbers/strings get their own span),
    // so a line is split across nodes - assert via the list items' textContent.
    const region = screen.getByRole("region", { name: /console/i });
    const rendered = within(region)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    consoleLines.forEach((line) => {
      expect(rendered).toContain(line);
    });
  });

  // AC-011 — behavior: a tokenized console value (e.g. a bare number) is colored
  // with the ACTIVE editor scheme's number color, not a hardcoded hex - so it
  // follows the theme / honors a custom editor color.
  it("should color a tokenized number with the active editor number color", async () => {
    stubMatchMedia(false);
    const NUMBER = "oklch(0.321 0.123 99)";
    const store = createInMemorySettingsStore({
      ...DEFAULT_SETTINGS,
      theme: {
        mode: "light",
        colors: {
          light: { tokens: {}, editor: { number: NUMBER } },
          dark: { tokens: {}, editor: {} },
        },
      },
    });

    render(
      <SettingsProvider store={store}>
        <ThemeProvider>
          <WorkspaceProvider
            tree={fixtureTree}
            consoleLines={["count 42"]}
            initialExpandedIds={[]}
          >
            <Console />
          </WorkspaceProvider>
        </ThemeProvider>
      </SettingsProvider>,
    );

    const numberSpan = await screen.findByText("42");
    expect(numberSpan).toHaveStyle({ color: NUMBER });
  });

  // behavior: the console header has a right-pinned Clear icon button that wipes
  // every console line when clicked.
  it("should clear all console lines when the Clear button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={["[12:00:00] Ready.", "[12:00:01] Loaded."]}
        initialExpandedIds={[]}
      >
        <Console />
      </WorkspaceProvider>,
    );

    const region = screen.getByRole("region", { name: /console/i });
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);

    const clear = within(region).getByRole("button", {
      name: /clear console/i,
    });
    expect(clear.querySelector("svg")).not.toBeNull();
    await user.click(clear);

    expect(within(region).queryAllByRole("listitem")).toHaveLength(0);
  });

  // behavior: with no console lines, the Clear button is still shown but disabled.
  it("should render the Clear button disabled when the console is empty", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={[]}
        initialExpandedIds={[]}
      >
        <Console />
      </WorkspaceProvider>,
    );

    const region = screen.getByRole("region", { name: /console/i });
    expect(
      within(region).getByRole("button", { name: /clear console/i }),
    ).toBeDisabled();
  });
});
