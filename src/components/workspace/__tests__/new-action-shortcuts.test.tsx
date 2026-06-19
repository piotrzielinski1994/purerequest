import { describe, it, expect } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { fixtureTree } from "./fixtures";

function renderShell(initialActiveRequestId = "req-profile") {
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
      >
        <WorkspaceLayout />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

async function openSecondTab(user: ReturnType<typeof userEvent.setup>) {
  const tree = screen.getByRole("tree", { name: /collection/i });
  await user.click(within(tree).getByRole("treeitem", { name: "POST token" }));
}

describe("close-request bug fix (Mod+W with settings active)", () => {
  // AC-001, TC-001 — behavior
  it("should close the settings tab and keep all request tabs if Mod+W fires while settings is active", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    // Open a second + third request tab so there are three open requests.
    await openSecondTab(user);
    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const tree = screen.getByRole("tree", { name: /collection/i });
    await user.click(within(tree).getByRole("treeitem", { name: "DELETE session" }));

    expect(within(tablist).getAllByRole("tab")).toHaveLength(3);

    // Open settings so it is the active tab.
    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    expect(
      await screen.findByRole("heading", { name: /keyboard shortcuts/i }),
    ).toBeInTheDocument();

    // Mod+W must close settings, not a request tab.
    await user.keyboard("{Control>}w{/Control}");

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /keyboard shortcuts/i }),
      ).not.toBeInTheDocument();
    });
    // All three request tabs survive.
    expect(within(tablist).getAllByRole("tab")).toHaveLength(3);
    expect(
      screen.queryByRole("tab", { name: /settings/i }),
    ).not.toBeInTheDocument();
  });

  // AC-002, TC-002 — behavior
  it("should close the active request if Mod+W fires while a request tab is active", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await openSecondTab(user);
    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(2);

    // token is active after opening; Mod+W closes it.
    await user.keyboard("{Control>}w{/Control}");

    await waitFor(() => {
      expect(
        within(tablist).queryByRole("tab", { name: "token" }),
      ).not.toBeInTheDocument();
    });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(1);
  });
});

describe("toggle-sidebar (Mod+B)", () => {
  // AC-003, TC-003 — behavior
  it("should hide the sidebar tree if Mod+B fires while it is visible and show it again on a second press", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    expect(
      screen.getByRole("tree", { name: /collection/i }),
    ).toBeInTheDocument();

    await user.keyboard("{Control>}b{/Control}");

    await waitFor(() => {
      expect(
        screen.queryByRole("tree", { name: /collection/i }),
      ).not.toBeInTheDocument();
    });

    await user.keyboard("{Control>}b{/Control}");

    expect(
      await screen.findByRole("tree", { name: /collection/i }),
    ).toBeInTheDocument();
  });
});

describe("new-request (Mod+T)", () => {
  // AC-004, TC-004 — behavior
  it("should open an active draft tab showing GET and an empty URL if Mod+T fires", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(1);

    await user.keyboard("{Control>}t{/Control}");

    await waitFor(() => {
      expect(within(tablist).getAllByRole("tab")).toHaveLength(2);
    });
    // The URL bar reflects the active draft: GET method, empty url field.
    const method = await screen.findByLabelText(/method/i);
    expect(method).toHaveTextContent("GET");
    const url = screen.getByRole("textbox", { name: /url/i });
    expect(url.textContent).toBe("");
  });

  // AC-004, TC-004 — behavior
  it("should open a second distinct draft if Mod+T fires twice", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    const tablist = screen.getByRole("tablist", { name: /open requests/i });

    await user.keyboard("{Control>}t{/Control}");
    await waitFor(() => {
      expect(within(tablist).getAllByRole("tab")).toHaveLength(2);
    });

    await user.keyboard("{Control>}t{/Control}");
    await waitFor(() => {
      expect(within(tablist).getAllByRole("tab")).toHaveLength(3);
    });
  });

  // AC-005, TC-005 — behavior
  it("should deactivate settings and show a request view if Mod+T fires while settings is active", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    await screen.findByRole("heading", { name: /keyboard shortcuts/i });

    await user.keyboard("{Control>}t{/Control}");

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /keyboard shortcuts/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("group", { name: /url bar/i })).toBeInTheDocument();
  });
});
