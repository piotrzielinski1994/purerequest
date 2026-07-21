import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ResponsePane } from "@/components/workspace/response-pane";
import { UrlBar } from "@/components/workspace/url-bar";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type {
  HttpClient,
  HttpRequest,
  ResponseState,
  SendResult,
} from "@/lib/http/model";
import { fixtureTree } from "./fixtures";

// A client whose send() never resolves on its own; the test settles each
// pending send by index via settle(index, result). It records every request
// passed to send() and every id passed to cancel() so the stop wiring is an
// observable side-effect contract.
type ControlledClient = HttpClient & {
  calls: HttpRequest[];
  cancelled: string[];
  settle: (index: number, result: SendResult) => void;
};

function createControlledClient(): ControlledClient {
  const calls: HttpRequest[] = [];
  const cancelled: string[] = [];
  const resolvers: Array<(result: SendResult) => void> = [];

  return {
    calls,
    cancelled,
    settle: (index, result) => resolvers[index]?.(result),
    send: (req: HttpRequest): Promise<SendResult> => {
      calls.push(req);
      return new Promise<SendResult>((resolve) => {
        resolvers.push(resolve);
      });
    },
    cancel: (requestId: string): Promise<void> => {
      cancelled.push(requestId);
      return Promise.resolve();
    },
  };
}

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

function StateReadout() {
  const { activeRequestId, responseState } = useWorkspace();
  const state =
    activeRequestId !== null ? responseState(activeRequestId) : undefined;
  return <span data-testid="active-state">{describeState(state)}</span>;
}

function renderBar(client: ControlledClient) {
  render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialExpandedIds={["folder-auth", "folder-oauth"]}
      initialActiveRequestId="req-token"
      httpClient={client}
    >
      <UrlBar />
      <ResponsePane />
      <StateReadout />
    </WorkspaceProvider>,
  );
}

describe("UrlBar Stop control", () => {
  // TC-002, AC-001 - behavior: while sending, a Stop control replaces Send.
  it("should show a Stop control instead of Send while a request is in flight", async () => {
    const user = userEvent.setup();
    const client = createControlledClient();
    renderBar(client);

    const bar = screen.getByRole("group", { name: /url bar/i });
    await user.click(within(bar).getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        within(bar).getByRole("button", { name: /stop/i }),
      ).toBeInTheDocument();
    });
    expect(
      within(bar).queryByRole("button", { name: /^send$/i }),
    ).not.toBeInTheDocument();
  });

  // TC-002, AC-001/AC-002 - side-effect-contract: Stop cancels with the same requestId.
  it("should call cancel with the in-flight requestId when Stop is clicked", async () => {
    const user = userEvent.setup();
    const client = createControlledClient();
    renderBar(client);

    const bar = screen.getByRole("group", { name: /url bar/i });
    await user.click(within(bar).getByRole("button", { name: /send/i }));

    const stop = await within(bar).findByRole("button", { name: /stop/i });
    await user.click(stop);

    await waitFor(() => {
      expect(client.cancelled).toContain(client.calls[0].requestId);
    });
  });

  // TC-002, AC-001 - behavior: after Stop, state returns to idle with no error.
  it("should return the response state to idle with no error shown after Stop", async () => {
    const user = userEvent.setup();
    const client = createControlledClient();
    renderBar(client);

    const bar = screen.getByRole("group", { name: /url bar/i });
    await user.click(within(bar).getByRole("button", { name: /send/i }));
    expect(screen.getByTestId("active-state")).toHaveTextContent("sending");

    const stop = await within(bar).findByRole("button", { name: /stop/i });
    await user.click(stop);

    // The Rust side resolves the aborted send to the cancel sentinel; surface it.
    await act(async () => {
      client.settle(0, {
        ok: false,
        error: "__cancelled__",
        cancelled: true,
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId("active-state")).toHaveTextContent("idle"),
    );
    expect(screen.queryByText(/__cancelled__/)).not.toBeInTheDocument();
    expect(screen.queryByText(/error|failed/i)).not.toBeInTheDocument();
  });
});

describe("WorkspaceProvider send - stale result race", () => {
  // TC-003, AC-002 - behavior: a stale send result must not clobber a newer send.
  it("should ignore a gen-1 result that resolves after a cancel and re-send", async () => {
    const user = userEvent.setup();
    const client = createControlledClient();
    renderBar(client);

    const bar = screen.getByRole("group", { name: /url bar/i });

    // Generation 1: start a send, then cancel it via Stop. Its promise (index 0)
    // is left pending on purpose - it will resolve LATE, after gen-2 succeeds.
    await user.click(within(bar).getByRole("button", { name: /send/i }));
    const stop1 = await within(bar).findByRole("button", { name: /stop/i });
    await user.click(stop1);
    await waitFor(() =>
      expect(screen.getByTestId("active-state")).toHaveTextContent("idle"),
    );

    // Generation 2: start a fresh send and resolve it to success.
    await user.click(within(bar).getByRole("button", { name: /send/i }));
    await act(async () => {
      client.settle(1, {
        ok: true,
        response: {
          status: 200,
          timeMs: 1,
          sizeBytes: 2,
          body: "{}",
          headers: [],
        },
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("active-state")).toHaveTextContent(
        "success:200",
      ),
    );

    // The gen-1 send now resolves for the FIRST time, with a stale success. The
    // generation guard must drop it so gen-2's success:200 survives untouched.
    await act(async () => {
      client.settle(0, {
        ok: true,
        response: {
          status: 418,
          timeMs: 9,
          sizeBytes: 9,
          body: "{}",
          headers: [],
        },
      });
    });

    expect(screen.getByTestId("active-state")).toHaveTextContent("success:200");
    expect(screen.getByTestId("active-state")).not.toHaveTextContent(
      "success:418",
    );
  });
});
