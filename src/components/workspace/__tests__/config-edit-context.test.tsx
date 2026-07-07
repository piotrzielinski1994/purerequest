import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import type { ConfigScope, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import { createFakeHttpClient } from "./fake-http-client";

// A small explicit tree: a folder with vars + one request inside it. The
// request's effectiveConfig folds the folder vars, so editing the folder config
// must surface through the active request's effectiveConfig.
const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-1",
    name: "Folder",
    config: { variables: [{ key: "baseUrl", value: "https://old.example.com" }] },
    children: [
      {
        kind: "request",
        id: "req-1",
        name: "Req",
        method: "GET",
        url: "{{baseUrl}}/get",
        body: emptyBody(),
        params: emptyParams(),
        config: {},
      },
    ],
  },
];

const NEW_FOLDER_CONFIG: ConfigScope = {
  variables: [{ key: "baseUrl", value: "https://new.example.com" }],
};

// The edit-target/editor surface is new on the context; cast through an
// augmented type so this compiles before workspace-context.tsx is extended.
type EditSurface = ReturnType<typeof useWorkspace> & {
  saveNodeConfig: (id: string, config: ConfigScope) => void;
  saveEnv: (text: string) => void;
};

function EditProbe() {
  const ctx = useWorkspace() as EditSurface;
  const { effectiveConfig, processEnv, saveNodeConfig, saveEnv } = ctx;

  return (
    <div>
      <span data-testid="resolved-baseurl">
        {effectiveConfig?.variables.baseUrl?.value ?? "unresolved"}
      </span>
      <span data-testid="process-token">{processEnv.TOKEN ?? "none"}</span>
      <button
        type="button"
        onClick={() => saveNodeConfig("folder-1", NEW_FOLDER_CONFIG)}
      >
        save folder config
      </button>
      <button type="button" onClick={() => saveEnv("TOKEN=zzz")}>
        save env
      </button>
    </div>
  );
}

function renderProbe(
  props: {
    onTreeChange?: WorkspaceProviderProps["onTreeChange"];
    onEnvChange?: WorkspaceProviderProps["onEnvChange"];
    envText?: string;
  } = {},
) {
  return render(
    <WorkspaceProvider
      tree={tree}
      initialActiveRequestId="req-1"
      httpClient={createFakeHttpClient()}
      {...props}
    >
      <EditProbe />
    </WorkspaceProvider>,
  );
}

// Local alias so the prop names below stay honest even before the provider
// declares them; the actual provider props are the source of truth.
type WorkspaceProviderProps = {
  onTreeChange?: (
    tree: TreeNode[],
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onEnvChange?: (text: string) => void;
};

describe("WorkspaceProvider saveNodeConfig", () => {
  // AC-012, AC-016 - behavior: saving a node config updates the live tree so the
  // active request's effectiveConfig reflects the new value.
  it("should update effectiveConfig if a node's config is saved", async () => {
    const user = userEvent.setup();
    renderProbe();

    expect(screen.getByTestId("resolved-baseurl")).toHaveTextContent(
      "https://old.example.com",
    );

    await user.click(
      screen.getByRole("button", { name: /save folder config/i }),
    );

    expect(screen.getByTestId("resolved-baseurl")).toHaveTextContent(
      "https://new.example.com",
    );
  });

  // AC-012 - side-effect-contract: saving a node config persists via onTreeChange.
  it("should call onTreeChange if a node's config is saved", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi
      .fn<NonNullable<WorkspaceProviderProps["onTreeChange"]>>()
      .mockResolvedValue({ ok: true });
    renderProbe({ onTreeChange });

    await user.click(
      screen.getByRole("button", { name: /save folder config/i }),
    );

    expect(onTreeChange).toHaveBeenCalledTimes(1);
    const nextTree = onTreeChange.mock.calls[0][0];
    const folder = nextTree.find((node) => node.id === "folder-1");
    expect(folder?.config).toEqual(NEW_FOLDER_CONFIG);
  });
});

type TokenSurface = ReturnType<typeof useWorkspace> & {
  setTokenValue: (target: unknown, value: string) => void;
};

function TokenProbe() {
  const ctx = useWorkspace() as TokenSurface;
  const { effectiveConfig, processEnv, setTokenValue } = ctx;
  return (
    <div>
      <span data-testid="resolved-baseurl">
        {effectiveConfig?.variables.baseUrl?.value ?? "unresolved"}
      </span>
      <span data-testid="process-token">{processEnv.TOKEN ?? "none"}</span>
      <button
        type="button"
        onClick={() =>
          setTokenValue(
            { kind: "variable", scopeId: "folder-1", name: "baseUrl" },
            "https://changed.example.com",
          )
        }
      >
        edit var
      </button>
      <button
        type="button"
        onClick={() =>
          setTokenValue({ kind: "dotenv", key: "TOKEN" }, "from-edit")
        }
      >
        edit dotenv
      </button>
    </div>
  );
}

describe("WorkspaceProvider setTokenValue", () => {
  // behavior: editing a plain variable token updates the resolved config + persists
  it("should update the resolved value and persist if a variable token is edited", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi
      .fn<NonNullable<WorkspaceProviderProps["onTreeChange"]>>()
      .mockResolvedValue({ ok: true });
    render(
      <WorkspaceProvider
        tree={tree}
        initialActiveRequestId="req-1"
        httpClient={createFakeHttpClient()}
        onTreeChange={onTreeChange}
      >
        <TokenProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("resolved-baseurl")).toHaveTextContent(
      "https://old.example.com",
    );

    await user.click(screen.getByRole("button", { name: /edit var/i }));

    expect(screen.getByTestId("resolved-baseurl")).toHaveTextContent(
      "https://changed.example.com",
    );
    expect(onTreeChange).toHaveBeenCalledTimes(1);
  });

  // behavior: editing a process.env token updates processEnv + persists via onEnvChange
  it("should update processEnv and persist if a dotenv token is edited", async () => {
    const user = userEvent.setup();
    const onEnvChange = vi.fn<(text: string) => void>();
    render(
      <WorkspaceProvider
        tree={tree}
        initialActiveRequestId="req-1"
        httpClient={createFakeHttpClient()}
        envText="TOKEN=seed"
        onEnvChange={onEnvChange}
      >
        <TokenProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("process-token")).toHaveTextContent("seed");

    await user.click(screen.getByRole("button", { name: /edit dotenv/i }));

    expect(screen.getByTestId("process-token")).toHaveTextContent("from-edit");
    expect(onEnvChange).toHaveBeenCalledTimes(1);
  });
});

describe("WorkspaceProvider saveEnv", () => {
  // AC-015 - behavior: saving .env re-parses into processEnv on the context.
  it("should update processEnv if the env text is saved", async () => {
    const user = userEvent.setup();
    renderProbe();

    expect(screen.getByTestId("process-token")).toHaveTextContent("none");

    await user.click(screen.getByRole("button", { name: /save env/i }));

    expect(screen.getByTestId("process-token")).toHaveTextContent("zzz");
  });

  // AC-014, AC-015 - side-effect-contract: saving .env persists via onEnvChange.
  it("should call onEnvChange with the raw text if the env is saved", async () => {
    const user = userEvent.setup();
    const onEnvChange = vi.fn<(text: string) => void>();
    renderProbe({ onEnvChange });

    await user.click(screen.getByRole("button", { name: /save env/i }));

    expect(onEnvChange).toHaveBeenCalledTimes(1);
    expect(onEnvChange).toHaveBeenCalledWith("TOKEN=zzz");
  });
});
