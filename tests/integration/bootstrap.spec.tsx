import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppProviders } from "@/app/providers";
import { rootRoute } from "@/routes/__root";
import { indexRoute } from "@/routes/index";

function renderApp(initialPath = "/") {
  const routeTree = rootRoute.addChildren([indexRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  const result = render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...result, router };
}

describe("app routing", () => {
  // behavior: with no workspacePath configured (no Tauri host under jsdom),
  // the home route shows the empty state instead of auto-loading a tree.
  it("should render the workspace empty state at the home route on launch", async () => {
    renderApp("/");

    expect(await screen.findByText(/no workspace/i)).toBeInTheDocument();
  });

  // behavior: the bootstrap demo shell is gone
  it("should not render the bootstrap demo nav at the home route", async () => {
    renderApp("/");

    await screen.findByText(/no workspace/i);
    expect(
      screen.queryByRole("link", { name: /^home$/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // AC-005 — behavior: /settings is no longer a route, so it 404s like any unknown path.
  it("should render a not-found view for the removed settings route", async () => {
    renderApp("/settings");

    expect(await screen.findByText(/404/i)).toBeInTheDocument();
    expect(screen.getByText(/does not exist/i)).toBeInTheDocument();
  });

  it("should render a not-found view for an unknown route", async () => {
    renderApp("/this-route-does-not-exist");

    expect(await screen.findByText(/404/i)).toBeInTheDocument();
    expect(screen.getByText(/does not exist/i)).toBeInTheDocument();
  });

  // AC-002, AC-003, TC-002, TC-003 — behavior: jsdom resolves Mod -> Control (learnings).
  it("should open settings as content in the shell and close it back to the workspace", async () => {
    const user = userEvent.setup();
    const { router } = renderApp("/");
    await screen.findByText(/no workspace/i);

    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    expect(
      await screen.findByRole("tablist", { name: /settings sections/i }),
    ).toBeInTheDocument();
    // Still the same shell: the workspace path did not change to a settings route.
    expect(
      screen.getByRole("region", { name: /console/i }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");

    await user.keyboard("{Escape}");
    expect(await screen.findByText(/no workspace/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("tablist", { name: /settings sections/i }),
    ).not.toBeInTheDocument();
  });
});
