import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import type { KeyValue, TreeNode } from "@/lib/workspace/model";
import { bodyFixtureTree, JSON_BODY } from "./fixtures";

// New body-mode surface on the context (spec §5). A probe component reads
// activeRequest.body.active / activeRequest.body.types.form and calls the new
// setRequestBodyMode / setRequestForm actions.
type BodyMode = "json" | "none" | "form" | "multipart" | "graphql";

type BodyModeSurface = ReturnType<typeof useWorkspace> & {
  setRequestBodyMode: (id: string, mode: BodyMode) => void;
  setRequestForm: (id: string, rows: KeyValue[]) => void;
  setRequestGraphqlQuery: (id: string, query: string) => void;
  setRequestGraphqlVariables: (id: string, variables: string) => void;
  saveActiveRequest: () => void;
};

const SEED_ROWS: KeyValue[] = [{ key: "a", value: "1" }];

function BodyModeProbe() {
  const ctx = useWorkspace() as BodyModeSurface;
  const {
    setRequestBodyMode,
    setRequestForm,
    setRequestGraphqlQuery,
    setRequestGraphqlVariables,
    saveActiveRequest,
    activeRequest,
    activeRequestId,
    dirtyRequestIds,
  } = ctx;

  const node = activeRequest;

  return (
    <div>
      <span data-testid="active-id">{activeRequestId ?? "none"}</span>
      <span data-testid="active-body">{`[${node?.body.types.json ?? "none"}]`}</span>
      <span data-testid="active-mode">{node?.body.active ?? "absent"}</span>
      <span data-testid="active-form">
        {JSON.stringify(node?.body.types.form ?? [])}
      </span>
      <span data-testid="active-gql-query">
        {node?.body.types.graphql.query ?? "none"}
      </span>
      <span data-testid="active-gql-vars">
        {node?.body.types.graphql.variables ?? "none"}
      </span>
      <span data-testid="dirty-ids">
        {[...dirtyRequestIds].sort().join(",") || "clean"}
      </span>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestBodyMode(activeRequestId, "form");
          }
        }}
      >
        set form
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestBodyMode(activeRequestId, "multipart");
          }
        }}
      >
        set multipart
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestBodyMode(activeRequestId, "json");
          }
        }}
      >
        set json
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestForm(activeRequestId, SEED_ROWS);
          }
        }}
      >
        seed rows
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestBodyMode(activeRequestId, "graphql");
          }
        }}
      >
        set graphql
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestGraphqlQuery(activeRequestId, "query { me { id } }");
          }
        }}
      >
        seed query
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestGraphqlVariables(activeRequestId, '{"id":"1"}');
          }
        }}
      >
        seed vars
      </button>
      <button type="button" onClick={() => saveActiveRequest()}>
        save request
      </button>
    </div>
  );
}

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

function renderProbe(
  initialActiveRequestId = "req-json-body",
  onTreeChange?: OnTreeChange,
) {
  return render(
    <WorkspaceProvider
      tree={bodyFixtureTree}
      initialActiveRequestId={initialActiveRequestId}
      onTreeChange={onTreeChange}
    >
      <BodyModeProbe />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceProvider body mode switching", () => {
  // AC-008, TC-006 - behavior: json text -> form -> set rows -> multipart keeps
  // the shared rows -> back to json keeps the JSON text in its own slot.
  it("should preserve form rows across form<->multipart and the JSON text across json switches", async () => {
    const user = userEvent.setup();
    renderProbe();

    // starts as json with the fixture body.
    expect(screen.getByTestId("active-body")).toHaveTextContent(
      `[${JSON_BODY}]`,
      { normalizeWhitespace: false },
    );

    await user.click(screen.getByRole("button", { name: /set form/i }));
    expect(screen.getByTestId("active-mode")).toHaveTextContent("form");

    await user.click(screen.getByRole("button", { name: /seed rows/i }));
    expect(screen.getByTestId("active-form")).toHaveTextContent(
      JSON.stringify(SEED_ROWS),
    );

    // form -> multipart keeps the shared rows.
    await user.click(screen.getByRole("button", { name: /set multipart/i }));
    expect(screen.getByTestId("active-mode")).toHaveTextContent("multipart");
    expect(screen.getByTestId("active-form")).toHaveTextContent(
      JSON.stringify(SEED_ROWS),
    );

    // back to json: the JSON text is still present in its own slot.
    await user.click(screen.getByRole("button", { name: /set json/i }));
    expect(screen.getByTestId("active-mode")).toHaveTextContent("json");
    expect(screen.getByTestId("active-body")).toHaveTextContent(
      `[${JSON_BODY}]`,
      { normalizeWhitespace: false },
    );
  });
});

describe("WorkspaceProvider body mode dirty", () => {
  // AC-010 - side-effect-contract: changing the body mode marks the request
  // dirty and surfaces its new mode on activeRequest.
  it("should mark the request dirty and reflect the new mode if the body mode is changed", async () => {
    const user = userEvent.setup();
    renderProbe();

    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");

    await user.click(screen.getByRole("button", { name: /set form/i }));

    expect(screen.getByTestId("active-mode")).toHaveTextContent("form");
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("req-json-body");
  });

  // AC-010 - side-effect-contract: editing a form row marks the request dirty.
  // Form rows only apply in form/multipart mode, so switch first, then seed.
  it("should mark the request dirty if a form row is set", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("button", { name: /set form/i }));
    await user.click(screen.getByRole("button", { name: /seed rows/i }));

    expect(screen.getByTestId("active-form")).toHaveTextContent(
      JSON.stringify(SEED_ROWS),
    );
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("req-json-body");
  });

  // AC-010 - side-effect-contract: Mod+S folds the body.active + body.types.form
  // override into the tree handed to onTreeChange and clears the dirty flag.
  it("should persist body.active and body.types.form via the save seam if the request is saved", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe("req-json-body", onTreeChange);

    await user.click(screen.getByRole("button", { name: /set form/i }));
    await user.click(screen.getByRole("button", { name: /seed rows/i }));
    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("req-json-body");

    await user.click(screen.getByRole("button", { name: /save request/i }));

    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    const persisted = onTreeChange.mock.calls[0][0];
    const saved = persisted.find(
      (node): node is Extract<TreeNode, { kind: "request" }> =>
        node.kind === "request" && node.id === "req-json-body",
    );
    expect(saved?.body.active).toBe("form");
    expect(saved?.body.types.form).toEqual(SEED_ROWS);
  });
});

describe("WorkspaceProvider graphql body setters", () => {
  // AC-001, AC-003 - behavior: the real setRequestGraphqlQuery/Variables actions
  // write the graphql slot, and it survives a switch away (json) and back, while
  // the JSON slot keeps its own text (no data loss on mode switch).
  it("should set the graphql query and variables and retain them across a json round-trip", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("button", { name: /set graphql/i }));
    await user.click(screen.getByRole("button", { name: /seed query/i }));
    await user.click(screen.getByRole("button", { name: /seed vars/i }));

    expect(screen.getByTestId("active-mode")).toHaveTextContent("graphql");
    expect(screen.getByTestId("active-gql-query")).toHaveTextContent(
      "query { me { id } }",
    );
    expect(screen.getByTestId("active-gql-vars")).toHaveTextContent('{"id":"1"}');

    // switch to json and back: the graphql slot and the JSON text both survive.
    await user.click(screen.getByRole("button", { name: /set json/i }));
    expect(screen.getByTestId("active-body")).toHaveTextContent(
      `[${JSON_BODY}]`,
      { normalizeWhitespace: false },
    );
    await user.click(screen.getByRole("button", { name: /set graphql/i }));
    expect(screen.getByTestId("active-gql-query")).toHaveTextContent(
      "query { me { id } }",
    );
    expect(screen.getByTestId("active-gql-vars")).toHaveTextContent('{"id":"1"}');
  });

  // AC-004 - side-effect-contract: Mod+S folds the graphql slot into the tree
  // handed to onTreeChange and clears the dirty flag.
  it("should persist the graphql query and variables via the save seam if the request is saved", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe("req-json-body", onTreeChange);

    await user.click(screen.getByRole("button", { name: /set graphql/i }));
    await user.click(screen.getByRole("button", { name: /seed query/i }));
    await user.click(screen.getByRole("button", { name: /seed vars/i }));
    await user.click(screen.getByRole("button", { name: /save request/i }));

    expect(screen.getByTestId("dirty-ids")).toHaveTextContent("clean");
    const persisted = onTreeChange.mock.calls[0][0];
    const saved = persisted.find(
      (node): node is Extract<TreeNode, { kind: "request" }> =>
        node.kind === "request" && node.id === "req-json-body",
    );
    expect(saved?.body.active).toBe("graphql");
    expect(saved?.body.types.graphql).toEqual({
      query: "query { me { id } }",
      variables: '{"id":"1"}',
    });
  });
});
