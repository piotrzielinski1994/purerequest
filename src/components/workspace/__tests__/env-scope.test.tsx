import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

// folder A (envs prod+local) > req-a ; folder B (env staging) > req-b
const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "f-a",
    name: "A",
    config: {
      environments: [
        { name: "prod", variables: [] },
        { name: "local", variables: [] },
      ],
    },
    children: [
      {
        kind: "request",
        id: "req-a",
        name: "A Req",
        method: "GET",
        url: "",
        body: emptyBody(),
        params: emptyParams(),
        config: {},
      },
    ],
  },
  {
    kind: "folder",
    id: "f-b",
    name: "B",
    config: { environments: [{ name: "staging", variables: [] }] },
    children: [
      {
        kind: "request",
        id: "req-b",
        name: "B Req",
        method: "GET",
        url: "",
        body: emptyBody(),
        params: emptyParams(),
        config: {},
      },
    ],
  },
];

// Surfaces the scoped env list + the active env as text, and drives tab switches.
function ScopeProbe() {
  const { environmentNames, activeEnvironment, setActiveRequest } =
    useWorkspace();
  return (
    <div>
      <output data-testid="envs">{environmentNames.join(",")}</output>
      <output data-testid="active">{activeEnvironment ?? "none"}</output>
      <button type="button" onClick={() => setActiveRequest("req-a")}>
        tab a
      </button>
      <button type="button" onClick={() => setActiveRequest("req-b")}>
        tab b
      </button>
    </div>
  );
}

const envs = () => screen.getByTestId("envs").textContent;
const active = () => screen.getByTestId("active").textContent;

describe("env scope - combobox options scoped to the active tab (AC-009)", () => {
  // AC-009, TC-009 - behavior: with a request in folder A active, the scoped env
  // list is only A's chain envs (prod, local), not folder B's staging.
  it("should list only the active tab's chain envs", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={tree} initialActiveRequestId="req-a">
        <ScopeProbe />
      </WorkspaceProvider>,
    );

    expect(envs()).toBe("local,prod");

    await user.click(screen.getByRole("button", { name: /^tab b$/i }));

    expect(envs()).toBe("staging");
  });
});

describe("env scope - reset on tab change out of scope (AC-010)", () => {
  // AC-010, TC-010 - behavior: with prod active and a request in folder A, switching
  // the active tab to a request whose chain lacks prod resets the active env to null.
  it("should reset the active env to null if the new active tab's chain lacks it", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={tree}
        activeEnvironment="prod"
        initialActiveRequestId="req-a"
        initialOpenRequestIds={["req-a", "req-b"]}
      >
        <ScopeProbe />
      </WorkspaceProvider>,
    );

    expect(active()).toBe("prod");

    await user.click(screen.getByRole("button", { name: /^tab b$/i }));

    expect(active()).toBe("none");
  });

  // AC-010 - behavior: switching to a tab whose chain STILL defines the active env
  // keeps it (guards over-eager resetting). Both A's requests share prod in scope.
  it("should keep the active env if the new active tab's chain still defines it", async () => {
    const user = userEvent.setup();
    const twoInA: TreeNode[] = [
      {
        kind: "folder",
        id: "f-a",
        name: "A",
        config: {
          environments: [
            { name: "prod", variables: [] },
            { name: "local", variables: [] },
          ],
        },
        children: [
          {
            kind: "request",
            id: "req-a1",
            name: "A1",
            method: "GET",
            url: "",
            body: emptyBody(),
            params: emptyParams(),
            config: {},
          },
          {
            kind: "request",
            id: "req-a2",
            name: "A2",
            method: "GET",
            url: "",
            body: emptyBody(),
            params: emptyParams(),
            config: {},
          },
        ],
      },
    ];
    function TwoProbe() {
      const { activeEnvironment, setActiveRequest } = useWorkspace();
      return (
        <div>
          <output data-testid="active">{activeEnvironment ?? "none"}</output>
          <button type="button" onClick={() => setActiveRequest("req-a2")}>
            tab a2
          </button>
        </div>
      );
    }
    render(
      <WorkspaceProvider
        tree={twoInA}
        activeEnvironment="prod"
        initialActiveRequestId="req-a1"
        initialOpenRequestIds={["req-a1", "req-a2"]}
      >
        <TwoProbe />
      </WorkspaceProvider>,
    );

    expect(active()).toBe("prod");

    await user.click(screen.getByRole("button", { name: /^tab a2$/i }));

    expect(active()).toBe("prod");
  });
});
