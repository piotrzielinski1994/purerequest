import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/components/ui/toast";
import { UpdatesSection } from "@/components/settings/updates-section";
import type {
  UpdateController,
  UpdateInfo,
} from "@/lib/updater/update-controller";

// ASSUMED SEAM: sibling sections (theme/env/shortcuts) pull their deps from
// context, but the UpdateController + version source live outside SettingsContext
// (built per-env in __root.tsx). Per the plan's "prefer props" note, this test
// injects them as props: <UpdatesSection controller={..} getVersion={..} />.
// Toast still comes from the surrounding ToastProvider (same as SettingsView's
// tests). If the impl chooses an UpdaterProvider context instead, only this
// wiring changes - the observable behaviour asserted is the contract.

function fakeUpdateInfo(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    version: "v0.2.0",
    downloadAndInstall: () => Promise.resolve(),
    relaunch: () => Promise.resolve(),
    ...overrides,
  };
}

function renderSection(
  controller: UpdateController,
  getVersion: () => Promise<string> = () => Promise.resolve("0.1.0"),
) {
  return render(
    <ToastProvider>
      <UpdatesSection controller={controller} getVersion={getVersion} />
    </ToastProvider>,
  );
}

describe("UpdatesSection", () => {
  // TC-011 behavior: renders the current version string from the injected source
  it("should render the current version from the injected version source", async () => {
    renderSection(
      { check: () => Promise.resolve(null) },
      () => Promise.resolve("1.2.3"),
    );

    expect(await screen.findByText(/1\.2\.3/)).toBeInTheDocument();
  });

  // TC-007 behavior: check reports no update -> "latest" toast + button idle again
  it("should show an up-to-date toast and re-enable the button if no update is found", async () => {
    const user = userEvent.setup();
    renderSection({ check: () => Promise.resolve(null) });

    const button = await screen.findByRole("button", {
      name: /check for updates/i,
    });
    await user.click(button);

    expect(
      await screen.findByText(/latest version|up to date/i),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /check for updates/i }),
      ).toBeEnabled();
    });
  });

  // TC-008 behavior: update found -> update toast (version + Update now)
  it("should show the update toast if an update is found", async () => {
    const user = userEvent.setup();
    renderSection(
      { check: () => Promise.resolve(fakeUpdateInfo({ version: "v0.2.0" })) },
    );

    await user.click(
      await screen.findByRole("button", { name: /check for updates/i }),
    );

    expect(await screen.findByText(/v0\.2\.0/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /update now/i }),
    ).toBeInTheDocument();
  });

  // TC-009 behavior: check rejects -> "check failed" toast + button not stuck
  it("should show a check-failed toast and re-enable the button if the check rejects", async () => {
    const user = userEvent.setup();
    renderSection({
      check: () => Promise.reject(new Error("network down")),
    });

    await user.click(
      await screen.findByRole("button", { name: /check for updates/i }),
    );

    expect(await screen.findByText(/failed/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /check for updates/i }),
      ).toBeEnabled();
    });
  });

  // TC-010 side-effect-contract: in-flight guard - the button is disabled while a
  // check is pending and a second click does not start a second check
  it("should disable the button while checking and ignore a second click", async () => {
    let resolveCheck: (info: UpdateInfo | null) => void = () => {};
    const check = vi.fn(
      () =>
        new Promise<UpdateInfo | null>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const user = userEvent.setup();
    renderSection({ check });

    const button = await screen.findByRole("button", {
      name: /check for updates|checking/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /check for updates|checking/i }),
      ).toBeDisabled();
    });

    await user.click(
      screen.getByRole("button", { name: /check for updates|checking/i }),
    );

    expect(check).toHaveBeenCalledTimes(1);

    resolveCheck(null);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /check for updates/i }),
      ).toBeEnabled();
    });
  });
});
