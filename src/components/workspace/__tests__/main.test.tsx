import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Main } from "@/components/workspace/main";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { fixtureTree } from "./fixtures";

function renderMain(consoleHidden: boolean) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    consoleHidden,
  });
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={["[12:00:00] Ready."]}
        initialActiveRequestId="req-token"
      >
        <Main />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

function renderMainWithoutRequest() {
  const store = createInMemorySettingsStore(DEFAULT_SETTINGS);
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={["[12:00:00] Ready."]}
      >
        <Main />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

describe("Main console visibility", () => {
  // AC-003 — behavior
  it("should render the console body if consoleHidden is false", async () => {
    renderMain(false);

    expect(
      await screen.findByRole("region", { name: /console/i }),
    ).toBeInTheDocument();
  });

  // AC-003 — behavior
  it("should not render the console body if consoleHidden is true", async () => {
    renderMain(true);

    await screen.findByRole("tablist", { name: /request sections/i });
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: /console/i }),
      ).not.toBeInTheDocument();
    });
  });
});

describe("Main workspace shortcuts with no open request", () => {
  // AC-009, TC-007 — behavior: jsdom resolves Mod -> Control (learnings).
  it("should not throw if close/next-request fire when no request is open", async () => {
    const user = userEvent.setup();
    renderMainWithoutRequest();

    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}w{/Control}");
    await user.keyboard("{Control>}{Tab}{/Control}");
    await user.keyboard("{Control>}{Shift>}{Tab}{/Shift}{/Control}");

    expect(
      screen.getByRole("region", { name: /console/i }),
    ).toBeInTheDocument();
  });
});
