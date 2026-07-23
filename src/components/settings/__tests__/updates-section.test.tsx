import type { UpdateController, UpdateInfo } from "@pziel/pureui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatesSection } from "@/components/settings/updates-section";

// sonner is the observable boundary; the UpdateController + version source are
// injected as props (built per-env in __root.tsx, not in SettingsContext). The
// toast is asserted on the mocked sonner call, not on rendered DOM.
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const mockToast = vi.mocked(toast);

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
    <UpdatesSection controller={controller} getVersion={getVersion} />,
  );
}

function toastMessages(): string[] {
  return [
    ...mockToast.mock.calls.map((c) => String(c[0])),
    ...(mockToast.error as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => String(c[0]),
    ),
  ];
}

describe("UpdatesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // TC-011 behavior: renders the current version string from the injected source
  it("should render the current version from the injected version source", async () => {
    renderSection({ check: () => Promise.resolve(null) }, () =>
      Promise.resolve("1.2.3"),
    );

    expect(await screen.findByText(/1\.2\.3/)).toBeInTheDocument();
  });

  // TC-007 side-effect-contract: check reports no update -> "latest" toast + button idle again
  it("should show an up-to-date toast and re-enable the button if no update is found", async () => {
    const user = userEvent.setup();
    renderSection({ check: () => Promise.resolve(null) });

    const button = await screen.findByRole("button", {
      name: /check for updates/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(
        toastMessages().some((m) => /latest version|up to date/i.test(m)),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /check for updates/i }),
      ).toBeEnabled();
    });
  });

  // TC-008 side-effect-contract: update found -> update toast (message carries version)
  it("should show the update toast if an update is found", async () => {
    const user = userEvent.setup();
    renderSection({
      check: () => Promise.resolve(fakeUpdateInfo({ version: "v0.2.0" })),
    });

    await user.click(
      await screen.findByRole("button", { name: /check for updates/i }),
    );

    await waitFor(() => {
      expect(toastMessages().some((m) => /v0\.2\.0/.test(m))).toBe(true);
    });
  });

  // TC-009 side-effect-contract: check rejects -> "check failed" toast + button not stuck
  it("should show a check-failed toast and re-enable the button if the check rejects", async () => {
    const user = userEvent.setup();
    renderSection({
      check: () => Promise.reject(new Error("network down")),
    });

    await user.click(
      await screen.findByRole("button", { name: /check for updates/i }),
    );

    await waitFor(() => {
      expect(toastMessages().some((m) => /failed/i.test(m))).toBe(true);
    });
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
