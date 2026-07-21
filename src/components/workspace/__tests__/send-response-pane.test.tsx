import { EditorView } from "@codemirror/view";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ResponsePane } from "@/components/workspace/response-pane";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { createFakeHttpClient, type FakeHttpClient } from "./fake-http-client";
import { fixtureTree } from "./fixtures";

// The response body renders in a read-only CodeMirror viewer that tokenizes JSON
// into many span nodes, so getByText on a contiguous substring won't match.
// Read the live editor document instead (mirrors body-editor.test.tsx).
function responseBodyText(): string {
  const editorEl = document.querySelector<HTMLElement>(".cm-editor");
  if (!editorEl) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(editorEl);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view.state.doc.toString();
}

const SUCCESS_BODY = JSON.stringify(
  { args: { foo: "bar" }, headers: [{ key: "X-Live", value: "yes" }] },
  null,
  2,
);

function SendButton() {
  const { activeRequestId } = useWorkspace();
  const { sendRequest } = useWorkspace() as ReturnType<typeof useWorkspace> & {
    sendRequest: (id: string) => void;
  };
  return (
    <button
      type="button"
      onClick={() => {
        if (activeRequestId !== null) {
          sendRequest(activeRequestId);
        }
      }}
    >
      probe send
    </button>
  );
}

function renderPane(
  client: FakeHttpClient,
  initialActiveRequestId = "req-token",
) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialExpandedIds={["folder-auth", "folder-oauth"]}
      initialActiveRequestId={initialActiveRequestId}
      httpClient={client}
    >
      <SendButton />
      <ResponsePane />
    </WorkspaceProvider>,
  );
}

async function clickSend(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /probe send/i }));
}

describe("ResponsePane - live send states", () => {
  // AC-005 — behavior: loading state shows "Sending…".
  it("should show a sending indicator while the request is in flight", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient(undefined, { manual: true });
    renderPane(client);

    await clickSend(user);

    expect(screen.getByText(/sending/i)).toBeInTheDocument();

    await act(async () => {
      client.resolveNext();
    });
  });

  // AC-007, TC-004 — behavior: error message is shown.
  it("should show the error message if the send fails", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient({
      ok: false,
      error: "Request failed: dns error",
    });
    renderPane(client);

    await clickSend(user);

    expect(
      await screen.findByText(/request failed: dns error/i),
    ).toBeInTheDocument();
  });

  // AC-006, TC-001 — behavior: success shows status/time/size + body.
  it("should show the status, time, size and body on a successful send", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient({
      ok: true,
      response: {
        status: 201,
        timeMs: 73,
        sizeBytes: 248,
        body: SUCCESS_BODY,
        headers: [{ key: "X-Live", value: "yes" }],
      },
    });
    renderPane(client);

    await clickSend(user);

    expect(await screen.findByText("201")).toBeInTheDocument();
    expect(screen.getByText(/73\s*ms/)).toBeInTheDocument();
    expect(screen.getByText(/248\s*B/)).toBeInTheDocument();
    await waitFor(() => expect(responseBodyText()).toContain('"foo": "bar"'));
  });

  // AC-006 — behavior: success headers show on the Headers tab.
  it("should show the live response headers after a successful send", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient({
      ok: true,
      response: {
        status: 200,
        timeMs: 10,
        sizeBytes: 5,
        body: SUCCESS_BODY,
        headers: [{ key: "X-Live", value: "yes" }],
      },
    });
    renderPane(client);

    await clickSend(user);
    await screen.findByText("200");

    const tablist = screen.getByRole("tablist", { name: /response sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Headers" }));

    expect(screen.getByText("X-Live")).toBeInTheDocument();
    expect(screen.getByText("yes")).toBeInTheDocument();
  });
});

describe("ResponsePane - idle fallback", () => {
  // AC-004 (UI states) — behavior: idle falls back to the seeded node response.
  it("should show the seeded response if no send has been issued", () => {
    renderPane(createFakeHttpClient(), "req-token");

    // req-token's seeded response is 200 with an access_token body.
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(responseBodyText()).toContain("access_token");
  });

  // AC-004 (UI states) — behavior: no seeded response and idle -> "No response".
  it("should show 'No response' if the active request has no seeded response and no send", () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        httpClient={client}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
      >
        <NewRequestButton />
        <ResponsePane />
      </WorkspaceProvider>,
    );

    return user
      .click(screen.getByRole("button", { name: /new request/i }))
      .then(() => {
        expect(screen.getByText(/no response/i)).toBeInTheDocument();
      });
  });
});

function NewRequestButton() {
  const { newRequest } = useWorkspace();
  return (
    <button type="button" onClick={() => newRequest()}>
      new request
    </button>
  );
}

describe("ResponsePane - filter", () => {
  function renderWithSuccess() {
    const user = userEvent.setup();
    const client = createFakeHttpClient({
      ok: true,
      response: {
        status: 200,
        timeMs: 10,
        sizeBytes: 5,
        body: SUCCESS_BODY,
        headers: [],
      },
    });
    renderPane(client);
    return user;
  }

  // AC-009, TC-006 — behavior: a path narrows the shown body.
  it("should narrow the shown body to the matched subtree when a path is typed", async () => {
    const user = renderWithSuccess();
    await user.click(screen.getByRole("button", { name: /probe send/i }));
    await waitFor(() => expect(responseBodyText()).toContain('"foo": "bar"'));

    const filter = screen.getByRole("textbox", { name: /filter response/i });
    await user.type(filter, "$.args");

    await waitFor(() =>
      expect(responseBodyText()).toBe('{\n  "foo": "bar"\n}'),
    );
  });

  // AC-009 — behavior: a scalar path shows the raw value.
  it("should show a matched scalar raw when the path points at a string", async () => {
    const user = renderWithSuccess();
    await user.click(screen.getByRole("button", { name: /probe send/i }));
    await waitFor(() => expect(responseBodyText()).toContain('"foo": "bar"'));

    const filter = screen.getByRole("textbox", { name: /filter response/i });
    await user.type(filter, "$.args.foo");

    await waitFor(() => expect(responseBodyText()).toBe("bar"));
  });

  // AC-010 — behavior: empty filter shows the full body.
  it("should restore the full body when the filter is cleared", async () => {
    const user = renderWithSuccess();
    await user.click(screen.getByRole("button", { name: /probe send/i }));
    await waitFor(() => expect(responseBodyText()).toContain('"foo": "bar"'));

    const filter = screen.getByRole("textbox", { name: /filter response/i });
    await user.type(filter, "$.args.foo");
    await waitFor(() => expect(responseBodyText()).toBe("bar"));

    await user.clear(filter);

    await waitFor(() => expect(responseBodyText()).toContain('"headers"'));
  });

  // AC-011, TC-007 — behavior: a no-match path shows a clear indication.
  it("should show a no-match indication when the path matches nothing", async () => {
    const user = renderWithSuccess();
    await user.click(screen.getByRole("button", { name: /probe send/i }));
    await waitFor(() => expect(responseBodyText()).toContain('"foo": "bar"'));

    const filter = screen.getByRole("textbox", { name: /filter response/i });
    await user.type(filter, "$.nope");

    expect(screen.getByText(/no match/i)).toBeInTheDocument();
  });
});
