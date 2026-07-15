import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { UrlBar } from "@/components/workspace/url-bar";
import { FolderPane } from "@/components/workspace/folder-pane";
import { ToastProvider } from "@/components/ui/toast";
import type { TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

function renderWith(tree: TreeNode[], activeEnvironment?: string) {
  return render(
    <ToastProvider>
      <WorkspaceProvider
        tree={tree}
        initialActiveRequestId="req"
        initialExpandedIds={["root"]}
        activeEnvironment={activeEnvironment}
      >
        <UrlBar />
        <FolderPane />
      </WorkspaceProvider>
    </ToastProvider>,
  );
}

// Hovering a {{token}} opens a popup; a "Go to source" button next to Copy
// jumps to the folder scope that ACTUALLY provides the value (highest priority
// in the chain) and opens the exact view where it's editable.
describe("token popup: go to source", () => {
  it("should reveal the folder Vars tab for a plain variable", async () => {
    const user = userEvent.setup();
    const tree: TreeNode[] = [
      {
        kind: "folder",
        id: "root",
        name: "Root",
        config: { variables: [{ key: "authToken", value: "tok-1" }] },
        children: [
          {
            kind: "request",
            id: "req",
            name: "Req",
            method: "GET",
            url: "{{authToken}}/x",
            body: emptyBody(),
            params: emptyParams(),
            config: {},
          },
        ],
      },
    ];
    renderWith(tree);

    await user.hover(screen.getByText("{{authToken}}"));
    await user.click(await screen.findByRole("button", { name: /go to source/i }));

    // The folder pane is now open on Vars, showing the variable key cell.
    expect(await screen.findByDisplayValue("authToken")).toBeInTheDocument();
  });

  it("should reveal the folder Env > Envs view with the active env picked for an env var", async () => {
    const user = userEvent.setup();
    const tree: TreeNode[] = [
      {
        kind: "folder",
        id: "root",
        name: "Root",
        config: {
          environments: [
            { name: "prod", variables: [{ key: "baseUrl", value: "https://prod" }] },
          ],
        },
        children: [
          {
            kind: "request",
            id: "req",
            name: "Req",
            method: "GET",
            url: "{{baseUrl}}/x",
            body: emptyBody(),
            params: emptyParams(),
            config: {},
          },
        ],
      },
    ];
    renderWith(tree, "prod");

    await user.hover(screen.getByText("{{baseUrl}}"));
    await user.click(await screen.findByRole("button", { name: /go to source/i }));

    // The env var key is shown in the Envs table for the picked environment.
    expect(await screen.findByDisplayValue("baseUrl")).toBeInTheDocument();
  });

  it("should reveal the folder Env > .env view for a process.env token", async () => {
    const user = userEvent.setup();
    const tree: TreeNode[] = [
      {
        kind: "folder",
        id: "root",
        name: "Root",
        config: {},
        dotenv: "HOST=myhost",
        children: [
          {
            kind: "request",
            id: "req",
            name: "Req",
            method: "GET",
            url: "{{process.env.HOST}}/x",
            body: emptyBody(),
            params: emptyParams(),
            config: {},
          },
        ],
      },
    ];
    renderWith(tree);

    await user.hover(screen.getByText("{{process.env.HOST}}"));
    await user.click(await screen.findByRole("button", { name: /go to source/i }));

    // The .env table shows the dotenv key for the owning folder.
    expect(await screen.findByDisplayValue("HOST")).toBeInTheDocument();
  });

  // The pencil follows `target` (nearest defining row), NOT the drilled
  // `writeTarget`: for a var that is a `{{process.env.X}}` pointer it reveals the
  // folder Vars grid showing the pointer row, not the `.env` view the inline edit
  // would write to.
  it("should reveal the folder Vars pointer row for a process.env-pointer variable", async () => {
    const user = userEvent.setup();
    const tree: TreeNode[] = [
      {
        kind: "folder",
        id: "root",
        name: "Root",
        config: {
          variables: [
            { key: "CUSTOMER_ID", value: "{{process.env.CUSTOMER_ID}}" },
          ],
        },
        dotenv: "CUSTOMER_ID=orig",
        children: [
          {
            kind: "request",
            id: "req",
            name: "Req",
            method: "GET",
            url: "{{CUSTOMER_ID}}/x",
            body: emptyBody(),
            params: emptyParams(),
            config: {},
          },
        ],
      },
    ];
    renderWith(tree);

    await user.hover(screen.getByText("{{CUSTOMER_ID}}"));
    await user.click(await screen.findByRole("button", { name: /go to source/i }));

    // The Vars grid shows the pointer row's raw value - the .env view would show
    // the resolved "orig" instead, so this discriminates target from writeTarget.
    expect(
      await screen.findByDisplayValue("{{process.env.CUSTOMER_ID}}"),
    ).toBeInTheDocument();
  });
});
