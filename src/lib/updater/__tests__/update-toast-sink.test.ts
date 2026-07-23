import { showUpdateToast, type UpdateInfo } from "@pziel/pureui";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSonnerUpdateToastSink } from "@/lib/updater/update-toast-sink";

// AC-009 parity: purerequest wires the hoisted pureui updater flow to sonner via
// createSonnerUpdateToastSink. sonner is the observable boundary, so asserting
// on the mocked toast calls is the side-effect contract. The flow itself
// (present -> download -> installing -> relaunch, install before relaunch,
// error on failure) is owned + tested by pureui; here we prove the SONNER
// SEMANTICS the app must keep: a stable id, duration Infinity, closeButton, an
// Installing… message, and an error toast on a thrown download.
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const mockToast = vi.mocked(toast);

function makeUpdate(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    version: "0.2.0",
    downloadAndInstall: vi.fn(async () => {}),
    relaunch: vi.fn(async () => {}),
    ...overrides,
  };
}

type ToastOptions = {
  id?: string | number;
  duration?: number;
  closeButton?: boolean;
  action?: { label: string; onClick: () => void };
};

function firstToastOptions(): ToastOptions {
  return (mockToast.mock.calls[0]?.[1] ?? {}) as ToastOptions;
}

describe("createSonnerUpdateToastSink parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // side-effect-contract: the presented toast carries the version, a stable id,
  // duration Infinity, a closeButton, and an "Update now" action.
  it("should present a persistent closeButton toast with a stable id and the version", () => {
    showUpdateToast(
      createSonnerUpdateToastSink(),
      makeUpdate({ version: "0.2.0" }),
    );

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(String(mockToast.mock.calls[0][0])).toContain("0.2.0");
    const opts = firstToastOptions();
    expect(opts.duration).toBe(Infinity);
    expect(opts.closeButton).toBe(true);
    expect(opts.id).toBeDefined();
    expect(opts.action?.label).toBe("Update now");
    expect(typeof opts.action?.onClick).toBe("function");
  });

  // side-effect-contract: every step reuses the SAME sonner id (updates in place).
  it("should keep every toast update on one stable id", async () => {
    const downloadAndInstall = vi.fn(
      async (onProgress: (pct: number) => void) => {
        onProgress(42);
      },
    );
    showUpdateToast(
      createSonnerUpdateToastSink(),
      makeUpdate({ downloadAndInstall }),
    );

    await firstToastOptions().action?.onClick();
    await Promise.resolve();
    await Promise.resolve();

    const id = firstToastOptions().id;
    const ids = mockToast.mock.calls.map((c) => (c[1] as ToastOptions)?.id);
    expect(ids.every((i) => i === id)).toBe(true);
    const messages = mockToast.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => /downloading… 42%/i.test(m))).toBe(true);
    expect(messages.some((m) => /installing…/i.test(m))).toBe(true);
  });

  // side-effect-contract: a thrown download surfaces a sonner error toast.
  it("should show an error toast if the update flow throws", async () => {
    const downloadAndInstall = vi.fn(async () => {
      throw new Error("network down");
    });
    showUpdateToast(
      createSonnerUpdateToastSink(),
      makeUpdate({ downloadAndInstall }),
    );

    await firstToastOptions().action?.onClick();
    await Promise.resolve();
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
