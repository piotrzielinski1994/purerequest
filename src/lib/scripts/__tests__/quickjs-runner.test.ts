import { describe, expect, it, vi } from "vitest";
import type { ScriptApi } from "@/lib/scripts/model";
// REAL adapter under test - imports quickjs-emscripten (embedded async WASM).
// Imported before the module exists so RED is honest. If the WASM module
// genuinely cannot initialize under vitest/jsdom these tests will error on
// run rather than hang; that is an acceptable RED signal (see plan Risks). We
// do NOT skip them preemptively.
import { createQuickJsScriptRunner } from "@/lib/scripts/quickjs-runner";

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

describe("createQuickJsScriptRunner", () => {
  // TC-001 / AC-008 - side-effect-contract: a sync script reaches the host setVar
  // through the sandbox and the run reports success.
  it("should call the host setVar and return ok:true for a sync script", async () => {
    const setVar = vi.fn<NonNullable<ScriptApi["purerequest"]>["setVar"]>();
    const api = makeApi({
      purerequest: {
        getVar: () => undefined,
        setVar,
        getProcessEnv: () => undefined,
        getEnvName: () => null,
      },
    });
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run("purerequest.setVar('a','1')", api);

    expect(setVar).toHaveBeenCalledWith("a", "1");
    expect(outcome).toEqual({ ok: true });
  });

  // TC-001 / AC-009 - behavior: async/await is supported; the host setVar gets
  // the value computed after the awaited microtask.
  it("should support async/await and call setVar with the resolved value", async () => {
    const setVar = vi.fn<NonNullable<ScriptApi["purerequest"]>["setVar"]>();
    const api = makeApi({
      purerequest: {
        getVar: () => undefined,
        setVar,
        getProcessEnv: () => undefined,
        getEnvName: () => null,
      },
    });
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run(
      "await Promise.resolve(); purerequest.setVar('a', String(1 + 1))",
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

  // Bruno-compat - side-effect-contract: a pasted Bruno script's `bru.setVar`
  // reaches the host setVar (aliased onto purerequest), so imported Bruno collections
  // run without a `ReferenceError: 'bru' is not defined`.
  it("should alias bru.setVar onto the host setVar", async () => {
    const setVar = vi.fn<NonNullable<ScriptApi["purerequest"]>["setVar"]>();
    const api = makeApi({
      purerequest: {
        getVar: () => undefined,
        setVar,
        getProcessEnv: () => undefined,
        getEnvName: () => null,
      },
    });
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run("bru.setVar('a', '1')", api);

    expect(setVar).toHaveBeenCalledWith("a", "1");
    expect(outcome).toEqual({ ok: true });
  });

  // Bruno-compat - behavior: bru.getVar / bru.getEnvVar / bru.getCollectionVar
  // all read through the host getVar (purerequest has one variable space).
  it("should alias bru read accessors onto the host getVar", async () => {
    const getVar = vi.fn<NonNullable<ScriptApi["purerequest"]>["getVar"]>(
      (name) => `val-${name}`,
    );
    const setVar = vi.fn<NonNullable<ScriptApi["purerequest"]>["setVar"]>();
    const api = makeApi({
      purerequest: {
        getVar,
        setVar,
        getProcessEnv: () => undefined,
        getEnvName: () => null,
      },
    });
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run(
      "bru.setVar('out', bru.getCollectionVar('CULTURE'))",
      api,
    );

    expect(getVar).toHaveBeenCalledWith("CULTURE");
    expect(setVar).toHaveBeenCalledWith("out", "val-CULTURE");
    expect(outcome).toEqual({ ok: true });
  });

  // Bruno-compat - behavior: bru.cwd() is a defined no-op ("") so a script that
  // calls it doesn't crash with a ReferenceError before its real work.
  it("should expose bru.cwd as a defined function", async () => {
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run("bru.cwd();", makeApi());

    expect(outcome).toEqual({ ok: true });
  });

  // AC-008 - behavior: neither fetch nor process leak either.
  it("should not expose fetch or process in the sandbox", async () => {
    const runner = createQuickJsScriptRunner();

    const fetchOutcome = await runner.run("fetch('x')", makeApi());
    const processOutcome = await runner.run("process.env", makeApi());

    expect(fetchOutcome.ok).toBe(false);
    expect(processOutcome.ok).toBe(false);
  });

  // Postman-compat, AC-012 / TC-010 - side-effect-contract: pm.variables get/set
  // read and write through the host getVar/setVar (purerequest has one variable space),
  // so imported Postman scripts run without a `ReferenceError: pm is not defined`.
  it("should alias pm.variables get and set onto the host getVar and setVar", async () => {
    const getVar = vi.fn<NonNullable<ScriptApi["purerequest"]>["getVar"]>(
      (name) => `val-${name}`,
    );
    const setVar = vi.fn<NonNullable<ScriptApi["purerequest"]>["setVar"]>();
    const api = makeApi({
      purerequest: {
        getVar,
        setVar,
        getProcessEnv: () => undefined,
        getEnvName: () => null,
      },
    });
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run(
      "pm.variables.set('a', pm.variables.get('b'))",
      api,
    );

    expect(getVar).toHaveBeenCalledWith("b");
    expect(setVar).toHaveBeenCalledWith("a", "val-b");
    expect(outcome).toEqual({ ok: true });
  });

  // Postman-compat, AC-012 - behavior: pm.environment / pm.collectionVariables /
  // pm.globals set all reach the host setVar (one variable space).
  it("should alias pm.environment, pm.collectionVariables and pm.globals set onto the host setVar", async () => {
    const setVar = vi.fn<NonNullable<ScriptApi["purerequest"]>["setVar"]>();
    const api = makeApi({
      purerequest: {
        getVar: () => undefined,
        setVar,
        getProcessEnv: () => undefined,
        getEnvName: () => null,
      },
    });
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run(
      [
        "pm.environment.set('e', '1');",
        "pm.collectionVariables.set('c', '2');",
        "pm.globals.set('g', '3');",
      ].join("\n"),
      api,
    );

    expect(setVar).toHaveBeenCalledWith("e", "1");
    expect(setVar).toHaveBeenCalledWith("c", "2");
    expect(setVar).toHaveBeenCalledWith("g", "3");
    expect(outcome).toEqual({ ok: true });
  });

  // Postman-compat, AC-012 / TC-010 - behavior: in the post stage a pm.test whose
  // fn reads pm.response.json() runs without throwing (pm.response maps onto res).
  it("should run a post-stage pm.test reading pm.response.json without throwing", async () => {
    const api = makeApi({
      res: {
        getStatus: () => 200,
        getBody: () => '{"token":"abc"}',
        getJson: () => ({ token: "abc" }),
        getHeader: () => undefined,
        getHeaders: () => ({}),
        getResponseTime: () => 12,
      },
    });
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run(
      "pm.test('reads json', () => { pm.response.json(); });",
      api,
    );

    expect(outcome).toEqual({ ok: true });
  });

  // Postman-compat, AC-012 / TC-010 - behavior: a pm.test whose fn throws (a
  // failing assertion) does NOT fail the script; the run still reports ok:true.
  it("should not fail the script if a pm.test fn throws", async () => {
    const runner = createQuickJsScriptRunner();

    const outcome = await runner.run(
      "pm.test('always fails', () => { throw new Error('boom'); });",
      makeApi(),
    );

    expect(outcome.ok).toBe(true);
  });
});
