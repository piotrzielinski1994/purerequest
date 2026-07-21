import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { ResponseState } from "@/lib/http/model";
import { createFakeHttpClient, type FakeHttpClient } from "./fake-http-client";
import { fixtureTree } from "./fixtures";

function describeState(state: ResponseState | undefined): string {
  if (!state) {
    return "none";
  }
  if (state.status === "success") {
    return `success:${state.response.status}`;
  }
  if (state.status === "error") {
    return `error:${state.message}`;
  }
  return state.status;
}

function readState(
  ctx: ReturnType<typeof useWorkspace>,
  id: string,
): ResponseState | undefined {
  const withResponseState = ctx as ReturnType<typeof useWorkspace> & {
    responseState?: (id: string) => ResponseState;
    responseStates?: Map<string, ResponseState>;
  };
  if (typeof withResponseState.responseState === "function") {
    return withResponseState.responseState(id);
  }
  return withResponseState.responseStates?.get(id);
}

function SendProbe() {
  const ctx = useWorkspace();
  const {
    activeRequest,
    activeRequestId,
    setRequestUrl,
    setRequestMethod,
    sendRequest,
    setActiveRequest,
    selectNode,
    newRequest,
    closeRequest,
    closeAllRequests,
  } = ctx as ReturnType<typeof useWorkspace> & {
    setRequestUrl: (id: string, url: string) => void;
    setRequestMethod: (id: string, method: string) => void;
    sendRequest: (id: string) => void;
  };

  const activeState = activeRequestId
    ? readState(ctx, activeRequestId)
    : undefined;

  return (
    <div>
      <span data-testid="active-id">{activeRequestId ?? "none"}</span>
      <span data-testid="active-url">{`[${activeRequest?.url ?? "none"}]`}</span>
      <span data-testid="active-method">{activeRequest?.method ?? "none"}</span>
      <span data-testid="active-state">{describeState(activeState)}</span>
      <span data-testid="token-state">
        {describeState(readState(ctx, "req-token"))}
      </span>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestUrl(activeRequestId, "https://edited.example.com/x");
          }
        }}
      >
        edit url
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestMethod(activeRequestId, "POST");
          }
        }}
      >
        edit method
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            sendRequest(activeRequestId);
          }
        }}
      >
        send active
      </button>
      <button type="button" onClick={() => setActiveRequest("req-token")}>
        activate token
      </button>
      <button type="button" onClick={() => setActiveRequest("req-profile")}>
        activate profile
      </button>
      <button type="button" onClick={() => selectNode("req-token")}>
        open token
      </button>
      <button type="button" onClick={() => newRequest()}>
        new request
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            closeRequest(activeRequestId);
          }
        }}
      >
        close active
      </button>
      <button type="button" onClick={() => closeAllRequests()}>
        close all
      </button>
    </div>
  );
}

function renderProbe(client: FakeHttpClient, initialActiveRequestId?: string) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialExpandedIds={["folder-auth", "folder-oauth"]}
      initialActiveRequestId={initialActiveRequestId}
      httpClient={client}
    >
      <SendProbe />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceProvider setRequestUrl / setRequestMethod", () => {
  // AC-001 — side-effect-contract: url override reflects on activeRequest.
  it("should reflect a url override on the active request", async () => {
    const user = userEvent.setup();
    renderProbe(createFakeHttpClient(), "req-token");

    await user.click(screen.getByRole("button", { name: /edit url/i }));

    expect(screen.getByTestId("active-url")).toHaveTextContent(
      "[https://edited.example.com/x]",
    );
  });

  // AC-002 — side-effect-contract: method override reflects on activeRequest.
  it("should reflect a method override on the active request", async () => {
    const user = userEvent.setup();
    renderProbe(createFakeHttpClient(), "req-profile");

    expect(screen.getByTestId("active-method")).toHaveTextContent("GET");

    await user.click(screen.getByRole("button", { name: /edit method/i }));

    expect(screen.getByTestId("active-method")).toHaveTextContent("POST");
  });

  // AC-001, AC-002, TC-003 — behavior: overrides are per-id.
  it("should not change another request's url if one request's url is edited", async () => {
    const user = userEvent.setup();
    renderProbe(createFakeHttpClient(), "req-token");

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    expect(screen.getByTestId("active-url")).toHaveTextContent(
      "[https://edited.example.com/x]",
    );

    await user.click(screen.getByRole("button", { name: /activate profile/i }));

    expect(screen.getByTestId("active-id")).toHaveTextContent("req-profile");
    expect(screen.getByTestId("active-url")).toHaveTextContent(
      "[{{baseUrl}}/users/:id]",
    );
  });

  // AC-001, TC-003 — behavior: closing a tree request drops its override.
  it("should revert the url if a tree request is edited, closed, then reopened", async () => {
    const user = userEvent.setup();
    renderProbe(createFakeHttpClient(), "req-token");

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    expect(screen.getByTestId("active-url")).toHaveTextContent(
      "[https://edited.example.com/x]",
    );

    await user.click(screen.getByRole("button", { name: /close active/i }));
    await user.click(screen.getByRole("button", { name: /open token/i }));

    expect(screen.getByTestId("active-id")).toHaveTextContent("req-token");
    expect(screen.getByTestId("active-url")).toHaveTextContent(
      "[{{baseUrl}}/oauth/token]",
    );
  });

  // spec §5 — behavior: closeAllRequests clears url/method overrides.
  it("should drop url overrides if every request is closed at once", async () => {
    const user = userEvent.setup();
    renderProbe(createFakeHttpClient(), "req-token");

    await user.click(screen.getByRole("button", { name: /edit url/i }));
    await user.click(screen.getByRole("button", { name: /close all/i }));
    expect(screen.getByTestId("active-id")).toHaveTextContent("none");

    await user.click(screen.getByRole("button", { name: /open token/i }));

    expect(screen.getByTestId("active-url")).toHaveTextContent(
      "[{{baseUrl}}/oauth/token]",
    );
  });
});

describe("WorkspaceProvider sendRequest - success", () => {
  // AC-003 — side-effect-contract: send calls the client exactly once.
  it("should call the http client exactly once per send", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    renderProbe(client, "req-token");

    await user.click(screen.getByRole("button", { name: /send active/i }));

    await waitFor(() => {
      expect(client.callCount).toBe(1);
    });
  });

  // AC-005, AC-006, TC-001 — behavior: idle -> sending -> success.
  it("should transition the active request from sending to success", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient(
      {
        ok: true,
        response: {
          status: 200,
          timeMs: 12,
          sizeBytes: 5,
          body: '{"ok":true}',
          headers: [],
        },
      },
      { manual: true },
    );
    renderProbe(client, "req-token");

    await user.click(screen.getByRole("button", { name: /send active/i }));

    expect(screen.getByTestId("active-state")).toHaveTextContent("sending");

    await act(async () => {
      client.resolveNext();
    });

    await waitFor(() => {
      expect(screen.getByTestId("active-state")).toHaveTextContent(
        "success:200",
      );
    });
  });

  // AC-003 — side-effect-contract: the wire request carries the live method/url override.
  it("should send the overridden method and url for the active request", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    renderProbe(client, "req-profile");

    await user.click(screen.getByRole("button", { name: /edit method/i }));
    await user.click(screen.getByRole("button", { name: /edit url/i }));
    await user.click(screen.getByRole("button", { name: /send active/i }));

    await waitFor(() => {
      expect(client.callCount).toBe(1);
    });
    expect(client.calls[0].method).toBe("POST");
    // req-profile resolves an `expand=roles` param, so AC-004 appends it to the
    // overridden url; assert the base survives the override + the merge.
    expect(client.calls[0].url).toContain("https://edited.example.com/x");
    expect(client.calls[0].url).toContain("expand=roles");
  });
});

describe("WorkspaceProvider sendRequest - error", () => {
  // AC-007, TC-004 — behavior: idle -> sending -> error, no crash.
  it("should transition the active request to error with the failure message", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient({
      ok: false,
      error: "Request failed: dns error",
    });
    renderProbe(client, "req-token");

    await user.click(screen.getByRole("button", { name: /send active/i }));

    await waitFor(() => {
      expect(screen.getByTestId("active-state")).toHaveTextContent(
        "error:Request failed: dns error",
      );
    });
  });

  // AC-007, TC-004 — behavior: a failed request can be re-sent.
  it("should allow re-sending after an error", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient({
      ok: false,
      error: "boom",
    });
    renderProbe(client, "req-token");

    await user.click(screen.getByRole("button", { name: /send active/i }));
    await waitFor(() => {
      expect(screen.getByTestId("active-state")).toHaveTextContent(
        "error:boom",
      );
    });

    await user.click(screen.getByRole("button", { name: /send active/i }));

    await waitFor(() => {
      expect(client.callCount).toBe(2);
    });
  });
});

describe("WorkspaceProvider sendRequest - concurrency", () => {
  // AC-005 — side-effect-contract: a second send while sending is blocked.
  it("should not call the client a second time if send fires again while sending", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient(undefined, { manual: true });
    renderProbe(client, "req-token");

    await user.click(screen.getByRole("button", { name: /send active/i }));
    expect(screen.getByTestId("active-state")).toHaveTextContent("sending");

    // Second click while still in flight must be ignored.
    await user.click(screen.getByRole("button", { name: /send active/i }));

    expect(client.callCount).toBe(1);

    await act(async () => {
      client.resolveNext();
    });
  });
});

describe("WorkspaceProvider sendRequest - per-id state", () => {
  // AC-005 — behavior: response state is keyed per request id.
  it("should not put another request into sending if one request is sent", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient(undefined, { manual: true });
    renderProbe(client, "req-profile");

    await user.click(screen.getByRole("button", { name: /send active/i }));

    // The active (profile) request is sending; token stays idle/untouched.
    expect(screen.getByTestId("active-state")).toHaveTextContent("sending");
    expect(screen.getByTestId("token-state")).not.toHaveTextContent("sending");

    await act(async () => {
      client.resolveNext();
    });
  });
});

describe("WorkspaceProvider sendRequest - closed mid-flight", () => {
  // spec §6 / plan §5 — behavior: a result for a request closed while in flight
  // is dropped, not re-inserted into the response state.
  it("should not resurrect response state for a request closed before its send resolves", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient(undefined, { manual: true });
    renderProbe(client, "req-token");

    await user.click(screen.getByRole("button", { name: /send active/i }));
    expect(screen.getByTestId("token-state")).toHaveTextContent("sending");

    await user.click(screen.getByRole("button", { name: /close active/i }));

    await act(async () => {
      client.resolveNext();
    });

    // req-token is closed; its state reverts to idle (dropped from the map),
    // not resurrected to success by the late resolve.
    expect(screen.getByTestId("token-state")).toHaveTextContent("idle");
  });
});

describe("WorkspaceProvider sendRequest - freshly created request", () => {
  // spec §6 — behavior: a just-created (new) request sends fine.
  it("should send a freshly created request through the client", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    renderProbe(client, "req-token");

    await user.click(screen.getByRole("button", { name: /new request/i }));
    expect(screen.getByTestId("active-id")).not.toHaveTextContent(/^draft-/);

    await user.click(screen.getByRole("button", { name: /send active/i }));

    await waitFor(() => {
      expect(client.callCount).toBe(1);
    });
  });
});
