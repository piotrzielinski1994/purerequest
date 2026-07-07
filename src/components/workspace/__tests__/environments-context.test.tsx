import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import type { TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import { createFakeHttpClient, type FakeHttpClient } from "./fake-http-client";

// Root folder defines two environments; the request url uses a bare {{baseUrl}}
// (env-supplied) and a {{process.env.HOST}} token (process.env namespace).
const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "root",
    name: "Root",
    config: {
      environments: [
        {
          name: "local",
          variables: [{ key: "baseUrl", value: "http://localhost:3000" }],
        },
        {
          name: "prod",
          variables: [{ key: "baseUrl", value: "https://api.example.com" }],
        },
      ],
    },
    children: [
      {
        kind: "request",
        id: "req",
        name: "Req",
        method: "GET",
        url: "{{baseUrl}}/get?h={{process.env.HOST}}",
        body: emptyBody(),
        params: emptyParams(),
        config: {},
      },
    ],
  },
];

function EnvProbe() {
  const ctx = useWorkspace();
  const {
    effectiveConfig,
    environmentNames,
    activeEnvironment,
    setActiveEnvironment,
    sendRequest,
  } = ctx as ReturnType<typeof useWorkspace> & {
    environmentNames: string[];
    activeEnvironment: string | null;
    setActiveEnvironment: (name: string | null) => void;
  };

  return (
    <div>
      <span data-testid="env-names">{environmentNames.join(",")}</span>
      <span data-testid="active-env">{activeEnvironment ?? "none"}</span>
      <span data-testid="resolved-baseurl">
        {effectiveConfig?.variables.baseUrl?.value ?? "unresolved"}
      </span>
      <button type="button" onClick={() => setActiveEnvironment("local")}>
        use local
      </button>
      <button type="button" onClick={() => setActiveEnvironment("prod")}>
        use prod
      </button>
      <button type="button" onClick={() => setActiveEnvironment(null)}>
        use none
      </button>
      <button type="button" onClick={() => sendRequest("req")}>
        send
      </button>
    </div>
  );
}

function renderProbe(
  client: FakeHttpClient,
  props: {
    activeEnvironment?: string;
    processEnv?: Record<string, string>;
  } = {},
) {
  return render(
    <WorkspaceProvider
      tree={tree}
      initialActiveRequestId="req"
      httpClient={client}
      {...props}
    >
      <EnvProbe />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceProvider environments - context surface", () => {
  // AC-002 - behavior: environmentNames is the union from the tree
  it("should expose the union of environment names from the tree", () => {
    renderProbe(createFakeHttpClient());

    expect(screen.getByTestId("env-names")).toHaveTextContent("local,prod");
  });

  // AC-007 - behavior: an explicit activeEnvironment prop is reflected
  it("should reflect the activeEnvironment passed as a prop", () => {
    renderProbe(createFakeHttpClient(), { activeEnvironment: "prod" });

    expect(screen.getByTestId("active-env")).toHaveTextContent("prod");
  });
});

describe("WorkspaceProvider environments - effectiveConfig", () => {
  // AC-007 - behavior: with no active env, the env-only baseUrl is unresolved
  it("should not resolve an env-only variable if no environment is active", () => {
    renderProbe(createFakeHttpClient());

    expect(screen.getByTestId("resolved-baseurl")).toHaveTextContent(
      "unresolved",
    );
  });

  // AC-001, AC-007, TC-001 - behavior: effectiveConfig resolves the active env var
  it("should resolve the env baseUrl through effectiveConfig when an env is active", () => {
    renderProbe(createFakeHttpClient(), { activeEnvironment: "prod" });

    expect(screen.getByTestId("resolved-baseurl")).toHaveTextContent(
      "https://api.example.com",
    );
  });

  // AC-007, TC-001 - behavior: switching the active env changes the resolved value
  it("should change the resolved env baseUrl if the active environment switches", async () => {
    const user = userEvent.setup();
    renderProbe(createFakeHttpClient());

    await user.click(screen.getByRole("button", { name: /use local/i }));
    expect(screen.getByTestId("resolved-baseurl")).toHaveTextContent(
      "http://localhost:3000",
    );

    await user.click(screen.getByRole("button", { name: /use prod/i }));
    expect(screen.getByTestId("resolved-baseurl")).toHaveTextContent(
      "https://api.example.com",
    );
  });
});

describe("WorkspaceProvider environments - send interpolation", () => {
  // AC-009, TC-001 - side-effect-contract: send interpolates the active env var into the url
  it("should interpolate the active env baseUrl into the sent url", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    renderProbe(client, {
      activeEnvironment: "prod",
      processEnv: { HOST: "h1" },
    });

    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(client.callCount).toBe(1);
    });
    expect(client.calls[0].url).toContain("https://api.example.com/get");
  });

  // AC-009, TC-003 - side-effect-contract: send resolves {{process.env.X}} from processEnv
  it("should interpolate a {{process.env.X}} token into the sent url", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    renderProbe(client, {
      activeEnvironment: "prod",
      processEnv: { HOST: "from-dotenv" },
    });

    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(client.callCount).toBe(1);
    });
    expect(client.calls[0].url).toContain("h=from-dotenv");
  });

  // AC-007, AC-009 - side-effect-contract: switching env changes the sent url
  it("should send localhost after switching the active env to local", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    renderProbe(client, { processEnv: { HOST: "h1" } });

    await user.click(screen.getByRole("button", { name: /use local/i }));
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(client.callCount).toBe(1);
    });
    expect(client.calls[0].url).toContain("http://localhost:3000/get");
  });
});
