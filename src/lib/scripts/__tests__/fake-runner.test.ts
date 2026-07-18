import { describe, it, expect, vi } from "vitest";

// Imported before the module exists so RED is honest (module-not-found, not a
// typo). The fake runner is the seam the send-loop tests drive: it runs an
// injected impl directly against the host api (no WASM).
import { createFakeScriptRunner } from "@/lib/scripts/fake-runner";
import type { ScriptApi } from "@/lib/scripts/model";

function makeApi(overrides: Partial<ScriptApi> = {}): ScriptApi {
  return {
    purerequest: {
      getVar: () => undefined,
      setVar: () => {},
      getProcessEnv: () => undefined,
      getEnvName: () => null,
    },
    console: {
      log: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      clear: () => {},
    },
    ...overrides,
  };
}

describe("createFakeScriptRunner", () => {
  // side-effect-contract: the injected impl is invoked against the host api.
  it("should invoke the impl against the host api", async () => {
    const setVar = vi.fn<NonNullable<ScriptApi["purerequest"]>["setVar"]>();
    const api = makeApi({
      purerequest: {
        getVar: () => undefined,
        setVar,
        getProcessEnv: () => undefined,
        getEnvName: () => null,
      },
    });
    const runner = createFakeScriptRunner((a) => {
      a.purerequest.setVar("token", "abc");
    });

    const outcome = await runner.run("", api);

    expect(setVar).toHaveBeenCalledWith("token", "abc");
    expect(outcome).toEqual({ ok: true });
  });

  // behavior: a thrown error is mapped to the ADT failure (no throw out).
  it("should return ok:false if the impl throws", async () => {
    const runner = createFakeScriptRunner(() => {
      throw new Error("boom");
    });

    const outcome = await runner.run("", makeApi());

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain("boom");
    }
  });

  // behavior: the default (no impl) is a no-op success.
  it("should return ok:true if no impl is provided", async () => {
    const runner = createFakeScriptRunner();

    const outcome = await runner.run("", makeApi());

    expect(outcome).toEqual({ ok: true });
  });

  // behavior: an async impl is awaited before the outcome resolves.
  it("should await an async impl before resolving", async () => {
    const order: string[] = [];
    const runner = createFakeScriptRunner(async (a) => {
      await Promise.resolve();
      a.purerequest.setVar("a", "done");
      order.push("impl");
    });
    const setVar = vi.fn<NonNullable<ScriptApi["purerequest"]>["setVar"]>();
    const api = makeApi({
      purerequest: {
        getVar: () => undefined,
        setVar,
        getProcessEnv: () => undefined,
        getEnvName: () => null,
      },
    });

    const outcome = await runner.run("", api);

    expect(setVar).toHaveBeenCalledWith("a", "done");
    expect(order).toEqual(["impl"]);
    expect(outcome).toEqual({ ok: true });
  });
});
