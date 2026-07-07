import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { ToastProvider } from "@/components/ui/toast";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

// requi uses the raw env color for --border (its #rrggbbaa alpha pair IS the
// tint - no color-mix), so the override is the hex EXACTLY. Read it off the shell
// root the design contract pins it to.
function shellEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-slot="resizable-panel-group"]',
  );
}
function shellBorderToken(): string {
  return shellEl()?.style.getPropertyValue("--border").trim() ?? "";
}
// SettingsProvider gates its children on an async store.load(), so the shell
// mounts a tick after render; wait for it before reading the token.
const waitForShell = () => waitFor(() => expect(shellEl()).not.toBeNull());

const RED = "#dc262680";
const GREEN = "#16a34a80";

const request = (id: string, name: string): RequestNode => ({
  kind: "request",
  id,
  name,
  method: "GET",
  url: "https://api/x",
  body: emptyBody(),
  params: emptyParams(),
  config: {},
});

// f-a: colored red for prod, green for local (envs prod+local on the folder)
//   GET req-a
// f-prod: colored red for prod only (env prod)
//   GET req-prod
// f-parent (red for prod) > f-child (uncolored) > GET req-deep   (inherit)
// f-staging: env "staging" only, no colors
//   GET req-staging
const fA: FolderNode = {
  kind: "folder",
  id: "f-a",
  name: "A",
  config: {
    environments: [
      { name: "prod", variables: [] },
      { name: "local", variables: [] },
    ],
  },
  environmentColors: { prod: RED, local: GREEN },
  children: [request("req-a", "in-a")],
};
const fProd: FolderNode = {
  kind: "folder",
  id: "f-prod",
  name: "ProdOnly",
  config: { environments: [{ name: "prod", variables: [] }] },
  environmentColors: { prod: RED },
  children: [request("req-prod", "in-prod")],
};
const fParent: FolderNode = {
  kind: "folder",
  id: "f-parent",
  name: "Parent",
  config: { environments: [{ name: "prod", variables: [] }] },
  environmentColors: { prod: RED },
  children: [
    {
      kind: "folder",
      id: "f-child",
      name: "Child",
      config: {},
      children: [request("req-deep", "deep")],
    },
  ],
};
const fStaging: FolderNode = {
  kind: "folder",
  id: "f-staging",
  name: "Staging",
  config: { environments: [{ name: "staging", variables: [] }] },
  children: [request("req-staging", "in-staging")],
};

const tree: TreeNode[] = [fA, fProd, fParent, fStaging];

// Drives the seams the border follows: the active environment and the active tab.
function BorderProbe() {
  const { setActiveEnvironment, setActiveRequest } = useWorkspace();
  return (
    <div>
      <button type="button" onClick={() => setActiveEnvironment("prod")}>
        env prod
      </button>
      <button type="button" onClick={() => setActiveEnvironment("local")}>
        env local
      </button>
      <button type="button" onClick={() => setActiveEnvironment("staging")}>
        env staging
      </button>
      <button type="button" onClick={() => setActiveRequest("req-a")}>
        tab a
      </button>
      <button type="button" onClick={() => setActiveRequest("req-staging")}>
        tab staging
      </button>
    </div>
  );
}

function renderLayout(opts: {
  activeEnvironment?: string;
  activeRequestId?: string;
  openRequestIds?: string[];
}) {
  return render(
    <SettingsProvider store={createInMemorySettingsStore()}>
      <ToastProvider>
        <WorkspaceProvider
          tree={tree}
          activeEnvironment={opts.activeEnvironment}
          initialExpandedIds={["f-a", "f-prod", "f-parent", "f-child", "f-staging"]}
          initialActiveRequestId={opts.activeRequestId}
          initialOpenRequestIds={opts.openRequestIds}
        >
          <BorderProbe />
          <WorkspaceLayout />
        </WorkspaceProvider>
      </ToastProvider>
    </SettingsProvider>,
  );
}

describe("shell --border by active env + active tab (AC-004, AC-005)", () => {
  // AC-004, TC-005 - behavior: active env prod + active request in a folder colored
  // red for prod overrides --border with that color.
  it("should override --border with the active env's color if the active request is in a colored folder", async () => {
    renderLayout({ activeEnvironment: "prod", activeRequestId: "req-a" });
    await waitForShell();

    expect(shellBorderToken()).toBe(RED);
  });

  // AC-005, E-1 - behavior: no active env -> no override even though the folder has
  // colors (asserted by switching: starts red under prod, clears when env unset).
  it("should not override --border if there is no active environment", async () => {
    const user = userEvent.setup();
    renderLayout({ activeEnvironment: "prod", activeRequestId: "req-a" });
    await waitForShell();
    expect(shellBorderToken()).toBe(RED);

    // staging is not in f-a's chain envs, so picking it resets to No Environment.
    await user.click(screen.getByRole("button", { name: /^env staging$/i }));

    expect(shellBorderToken()).toBe("");
  });
});

describe("shell --border follows the active environment (AC-006, E-8)", () => {
  // AC-006, TC-005 - behavior: switching the active env from prod to local recolors
  // the border to local's color (same folder, distinct per-env color).
  it("should recolor --border to the new env's color if the active environment switches", async () => {
    const user = userEvent.setup();
    renderLayout({ activeEnvironment: "prod", activeRequestId: "req-a" });
    await waitForShell();
    expect(shellBorderToken()).toBe(RED);

    await user.click(screen.getByRole("button", { name: /^env local$/i }));

    expect(shellBorderToken()).toBe(GREEN);
  });

  // AC-007, E-8, TC-007 - behavior: a folder colored only for prod shows no border
  // when local is the active env (env-keyed). Started under prod (red) then switched
  // to local so "" reflects a real clear, not a never-set default.
  it("should clear --border if the active env has no color in the active folder", async () => {
    const user = userEvent.setup();
    renderLayout({ activeEnvironment: "prod", activeRequestId: "req-prod" });
    await waitForShell();
    expect(shellBorderToken()).toBe(RED);

    // f-prod's chain has only prod, so switching to local resets to No Environment.
    await user.click(screen.getByRole("button", { name: /^env local$/i }));

    expect(shellBorderToken()).toBe("");
  });
});

describe("shell --border inheritance for nested requests (AC-007)", () => {
  // AC-007, TC-006 - behavior: a request in an uncolored child of a parent colored
  // red for prod inherits the parent's prod color when prod is active.
  it("should override --border with the nearest colored ancestor's env color for a nested request", async () => {
    renderLayout({ activeEnvironment: "prod", activeRequestId: "req-deep" });
    await waitForShell();

    expect(shellBorderToken()).toBe(RED);
  });
});

describe("shell --border clears on tab change out of env scope (AC-010)", () => {
  // AC-010, TC-010 - behavior: with prod active and a request in f-a (has prod) the
  // border is red; switching the active tab to a request whose chain lacks prod
  // resets the active env and clears the border.
  it("should clear --border if the active tab switches to a node whose chain lacks the active env", async () => {
    const user = userEvent.setup();
    renderLayout({
      activeEnvironment: "prod",
      activeRequestId: "req-a",
      openRequestIds: ["req-a", "req-staging"],
    });
    await waitForShell();
    expect(shellBorderToken()).toBe(RED);

    await user.click(screen.getByRole("button", { name: /^tab staging$/i }));

    expect(shellBorderToken()).toBe("");
  });
});
