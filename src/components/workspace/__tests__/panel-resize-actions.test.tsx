import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { fixtureTree } from "./fixtures";

// react-resizable-panels measures the group/panels via offsetWidth/offsetHeight,
// which jsdom reports as 0 (so getLayout() returns {} and setLayout() no-ops).
// Faking a real measured size makes the imperative group API functional: the
// seeded defaultLayout resolves, setLayout clamps + applies, and each panel's
// style.flexGrow reflects its live percentage. Verified against the library.
let sizeDescriptors: Array<[string, PropertyDescriptor | undefined]> = [];

beforeEach(() => {
  sizeDescriptors = [
    ["offsetWidth", Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")],
    ["offsetHeight", Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")],
  ];
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 1000;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 500;
    },
  });
});

afterEach(() => {
  sizeDescriptors.forEach(([prop, descriptor]) => {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, prop, descriptor);
    }
  });
});

function renderShell(overrides: Partial<Settings> = {}) {
  const seeded: Settings = {
    ...DEFAULT_SETTINGS,
    shortcuts: {},
    layouts: {
      workspace: { sidebar: 20, content: 80 },
      main: { content: 75, console: 25 },
    },
    ...overrides,
  };
  const store = createInMemorySettingsStore(seeded);
  const saveSpy = vi.spyOn(store, "save");
  render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={["[12:00:00] Ready."]}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-profile"
      >
        <WorkspaceLayout />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
  return { store, saveSpy };
}

function flexGrowOf(id: string): number {
  const el = document.getElementById(id) as HTMLElement | null;
  return Number((el?.style.flexGrow ?? "") || "NaN");
}

const EXPAND = "{Control>}{Alt>}={/Alt}{/Control}";
const SHRINK = "{Control>}{Alt>}-{/Alt}{/Control}";

describe("panel resize actions - sidebar focus", () => {
  // AC-002, TC-002 — behavior
  it("should grow the sidebar panel by 5% if panel-expand fires with focus in the sidebar tree", async () => {
    const user = userEvent.setup();
    const { store } = renderShell();
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(20));

    const tree = screen.getByRole("tree", { name: /collection/i });
    within(tree).getAllByRole("treeitem")[0].focus();

    await user.keyboard(EXPAND);

    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(25));
    const persisted = await store.load();
    expect(persisted.layouts.workspace!.sidebar).toBe(25);
  });

  // AC-002, TC-003 — behavior
  it("should shrink the sidebar panel by 5% if panel-shrink fires with focus in the sidebar tree", async () => {
    const user = userEvent.setup();
    const { store } = renderShell();
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(20));

    const tree = screen.getByRole("tree", { name: /collection/i });
    within(tree).getAllByRole("treeitem")[0].focus();

    await user.keyboard(SHRINK);

    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(15));
    const persisted = await store.load();
    expect(persisted.layouts.workspace!.sidebar).toBe(15);
  });

  // AC-004, TC-005 — boundary: from 38% a full +5% step would reach 43% but is
  // clamped to the 40% max. Landing exactly on 40 (not 43, not 38) proves the
  // action fired AND clamped - a real change, so this is RED before impl.
  it("should clamp the sidebar at its 40% max if panel-expand fires near the max", async () => {
    const user = userEvent.setup();
    const { store } = renderShell({
      layouts: {
        workspace: { sidebar: 38, content: 62 },
        main: { content: 75, console: 25 },
      },
    });
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(38));

    const tree = screen.getByRole("tree", { name: /collection/i });
    within(tree).getAllByRole("treeitem")[0].focus();

    await user.keyboard(EXPAND);

    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(40));
    const persisted = await store.load();
    expect(persisted.layouts.workspace!.sidebar).toBe(40);
  });

  // AC-004, TC-006 — boundary: from 14% a full -5% step would reach 9% but is
  // clamped to the 12% min. Landing exactly on 12 proves fire + clamp (RED).
  it("should clamp the sidebar at its 12% min if panel-shrink fires near the min", async () => {
    const user = userEvent.setup();
    const { store } = renderShell({
      layouts: {
        workspace: { sidebar: 14, content: 86 },
        main: { content: 75, console: 25 },
      },
    });
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(14));

    const tree = screen.getByRole("tree", { name: /collection/i });
    within(tree).getAllByRole("treeitem")[0].focus();

    await user.keyboard(SHRINK);

    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(12));
    const persisted = await store.load();
    expect(persisted.layouts.workspace!.sidebar).toBe(12);
  });
});

describe("panel resize actions - console focus", () => {
  // AC-003, TC-004 — behavior
  it("should grow the console panel by 5% if panel-expand fires with focus in the console", async () => {
    const user = userEvent.setup();
    const { store } = renderShell();
    const consoleRegion = await screen.findByRole("region", {
      name: /console/i,
    });
    await waitFor(() => expect(flexGrowOf("console")).toBe(25));

    consoleRegion.focus();

    await user.keyboard(EXPAND);

    await waitFor(() => expect(flexGrowOf("console")).toBe(30));
    const persisted = await store.load();
    expect(persisted.layouts.main!.console).toBe(30);
  });

  // AC-003 — behavior: shrink is the inverse of expand for the console.
  it("should shrink the console panel by 5% if panel-shrink fires with focus in the console", async () => {
    const user = userEvent.setup();
    const { store } = renderShell();
    const consoleRegion = await screen.findByRole("region", {
      name: /console/i,
    });
    await waitFor(() => expect(flexGrowOf("console")).toBe(25));

    consoleRegion.focus();

    await user.keyboard(SHRINK);

    await waitFor(() => expect(flexGrowOf("console")).toBe(20));
    const persisted = await store.load();
    expect(persisted.layouts.main!.console).toBe(20);
  });
});

describe("panel resize actions - no-op targets", () => {
  // AC-005, TC-007 — side-effect-contract: focus in the content/request editor
  // has no resizable panel target, so no layout is persisted and no size shifts.
  it("should not resize or persist if panel-expand/shrink fire with focus in the content region", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderShell();
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(20));

    screen.getByTestId("content-region").focus();
    const savesBefore = saveSpy.mock.calls.length;

    await user.keyboard(EXPAND);
    await user.keyboard(SHRINK);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveSpy.mock.calls.length).toBe(savesBefore);
    expect(flexGrowOf("sidebar")).toBe(20);
    expect(flexGrowOf("console")).toBe(25);
  });

  // AC-005, TC-008 — side-effect-contract: nothing focused (body) is a no-op.
  it("should not resize or persist if panel-expand fires while nothing is focused", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderShell();
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(20));

    (document.activeElement as HTMLElement | null)?.blur();
    document.body.focus();
    const savesBefore = saveSpy.mock.calls.length;

    await user.keyboard(EXPAND);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveSpy.mock.calls.length).toBe(savesBefore);
    expect(flexGrowOf("sidebar")).toBe(20);
  });

  // AC-007, TC-010 — side-effect-contract: a hidden console cannot be a focus
  // target, so panel-expand is a no-op while it is hidden.
  it("should not persist if panel-expand fires while the console is hidden", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderShell({
      consoleHidden: true,
      layouts: {
        workspace: { sidebar: 20, content: 80 },
        main: { content: 75, console: 25 },
      },
    });
    // Sidebar tree is present; the console region is not rendered.
    await screen.findByRole("tree", { name: /collection/i });
    expect(screen.queryByRole("region", { name: /console/i })).toBeNull();
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(20));

    // Focus the content region: its nearest panel is `content`, not a target.
    screen.getByTestId("content-region").focus();
    const savesBefore = saveSpy.mock.calls.length;

    await user.keyboard(EXPAND);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveSpy.mock.calls.length).toBe(savesBefore);
    expect(flexGrowOf("sidebar")).toBe(20);
  });
});

describe("panel resize actions - command palette", () => {
  // AC-006, TC-009 — behavior: both actions are listed in the palette.
  it("should list Expand panel and Shrink panel in the command palette", async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("Expand panel")).toBeInTheDocument();
    expect(within(dialog).getByText("Shrink panel")).toBeInTheDocument();
  });

  // AC-006 — behavior: running Expand panel from the palette resizes the panel
  // that was focused when the palette opened (focus is trapped in the modal at
  // run time, so the handler must fall back to the pre-palette target).
  it("should resize the panel focused when the palette opened if run from the palette", async () => {
    const user = userEvent.setup();
    const { store } = renderShell();
    await screen.findByRole("region", { name: /console/i });
    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(20));

    const tree = screen.getByRole("tree", { name: /collection/i });
    within(tree).getAllByRole("treeitem")[0].focus();

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Expand panel"));

    await waitFor(() => expect(flexGrowOf("sidebar")).toBe(25));
    const persisted = await store.load();
    expect(persisted.layouts.workspace!.sidebar).toBe(25);
  });
});
