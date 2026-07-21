import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EnvSelector } from "@/components/workspace/env-selector";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

// A tree with env names spread across nested scopes; the selector lists the
// union (prod/local/staging) found anywhere.
const envTree: TreeNode[] = [
  {
    kind: "folder",
    id: "root",
    name: "Root",
    config: {
      environments: [
        {
          name: "prod",
          variables: [{ key: "baseUrl", value: "https://api.example.com" }],
        },
        {
          name: "local",
          variables: [{ key: "baseUrl", value: "http://localhost:3000" }],
        },
      ],
    },
    children: [
      {
        kind: "folder",
        id: "sub",
        name: "Sub",
        config: {
          environments: [
            {
              name: "staging",
              variables: [{ key: "baseUrl", value: "https://stg" }],
            },
          ],
        },
        children: [
          {
            kind: "request",
            id: "req",
            name: "Req",
            method: "GET",
            url: "{{baseUrl}}/get",
            body: emptyBody(),
            params: emptyParams(),
            config: {},
          },
        ],
      },
    ],
  },
];

const emptyTree: TreeNode[] = [
  {
    kind: "request",
    id: "req",
    name: "Req",
    method: "GET",
    url: "https://api.test/get",
    body: emptyBody(),
    params: emptyParams(),
    config: {},
  },
];

// Drives setActiveEnvironment through context (radix dropdown opening is
// unreliable under jsdom, per docs/learnings.md), then renders the selector to
// observe the shown active value on the trigger.
function SelectorHarness({ pick }: { pick?: string | null }) {
  const { setActiveEnvironment } = useWorkspace();
  return (
    <div>
      <EnvSelector />
      <button type="button" onClick={() => setActiveEnvironment(pick ?? null)}>
        pick env
      </button>
    </div>
  );
}

describe("EnvSelector - listing the env-name union", () => {
  // AC-002 - behavior: the trigger reflects the active environment value
  it("should show the active environment name on the trigger", () => {
    render(
      <WorkspaceProvider tree={envTree} activeEnvironment="prod">
        <EnvSelector />
      </WorkspaceProvider>,
    );

    const trigger = screen.getByRole("combobox", { name: /environment/i });
    expect(trigger).toHaveTextContent("prod");
  });

  // AC-002 - behavior: with no active env the trigger shows "No Environment"
  it("should show No Environment on the trigger if nothing is active", () => {
    render(
      <WorkspaceProvider tree={envTree}>
        <EnvSelector />
      </WorkspaceProvider>,
    );

    const trigger = screen.getByRole("combobox", { name: /environment/i });
    expect(trigger).toHaveTextContent(/no environment/i);
  });

  // AC-002, UI state "Empty" - behavior: with no env names anywhere it still renders a trigger
  it("should render the selector trigger even if the tree has no environments", () => {
    render(
      <WorkspaceProvider tree={emptyTree}>
        <EnvSelector />
      </WorkspaceProvider>,
    );

    const trigger = screen.getByRole("combobox", { name: /environment/i });
    expect(trigger).toHaveTextContent(/no environment/i);
  });
});

describe("EnvSelector - selection", () => {
  // AC-002, AC-003 - behavior: the trigger reflects the active env after switching it
  it("should update the shown value if the active environment is set through context", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={envTree}>
        <SelectorHarness pick="local" />
      </WorkspaceProvider>,
    );

    const trigger = screen.getByRole("combobox", { name: /environment/i });
    expect(trigger).toHaveTextContent(/no environment/i);

    await user.click(screen.getByRole("button", { name: /pick env/i }));

    expect(
      screen.getByRole("combobox", { name: /environment/i }),
    ).toHaveTextContent("local");
  });

  // AC-003 - side-effect-contract: switching the env notifies onActiveEnvironmentChange
  it("should call onActiveEnvironmentChange if the active environment is switched", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <WorkspaceProvider tree={envTree} onActiveEnvironmentChange={onChange}>
        <SelectorHarness pick="staging" />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /pick env/i }));

    expect(onChange).toHaveBeenCalledWith("staging");
  });

  // AC-002, AC-003 - side-effect-contract: clearing to No Environment notifies with null
  it("should call onActiveEnvironmentChange with null if cleared to No Environment", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <WorkspaceProvider
        tree={envTree}
        activeEnvironment="prod"
        onActiveEnvironmentChange={onChange}
      >
        <SelectorHarness pick={null} />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /pick env/i }));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
