import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UrlBar } from "@/components/workspace/url-bar";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import type { TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "root",
    name: "Echo",
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
        url: "{{baseUrl}}/get?t={{process.env.TOKEN}}",
        body: emptyBody(),
        params: emptyParams(),
        config: {},
      },
    ],
  },
];

function renderBar(props: {
  activeEnvironment?: string;
  processEnv?: Record<string, string>;
}) {
  return render(
    <WorkspaceProvider
      tree={tree}
      initialActiveRequestId="req"
      initialExpandedIds={["root"]}
      {...props}
    >
      <UrlBar />
    </WorkspaceProvider>,
  );
}

describe("UrlBar token hover preview", () => {
  // behavior: hovering a {{var}} token shows its raw value in an editable input
  it("should show the value in an editable input if a variable token is hovered", async () => {
    const user = userEvent.setup();
    renderBar({ activeEnvironment: "prod" });

    await user.hover(screen.getByText("{{baseUrl}}"));

    const input = await screen.findByRole("textbox", { name: /value/i });
    expect(input).toHaveValue("https://api.example.com");
  });

  // behavior: EVERY popup has the SAME single shape - just the editable input +
  // copy button. There is no separate read-only `= resolved` line in any popup,
  // so the layout never differs between a literal value and a {{token}} chain.
  it("should not show a separate resolved-value line", async () => {
    const user = userEvent.setup();
    renderBar({ activeEnvironment: "prod" });

    await user.hover(screen.getByText("{{baseUrl}}"));

    await screen.findByRole("textbox", { name: /value/i });
    expect(screen.queryByText("=")).not.toBeInTheDocument();
    // the value appears exactly once - in the input, not duplicated in a line.
    expect(
      screen.queryByText("https://api.example.com"),
    ).not.toBeInTheDocument();
  });

  // behavior: switching the active env changes the previewed value on hover
  it("should preview the local value if the active environment is local", async () => {
    const user = userEvent.setup();
    renderBar({ activeEnvironment: "local" });

    await user.hover(screen.getByText("{{baseUrl}}"));

    const input = await screen.findByRole("textbox", { name: /value/i });
    expect(input).toHaveValue("http://localhost:3000");
  });

  // behavior: a {{process.env.X}} token previews its .env value in the input
  it("should preview a process.env token from the dotenv values", async () => {
    const user = userEvent.setup();
    renderBar({ activeEnvironment: "prod", processEnv: { TOKEN: "abc123" } });

    await user.hover(screen.getByText("{{process.env.TOKEN}}"));

    const input = await screen.findByRole("textbox", { name: /value/i });
    expect(input).toHaveValue("abc123");
  });

  // behavior: editing the value input + committing writes back to the active env
  it("should write back the edited value to the active environment", async () => {
    const user = userEvent.setup();
    renderBar({ activeEnvironment: "prod" });

    await user.hover(screen.getByText("{{baseUrl}}"));
    const input = await screen.findByRole("textbox", { name: /value/i });
    await user.clear(input);
    await user.type(input, "https://written.example.com{Enter}");

    // The URL chip still resolves; re-hover and the input shows the new value.
    await user.hover(screen.getByText("{{baseUrl}}"));
    const reopened = await screen.findByRole("textbox", { name: /value/i });
    expect(reopened).toHaveValue("https://written.example.com");
  });

  // behavior: a var whose raw value is itself a token shows the FULLY-RESOLVED
  // value in the editable input (not the raw {{token}}), so a hover always
  // answers "what does this become?" - same single-input shape as every popup.
  it("should show the resolved value in the input even when the raw value is a token", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    const indirectTree: TreeNode[] = [
      {
        kind: "folder",
        id: "root",
        name: "C",
        config: {
          variables: [{ key: "CULTURE", value: "{{process.env.CULTURE}}" }],
        },
        children: [
          {
            kind: "request",
            id: "req",
            name: "Req",
            method: "GET",
            url: "{{LTS_URL}}/references?culture={{CULTURE}}",
            body: emptyBody(),
            params: emptyParams(),
            config: {},
          },
        ],
      },
    ];
    render(
      <WorkspaceProvider
        tree={indirectTree}
        initialActiveRequestId="req"
        initialExpandedIds={["root"]}
        processEnv={{ CULTURE: "en-CA" }}
      >
        <UrlBar />
      </WorkspaceProvider>,
    );

    await user.hover(screen.getByText("{{CULTURE}}"));

    // the input shows the fully-resolved value, not the raw {{process.env.X}}.
    const input = await screen.findByRole("textbox", { name: /value/i });
    expect(input).toHaveValue("en-CA");
    // ...and copying yields the same resolved value.
    await user.click(await screen.findByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith("en-CA");
    writeText.mockRestore();
  });

  // behavior: an unresolved token shows an explicit "unresolved" hint, no input
  it("should show an unresolved hint if the token has no value", async () => {
    const user = userEvent.setup();
    renderBar({});

    await user.hover(screen.getByText("{{baseUrl}}"));

    expect(await screen.findByText(/unresolved/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /value/i }),
    ).not.toBeInTheDocument();
  });

  // behavior: an undefined variable token is colored red
  it("should color an unresolved token red", () => {
    renderBar({});

    expect(screen.getByText("{{baseUrl}}").className).toContain("text-red-500");
  });

  // behavior: a process.env token is colored amber/yellow
  it("should color a process.env token amber", () => {
    renderBar({ activeEnvironment: "prod", processEnv: { TOKEN: "abc" } });

    expect(screen.getByText("{{process.env.TOKEN}}").className).toContain(
      "text-amber-500",
    );
  });

  // behavior: an env-sourced token is colored blue
  it("should color an environment-sourced token sky/blue", () => {
    renderBar({ activeEnvironment: "prod" });

    expect(screen.getByText("{{baseUrl}}").className).toContain("text-sky-600");
  });

  // side-effect-contract: a copy button writes the resolved value to the clipboard
  it("should copy the resolved value to the clipboard if the copy button is clicked", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    renderBar({ activeEnvironment: "prod" });

    await user.hover(screen.getByText("{{baseUrl}}"));
    const copy = await screen.findByRole("button", { name: /copy/i });
    await user.click(copy);

    expect(writeText).toHaveBeenCalledWith("https://api.example.com");
    writeText.mockRestore();
  });

  // behavior: no copy button is offered for an unresolved token
  it("should not offer a copy button if the token is unresolved", async () => {
    const user = userEvent.setup();
    renderBar({});

    await user.hover(screen.getByText("{{baseUrl}}"));
    await screen.findAllByText(/unresolved/i);

    expect(
      screen.queryByRole("button", { name: /copy/i }),
    ).not.toBeInTheDocument();
  });
});

describe("UrlBar token edit drills to the real value source (AC-008)", () => {
  const pointerTree: TreeNode[] = [
    {
      kind: "folder",
      id: "root",
      name: "as24",
      config: {
        variables: [
          { key: "CUSTOMER_ID", value: "{{process.env.CUSTOMER_ID}}" },
        ],
      },
      children: [
        {
          kind: "request",
          id: "req",
          name: "Req",
          method: "GET",
          url: "{{CUSTOMER_ID}}/get",
          body: emptyBody(),
          params: emptyParams(),
          config: {},
        },
      ],
    },
  ];

  // TC-008, side-effect-contract: editing a var whose folder row is a
  // `{{process.env.KEY}}` pointer drills the write to the global `.env` (via
  // onEnvChange), NOT into the folder row. The onEnvChange call is the
  // discriminator: overwriting the folder row (today's behavior) never fires it.
  // Re-hover then confirms the value resolves end-to-end after the drilled write.
  it("should write the edited value to the global .env if the folder row is a process.env pointer", async () => {
    const user = userEvent.setup();
    const onEnvChange = vi.fn();
    // Overwriting the folder row (today's behavior) persists the tree; the drill
    // touches only the `.env`, so onTreeChange must NEVER fire - the pointer row
    // stays `{{process.env.CUSTOMER_ID}}` on disk.
    const onTreeChange = vi.fn().mockResolvedValue({ ok: true });
    render(
      <WorkspaceProvider
        tree={pointerTree}
        initialActiveRequestId="req"
        initialExpandedIds={["root"]}
        processEnv={{ CUSTOMER_ID: "orig" }}
        onEnvChange={onEnvChange}
        onTreeChange={onTreeChange}
      >
        <UrlBar />
      </WorkspaceProvider>,
    );

    await user.hover(screen.getByText("{{CUSTOMER_ID}}"));
    const input = await screen.findByRole("textbox", { name: /value/i });
    expect(input).toHaveValue("orig");

    await user.clear(input);
    await user.type(input, "new{Enter}");

    expect(onEnvChange).toHaveBeenCalled();
    expect(
      onEnvChange.mock.calls.some(([text]) =>
        String(text).includes("CUSTOMER_ID=new"),
      ),
    ).toBe(true);
    // The folder pointer row was never rewritten.
    expect(onTreeChange).not.toHaveBeenCalled();

    await user.hover(screen.getByText("{{CUSTOMER_ID}}"));
    const reopened = await screen.findByRole("textbox", { name: /value/i });
    expect(reopened).toHaveValue("new");
  });
});

describe("UrlBar path param token hover", () => {
  const pathTree = (path: Record<string, string>): TreeNode[] => [
    {
      kind: "folder",
      id: "root",
      name: "Echo",
      config: {
        variables: [{ key: "baseUrl", value: "https://api.example.com" }],
        environments: [],
      },
      children: [
        {
          kind: "request",
          id: "req",
          name: "Req",
          method: "GET",
          url: "{{baseUrl}}/users/:id",
          body: emptyBody(),
          params: {
            path: Object.entries(path).map(([key, value]) => ({ key, value })),
            query: [],
          },
          config: {},
        },
      ],
    },
  ];

  const renderPathBar = (path: Record<string, string>) =>
    render(
      <WorkspaceProvider
        tree={pathTree(path)}
        initialActiveRequestId="req"
        initialExpandedIds={["root"]}
      >
        <UrlBar />
      </WorkspaceProvider>,
    );

  // behavior: hovering a `:name` path token shows its value in an editable input,
  // the SAME popup as a {{var}} token (not a plain colored span).
  it("should show the path param value in an editable input if a :name token is hovered", async () => {
    const user = userEvent.setup();
    renderPathBar({ id: "42" });

    await user.hover(screen.getByText(":id"));

    const input = await screen.findByRole("textbox", { name: /value/i });
    expect(input).toHaveValue("42");
  });

  // behavior: a path value that is itself a {{var}} previews the RESOLVED value.
  it("should preview the resolved value if the path value is a token", async () => {
    const user = userEvent.setup();
    renderPathBar({ id: "{{baseUrl}}" });

    await user.hover(screen.getByText(":id"));

    const input = await screen.findByRole("textbox", { name: /value/i });
    expect(input).toHaveValue("https://api.example.com");
  });

  // behavior: an empty path value still shows the editable input (a `:name` is a
  // valid, editable token even before a value is set) - not an "unresolved" hint.
  it("should show an editable input even if the path value is empty", async () => {
    const user = userEvent.setup();
    renderPathBar({});

    await user.hover(screen.getByText(":id"));

    const input = await screen.findByRole("textbox", { name: /value/i });
    expect(input).toHaveValue("");
  });

  // behavior: editing the value input + committing writes back to params.path.
  it("should write the edited value back to the path param", async () => {
    const user = userEvent.setup();
    renderPathBar({ id: "42" });

    await user.hover(screen.getByText(":id"));
    const input = await screen.findByRole("textbox", { name: /value/i });
    await user.clear(input);
    await user.type(input, "99{Enter}");

    await user.hover(screen.getByText(":id"));
    const reopened = await screen.findByRole("textbox", { name: /value/i });
    expect(reopened).toHaveValue("99");
  });

  // behavior: a path token is colored sky/blue.
  it("should color a path param token sky/blue", () => {
    renderPathBar({ id: "42" });

    expect(screen.getByText(":id").className).toContain("text-sky-600");
  });
});
