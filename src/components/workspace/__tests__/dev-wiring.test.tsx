import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createFakeHttpClient } from "@/components/workspace/__tests__/fake-http-client";
import { WorkspaceLoader } from "@/components/workspace/workspace-loader";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import {
  DEMO_RESPONSE,
  DEMO_WORKSPACE_PATH,
  demoFiles,
} from "@/lib/workspace/demo-seed";
import { createInMemoryWorkspaceFs } from "@/lib/workspace/in-memory-fs";

function renderDevLoader() {
  const fs = createInMemoryWorkspaceFs({
    [DEMO_WORKSPACE_PATH]: demoFiles(),
  });
  const settingsStore = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    workspacePath: DEMO_WORKSPACE_PATH,
  });
  const httpClient = createFakeHttpClient({
    ok: true,
    response: DEMO_RESPONSE,
  });

  return render(
    <SettingsProvider store={settingsStore}>
      <WorkspaceLoader fs={fs} httpClient={httpClient} />
    </SettingsProvider>,
  );
}

describe("dev-browser adapter wiring", () => {
  // AC-005, TC-004 - behavior: the dev adapters (in-memory fs seeded with the demo
  // files + a settings store whose workspacePath is the demo path) make the loader
  // render the demo tree instead of the empty state.
  it("should render the demo tree if the loader is fed the dev adapters", async () => {
    renderDevLoader();

    expect(await screen.findByText("billing")).toBeInTheDocument();
  });

  // AC-005, TC-004 - behavior: with a seeded workspace, the empty state must not show.
  it("should not render the empty state if the demo workspace is seeded", async () => {
    renderDevLoader();

    await screen.findByText("billing");
    expect(screen.queryByText(/no workspace/i)).not.toBeInTheDocument();
  });
});
