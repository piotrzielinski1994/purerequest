import { describe, expect, it, vi } from "vitest";

import {
  createNoopUpdateController,
  createUpdateController,
  getAppVersion,
} from "@/lib/updater/update-controller";

// ASSUMED SEAM: mirroring window-controller.ts (which injects a getter with a
// default), createUpdateController takes an injected deps object
// `{ check, relaunch }` so a fake plugin can stand in without a Tauri host.
// `check` is the @tauri-apps/plugin-updater check(); `relaunch` is
// @tauri-apps/plugin-process relaunch(). If the real impl names the seam
// differently, only this fake wiring needs to change - the behaviour asserted
// (version surfaced, percent from contentLength/chunkLength, relaunch callable)
// is the contract.

type DownloadEvent =
  | { event: "Started"; data: { contentLength: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

type FakePluginUpdate = {
  version: string;
  downloadAndInstall: (
    onEvent: (event: DownloadEvent) => void,
  ) => Promise<void>;
};

describe("createNoopUpdateController", () => {
  // behavior: the browser/test controller reports no update available
  it("should resolve check to null", async () => {
    const controller = createNoopUpdateController();

    expect(await controller.check()).toBeNull();
  });
});

describe("createUpdateController over a fake plugin", () => {
  function fakePluginUpdate(): FakePluginUpdate {
    return {
      version: "v0.2.0",
      downloadAndInstall: (onEvent) => {
        onEvent({ event: "Started", data: { contentLength: 200 } });
        onEvent({ event: "Progress", data: { chunkLength: 50 } });
        onEvent({ event: "Progress", data: { chunkLength: 150 } });
        onEvent({ event: "Finished" });
        return Promise.resolve();
      },
    };
  }

  // behavior: the native controller surfaces the plugin update's version
  it("should surface the version from the plugin update", async () => {
    const controller = createUpdateController({
      check: () => Promise.resolve(fakePluginUpdate()),
      relaunch: () => Promise.resolve(),
    });

    const info = await controller.check();

    expect(info).not.toBeNull();
    expect(info!.version).toBe("v0.2.0");
  });

  // behavior: check maps a null plugin result to a null UpdateInfo
  it("should resolve check to null if the plugin reports no update", async () => {
    const controller = createUpdateController({
      check: () => Promise.resolve(null),
      relaunch: () => Promise.resolve(),
    });

    expect(await controller.check()).toBeNull();
  });

  // side-effect-contract: downloadAndInstall drives the progress callback with a
  // percent computed from contentLength / accumulated chunkLength
  it("should report progress percent computed from contentLength and chunkLength", async () => {
    const controller = createUpdateController({
      check: () => Promise.resolve(fakePluginUpdate()),
      relaunch: () => Promise.resolve(),
    });
    const info = await controller.check();
    const onProgress = vi.fn();

    await info!.downloadAndInstall(onProgress);

    const reported = onProgress.mock.calls.map((call) => call[0]);
    expect(reported).toContain(25);
    expect(reported).toContain(100);
    expect(reported.at(-1)).toBe(100);
  });

  // side-effect-contract: the injected relaunch is invoked when relaunch() is called
  it("should invoke the injected relaunch when relaunch is called", async () => {
    const relaunch = vi.fn(() => Promise.resolve());
    const controller = createUpdateController({
      check: () => Promise.resolve(fakePluginUpdate()),
      relaunch,
    });
    const info = await controller.check();

    await info!.relaunch();

    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});

describe("getAppVersion", () => {
  // behavior: resolves a non-empty version string (static fallback in non-Tauri)
  it("should resolve a non-empty string", async () => {
    const version = await getAppVersion();

    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });
});
