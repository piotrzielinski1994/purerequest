import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { UrlBar } from "@/components/workspace/url-bar";
import type { TreeNode } from "@/lib/workspace/model";

const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "root",
    name: "Echo",
    config: {
      environments: {
        local: { baseUrl: "http://localhost:3000" },
        prod: { baseUrl: "https://api.example.com" },
      },
    },
    children: [
      {
        kind: "request",
        id: "req",
        name: "Req",
        method: "GET",
        url: "{{baseUrl}}/get?t={{process.env.TOKEN}}",
        body: "",
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
    expect(screen.queryByText("https://api.example.com")).not.toBeInTheDocument();
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
        config: { variables: { CULTURE: "{{process.env.CULTURE}}" } },
        children: [
          {
            kind: "request",
            id: "req",
            name: "Req",
            method: "GET",
            url: "{{LTS_URL}}/references?culture={{CULTURE}}",
            body: "",
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
