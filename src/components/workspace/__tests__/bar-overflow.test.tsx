import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BodyPanel } from "@/components/workspace/body-panel";
import { AuthPanel, ScriptPanel } from "@/components/workspace/config-panels";
import { FolderPane } from "@/components/workspace/folder-pane";
import { RequestPane } from "@/components/workspace/request-pane";
import { ResponsePane } from "@/components/workspace/response-pane";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { fixtureTree, tokenRequest } from "./fixtures";

// Slice A is a CSS-contract: each section bar (the `h-10.25 items-stretch`
// wrapper directly around the TabsList / Select trigger) must own its own
// horizontal scroller so its tabs scroll instead of clipping when the pane is
// narrow. jsdom can't measure layout, so we assert the rendered class that
// delivers the scroll (`overflow-x-auto`). We locate the bar by finding the
// labelled control and walking up to the nearest ancestor whose className
// carries the `h-10.25` bar marker.

function barWrapperFor(label: RegExp): HTMLElement {
  const control = screen.getByLabelText(label);
  let el: HTMLElement | null = control as HTMLElement;
  while (el !== null) {
    if (el.className.includes("h-10.25")) {
      return el;
    }
    el = el.parentElement;
  }
  throw new Error(`bar wrapper (h-10.25) not found for ${label}`);
}

describe("section bar horizontal overflow (AC-001/002)", () => {
  // AC-001, TC-001 — behavior (CSS-contract)
  it("should let the request section bar scroll horizontally if its tabs overflow", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveRequestId="req-token">
        <RequestPane />
      </WorkspaceProvider>,
    );

    const bar = barWrapperFor(/request sections/i);
    expect(bar.className).toContain("overflow-x-auto");
  });

  // AC-001 — behavior (CSS-contract)
  it("should let the script stage bar scroll horizontally if it overflows", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveRequestId="req-token">
        <ScriptPanel config={tokenRequest.config} onChange={() => {}} />
      </WorkspaceProvider>,
    );

    const bar = barWrapperFor(/script stage/i);
    expect(bar.className).toContain("overflow-x-auto");
  });

  // AC-001 — behavior (CSS-contract)
  it("should let the body type selector bar scroll horizontally if it overflows", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveRequestId="req-token">
        <BodyPanel request={tokenRequest} />
      </WorkspaceProvider>,
    );

    const bar = barWrapperFor(/body type/i);
    expect(bar.className).toContain("overflow-x-auto");
  });

  // AC-001 — behavior (CSS-contract)
  it("should let the auth type selector bar scroll horizontally if it overflows", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveRequestId="req-token">
        <AuthPanel config={tokenRequest.config} onChange={() => {}} />
      </WorkspaceProvider>,
    );

    const bar = barWrapperFor(/auth type/i);
    expect(bar.className).toContain("overflow-x-auto");
  });

  // AC-001 — behavior (CSS-contract)
  it("should let the folder section bar scroll horizontally if it overflows", async () => {
    const user = userEvent.setup();
    function OpenFolderConfig() {
      const { openConfigEditor } = useWorkspace();
      return (
        <button type="button" onClick={() => openConfigEditor("folder-users")}>
          open folder config
        </button>
      );
    }
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveRequestId="req-token">
        <OpenFolderConfig />
        <FolderPane />
      </WorkspaceProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: /open folder config/i }),
    );

    const bar = barWrapperFor(/folder sections/i);
    expect(bar.className).toContain("overflow-x-auto");
  });

  // AC-001 — behavior (CSS-contract)
  it("should let the response section bar scroll horizontally if it overflows", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveRequestId="req-token">
        <ResponsePane />
      </WorkspaceProvider>,
    );

    const bar = barWrapperFor(/response sections/i);
    expect(bar.className).toContain("overflow-x-auto");
  });

  // The shadcn TabsTrigger base ships an `::after` underline at `bottom-[-5px]`
  // that pane tabs never use (active state is an inset shadow). Under
  // `overflow-x-auto` that 5px-tall pseudo forces `overflow-y:auto` -> a stray
  // draggable vertical scroll. Pane triggers must hide it (`after:hidden`).
  it("should hide the underline pseudo on section tabs so the bar has no vertical scroll", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveRequestId="req-token">
        <RequestPane />
      </WorkspaceProvider>,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(0);
    tabs.forEach((tab) => {
      expect(tab.className).toContain("after:hidden");
    });
  });
});
