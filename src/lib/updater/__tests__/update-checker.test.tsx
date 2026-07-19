import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/components/ui/toast";
import { UpdateChecker } from "@/lib/updater/update-checker";
import type {
  UpdateController,
  UpdateInfo,
} from "@/lib/updater/update-controller";

// The startup bridge (sibling of WindowFullscreenSync): mounts inside providers,
// runs one check on mount via the injected controller, and on an available
// update shows a persistent action toast that drives download/install/relaunch.
// Renders null - all assertions go through the ToastProvider's rendered DOM.

type UpdateInfoOverrides = Partial<UpdateInfo>;

function fakeUpdateInfo(overrides: UpdateInfoOverrides = {}): UpdateInfo {
  return {
    version: "v0.2.0",
    downloadAndInstall: () => Promise.resolve(),
    relaunch: () => Promise.resolve(),
    ...overrides,
  };
}

function controllerWith(info: UpdateInfo | null): UpdateController {
  return { check: () => Promise.resolve(info) };
}

function renderChecker(controller: UpdateController) {
  return render(
    <ToastProvider>
      <UpdateChecker controller={controller} />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("UpdateChecker startup bridge", () => {
  // TC-001 behavior: an available update shows a persistent toast with the
  // version text + an "Update now" button
  it("should show an update toast with the version and an Update now button if an update is available", async () => {
    renderChecker(controllerWith(fakeUpdateInfo({ version: "v0.2.0" })));

    expect(await screen.findByText(/v0\.2\.0/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /update now/i }),
    ).toBeInTheDocument();
  });

  // TC-002 behavior: no update -> no toast
  it("should not show any toast if no update is available", async () => {
    renderChecker(controllerWith(null));

    await Promise.resolve();
    await Promise.resolve();
    expect(
      screen.queryByRole("button", { name: /update now/i }),
    ).not.toBeInTheDocument();
  });

  // TC-003 behavior: check rejects -> error swallowed, no toast, no throw
  it("should swallow a rejected check without a toast or a throw", async () => {
    const controller: UpdateController = {
      check: () => Promise.reject(new Error("network down")),
    };

    expect(() => renderChecker(controller)).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();
    expect(
      screen.queryByRole("button", { name: /update now/i }),
    ).not.toBeInTheDocument();
  });

  // TC-004 side-effect-contract: clicking Update now invokes downloadAndInstall,
  // progress drives the label, and relaunch is invoked after it resolves
  it("should download+install then relaunch when Update now is clicked", async () => {
    const relaunch = vi.fn(() => Promise.resolve());
    const downloadAndInstall = vi.fn((onProgress: (pct: number) => void) => {
      onProgress(50);
      return Promise.resolve();
    });
    const controller = controllerWith(
      fakeUpdateInfo({ downloadAndInstall, relaunch }),
    );

    const user = userEvent.setup();
    renderChecker(controller);

    const button = await screen.findByRole("button", { name: /update now/i });
    await user.click(button);

    await waitFor(() => {
      expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(/50%/)).toBeInTheDocument();
    await waitFor(() => {
      expect(relaunch).toHaveBeenCalledTimes(1);
    });
  });

  // TC-005 behavior: the available toast is persistent - it survives past the old
  // 2500ms auto-dismiss window. Fake timers are installed BEFORE mount so a
  // non-persistent impl's setTimeout would be captured and fire on advance.
  it("should keep the update toast past the 2500ms auto-dismiss", async () => {
    vi.useFakeTimers();
    renderChecker(controllerWith(fakeUpdateInfo({ version: "v0.2.0" })));

    // Flush the mount check promise (microtasks resolve under fake timers).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/v0\.2\.0/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(screen.getByText(/v0\.2\.0/)).toBeInTheDocument();
  });

  // TC-006 behavior/side-effect-contract: clicking × removes the toast and does
  // NOT invoke the install path
  it("should remove the toast and not install when dismiss is clicked", async () => {
    const downloadAndInstall = vi.fn(() => Promise.resolve());
    const controller = controllerWith(fakeUpdateInfo({ downloadAndInstall }));

    const user = userEvent.setup();
    renderChecker(controller);

    await screen.findByText(/v0\.2\.0/);
    await user.click(screen.getByRole("button", { name: /dismiss|close/i }));

    expect(screen.queryByText(/v0\.2\.0/)).not.toBeInTheDocument();
    expect(downloadAndInstall).not.toHaveBeenCalled();
  });
});
