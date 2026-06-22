import { describe, it, expect, vi } from "vitest";

// REAL adapter under test - imports quickjs-emscripten (embedded async WASM).
// Imported before the module exists so RED is honest. If the WASM module
// genuinely cannot initialize under vitest/jsdom these tests will error on
// run rather than hang; that is an acceptable RED signal (see plan Risks). We
// do NOT skip them preemptively.
import { createQuickJsScriptRunner } from "@/lib/scripts/quickjs-runner";
import type { ScriptApi } from "@/lib/scripts/model";

function makeApi(overrides: Partial<ScriptApi> = {}): ScriptApi {
  return {
    requi: {
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

describe("createQuickJsScriptRunner", () => {
  // TC-001 / AC-008 - side-effect-contract: a sync script reaches the host setVar
  // through the sandbox and the run reports success.
  it("should call the host setVar and return ok:true for a sync script", async () => {
    const setVar = vi.fn<NonNullable<ScriptApi["requi"]>["setVar"]>();
    const api = makeApi({
      requi: {
        getVar: () => undefined,
        setVar,
        getProcessEnv: () => undefined,
        getEnvName: () => null,
      },
    });
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run("requi.setVar('a','1')", api);

    expect(setVar).toHaveBeenCalledWith("a", "1");
    expect(outcome).toEqual({ ok: true });
  });

  // TC-001 / AC-009 - behavior: async/await is supported; the host setVar gets
  // the value computed after the awaited microtask.
  it("should support async/await and call setVar with the resolved value", async () => {
    const setVar = vi.fn<NonNullable<ScriptApi["requi"]>["setVar"]>();
    const api = makeApi({
      requi: {
        getVar: () => undefined,
        setVar,
        getProcessEnv: () => undefined,
        getEnvName: () => null,
      },
    });
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run(
      "await Promise.resolve(); requi.setVar('a', String(1 + 1))",
      api,
    );

    expect(setVar).toHaveBeenCalledWith("a", "2");
    expect(outcome).toEqual({ ok: true });
  });

  // behavior: console.clear is a real sandbox method (reaches the host), not a
  // missing function that throws.
  it("should call the host console.clear without throwing", async () => {
    const clear = vi.fn();
    const api = makeApi({
      console: {
        log: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        clear,
      },
    });
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run("console.clear()", api);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: true });
  });

  // TC-001 / AC-005 - behavior: a guest error (calling an undefined fn) maps to
  // the ADT failure, never throws out.
  it("should return ok:false if the script throws", async () => {
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run("nope()", makeApi());

    expect(outcome.ok).toBe(false);
  });

  // TC-001 / spec §9 - behavior: an infinite loop is killed by the interrupt
  // handler within the timeout and does not hang the test.
  it("should return ok:false for an infinite loop within the timeout", async () => {
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run("while(true){}", makeApi(), {
      timeoutMs: 50,
    });

    expect(outcome.ok).toBe(false);
  }, 10000);

  // TC-001 / AC-008 - behavior: host globals do not leak into the realm; a
  // reference to `window` is a ReferenceError -> ok:false.
  it("should not expose window in the sandbox", async () => {
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run("window.x", makeApi());

    expect(outcome.ok).toBe(false);
  });

  // AC-008 - behavior: neither fetch nor process leak either.
  it("should not expose fetch or process in the sandbox", async () => {
    const runner = createQuickJsScriptRunner();

    const fetchOutcome = await runner.run("fetch('x')", makeApi());
    const processOutcome = await runner.run("process.env", makeApi());

    expect(fetchOutcome.ok).toBe(false);
    expect(processOutcome.ok).toBe(false);
  });
});
