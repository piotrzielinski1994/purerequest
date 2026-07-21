import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RequestPane } from "@/components/workspace/request-pane";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { bodyFixtureTree, fixtureTree } from "./fixtures";

function bodyEditor(): HTMLElement {
  // CodeMirror renders an editable surface: .cm-content carries role="textbox"
  // and contenteditable. Asserting on it (not a <pre>) pins the editable editor.
  const surface = document.querySelector<HTMLElement>(".cm-content");
  if (!surface) {
    throw new Error("body editor (.cm-content) not found");
  }
  return surface;
}

describe("RequestPane", () => {
  // AC-009, TC-004 — behavior
  it("should show the params panel by default and the headers panel after clicking Headers", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-token"
      >
        <RequestPane />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    expect(
      within(tablist).getByRole("tab", { name: "Auth" }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole("tab", { name: "Headers" }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole("tab", { name: "Params" }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole("tab", { name: "Body" }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole("tab", { name: "Script" }),
    ).toBeInTheDocument();

    // Params panel visible by default: shows the active request's params as inputs.
    expect(screen.getByDisplayValue("grant_type")).toBeInTheDocument();
    expect(screen.getByDisplayValue("client_credentials")).toBeInTheDocument();

    await user.click(within(tablist).getByRole("tab", { name: "Headers" }));

    expect(screen.getByDisplayValue("Content-Type")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("application/x-www-form-urlencoded"),
    ).toBeInTheDocument();
  });

  // AC-011 — behavior
  it("should render a token field when the active request auth is bearer", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-token"
      >
        <RequestPane />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Auth" }));

    const tokenField = screen.getByRole("textbox", { name: /token/i });
    expect(tokenField).toHaveValue("tok-abc-123");
  });

  // AC-011 — behavior
  it("should render username and password fields when the active request auth is basic", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={[]}
        initialActiveRequestId="req-profile"
      >
        <RequestPane />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Auth" }));

    expect(screen.getByRole("textbox", { name: /username/i })).toHaveValue(
      "admin",
    );
    expect(screen.getByLabelText("Password", { exact: true })).toHaveValue(
      "s3cret",
    );
  });

  // AC-011 — behavior
  it("should reveal the password when the show-password toggle is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={[]}
        initialActiveRequestId="req-profile"
      >
        <RequestPane />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Auth" }));

    const password = screen.getByLabelText("Password", { exact: true });
    expect(password).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: /show password/i }));

    expect(password).toHaveAttribute("type", "text");
  });

  // AC-011 — behavior
  it("should render a no-authentication message when the active request auth is none", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={[]}
        initialActiveRequestId="req-session"
      >
        <RequestPane />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Auth" }));

    expect(screen.getByText(/no authentication/i)).toBeInTheDocument();
  });

  // AC-001, TC-001 — behavior
  it("should render an editable code editor (not a read-only pre) on the Body tab", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={bodyFixtureTree}
        initialActiveRequestId="req-json-body"
      >
        <RequestPane />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Body" }));

    const editor = bodyEditor();
    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(editor).toHaveAttribute("role", "textbox");
    // The old read-only <pre> must be gone.
    expect(document.querySelector("pre")).toBeNull();
  });

  // AC-001, TC-001 — behavior
  it("should seed the editor with the active request's body text", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={bodyFixtureTree}
        initialActiveRequestId="req-json-body"
      >
        <RequestPane />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Body" }));

    expect(bodyEditor().textContent).toContain("grant_type");
    expect(bodyEditor().textContent).toContain("client_credentials");
  });

  // AC-002, TC-002 — behavior
  it("should show an empty editable editor with no 'No body' text if the body is empty", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={bodyFixtureTree}
        initialActiveRequestId="req-empty-body"
      >
        <RequestPane />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Body" }));

    const editor = bodyEditor();
    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(editor.textContent).toBe("");
    expect(screen.queryByText("No body")).toBeNull();
  });

  // AC-004, TC-001 — behavior
  it("should syntax-highlight a JSON body with JSON grammar applied", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={bodyFixtureTree}
        initialActiveRequestId="req-json-body"
      >
        <RequestPane />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Body" }));

    const editor = bodyEditor();
    // JSON language extension marks the content with data-language="json".
    expect(editor).toHaveAttribute("data-language", "json");
    // Grammar produces token spans inside the editable surface (not plain text).
    expect(editor.querySelector("span")).not.toBeNull();
  });
});
