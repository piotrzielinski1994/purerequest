import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Main } from "@/components/workspace/main";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createFakeHttpClient, type FakeHttpClient } from "./fake-http-client";
import { fixtureTree } from "./fixtures";

function renderMain(client: FakeHttpClient, initialActiveRequestId?: string) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={["[12:00:00] Ready."]}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId={initialActiveRequestId}
        httpClient={client}
      >
        <Main />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

describe("send-request shortcut (Mod+Enter)", () => {
  // AC-008, TC-005 — behavior: jsdom resolves Mod -> Control (learnings).
  it("should send the active request if Mod+Enter fires", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    renderMain(client, "req-token");
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => {
      expect(client.callCount).toBe(1);
    });
  });

  // AC-008, TC-005 — behavior: no-op when no request is active.
  it("should not call the client if Mod+Enter fires with no active request", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    renderMain(client);
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}{Enter}{/Control}");

    // Give the (no-op) handler a tick; the client stays untouched.
    await waitFor(() => {
      expect(client.callCount).toBe(0);
    });
  });
});
