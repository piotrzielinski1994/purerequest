import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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
      variables: [{ key: "BASE_URL", value: "https://api" }],
      environments: [
        { name: "prod", variables: [{ key: "ENV_TOKEN", value: "tok" }] },
      ],
    },
    children: [
      {
        kind: "request",
        id: "req",
        name: "Req",
        method: "GET",
        url: "",
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

const url = () => screen.getByRole("textbox", { name: "URL" });
const listbox = () =>
  screen.queryByRole("listbox", { name: /token suggestions/i });

describe("UrlBar token autocomplete", () => {
  // behavior: typing `{{` opens a suggestion listbox with variables, the active
  // env's vars, and process.env keys.
  it("should open a suggestion list with all token sources if the user types {{", async () => {
    const user = userEvent.setup();
    renderBar({ activeEnvironment: "prod", processEnv: { HOST: "localhost" } });

    await user.click(url());
    await user.type(url(), "{{{{");

    const list = await screen.findByRole("listbox", {
      name: /token suggestions/i,
    });
    const names = within(list)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names?.some((t) => t?.includes("BASE_URL"))).toBe(true);
    expect(names?.some((t) => t?.includes("ENV_TOKEN"))).toBe(true);
    expect(names?.some((t) => t?.includes("process.env.HOST"))).toBe(true);
  });

  // behavior: a typed prefix filters the list.
  it("should filter the suggestions by the typed prefix", async () => {
    const user = userEvent.setup();
    renderBar({ activeEnvironment: "prod", processEnv: { HOST: "localhost" } });

    await user.click(url());
    await user.type(url(), "{{{{base");

    const list = await screen.findByRole("listbox", {
      name: /token suggestions/i,
    });
    const names = within(list)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain("BASE_URL");
  });

  // side-effect-contract: clicking a suggestion inserts {{name}} into the URL.
  it("should insert the token if a suggestion is clicked", async () => {
    const user = userEvent.setup();
    renderBar({ activeEnvironment: "prod" });

    await user.click(url());
    await user.type(url(), "x/{{{{base");
    await user.click(await screen.findByRole("option", { name: /BASE_URL/i }));

    expect(url()).toHaveValue("x/{{BASE_URL}}");
  });

  // behavior: ArrowDown + Enter picks the highlighted suggestion (and Enter does
  // NOT send the request while the list is open).
  it("should pick the highlighted suggestion on Enter without sending", async () => {
    const user = userEvent.setup();
    renderBar({ activeEnvironment: "prod", processEnv: { HOST: "localhost" } });

    await user.click(url());
    await user.type(url(), "{{{{process");
    // process.env.HOST is the only "process" match -> Enter inserts it.
    await user.keyboard("{Enter}");

    expect(url()).toHaveValue("{{process.env.HOST}}");
    // no response started (the request was never sent by that Enter).
    expect(screen.queryByText(/sending/i)).not.toBeInTheDocument();
  });

  // behavior: Escape closes the list without inserting.
  it("should close the list on Escape without inserting", async () => {
    const user = userEvent.setup();
    renderBar({ activeEnvironment: "prod" });

    await user.click(url());
    await user.type(url(), "{{{{base");
    expect(listbox()).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(listbox()).not.toBeInTheDocument();
    expect(url()).toHaveValue("{{base");
  });

  // behavior: a variable defined on the active REQUEST shows no source label (its
  // scope name is the long request path); a folder-scoped var still shows its label.
  it("should hide the source label for a request-scoped variable", async () => {
    const user = userEvent.setup();
    const ownTree: TreeNode[] = [
      {
        kind: "folder",
        id: "root",
        name: "Echo",
        config: { variables: [{ key: "FOLDER_VAR", value: "f" }] },
        children: [
          {
            kind: "request",
            id: "req",
            name: "Req",
            method: "GET",
            url: "",
            body: emptyBody(),
            params: emptyParams(),
            config: { variables: [{ key: "REQ_VAR", value: "r" }] },
          },
        ],
      },
    ];
    render(
      <WorkspaceProvider
        tree={ownTree}
        initialActiveRequestId="req"
        initialExpandedIds={["root"]}
      >
        <UrlBar />
      </WorkspaceProvider>,
    );

    await user.click(url());
    await user.type(url(), "{{{{_var");

    const reqOption = await screen.findByRole("option", { name: /REQ_VAR/i });
    const folderOption = screen.getByRole("option", { name: /FOLDER_VAR/i });
    // request-scoped var: no source text at all.
    expect(reqOption).toHaveTextContent(/^REQ_VAR$/);
    // folder-scoped var: keeps its source label.
    expect(folderOption).toHaveTextContent(/Echo/);
  });

  // behavior: a caret past a closed token shows no list.
  it("should not open the list when the caret is past a closed token", async () => {
    const user = userEvent.setup();
    renderBar({ activeEnvironment: "prod" });

    await user.click(url());
    await user.type(url(), "{{{{base");
    await user.click(await screen.findByRole("option", { name: /BASE_URL/i }));

    // value is now "{{BASE_URL}}", caret after the closing braces -> no list.
    expect(listbox()).not.toBeInTheDocument();
  });
});
