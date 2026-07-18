import {
  newQuickJSAsyncWASMModuleFromVariant,
  type QuickJSAsyncWASMModule,
} from "quickjs-emscripten-core";
// Single-file BROWSER variant: the WASM is embedded (base64) in the JS module,
// so nothing is fetched at runtime. The default `wasmfile` variant ships a
// separate .wasm asset the Tauri webview fails to load (CompileError: module
// doesn't start with '\0asm'), so this variant is mandatory for the webview.
import releaseVariant from "@jitl/quickjs-singlefile-browser-release-asyncify";
import {
  SCRIPT_TIMEOUT_MS,
  type ScriptApi,
  type ScriptOutcome,
  type ScriptRunner,
} from "@/lib/scripts/model";

// The host bridge marshals every sandbox call as `(path, argsJson) -> jsonResult`
// over plain strings, so only strings cross the WASM boundary - no proxies. The
// prelude (run inside the sandbox, global scope) rebuilds `purerequest`/`req`/`res`/
// `console` as objects whose methods call the bridge; user code then runs in
// MODULE scope so top-level `await` works natively (the isolation shape Bruno
// uses). Module evaluation yields a promise for the module's completion, drained
// with `executePendingJobs` and awaited via `resolvePromise`.
const PRELUDE = `
const __call = (path, ...args) =>
  JSON.parse(globalThis.__bridge(path, JSON.stringify(args)));
globalThis.purerequest = {
  getVar: (n) => __call("purerequest.getVar", n),
  setVar: (n, v) => __call("purerequest.setVar", n, v),
  getProcessEnv: (n) => __call("purerequest.getProcessEnv", n),
  getEnvName: () => __call("purerequest.getEnvName"),
};
// Bruno's script API is \`bru\`. purerequest has one variable space + no filesystem, so
// the reader accessors all map to getVar and fs-only methods (cwd) are no-ops -
// enough for pasted/imported Bruno scripts to run instead of ReferenceError-ing.
globalThis.bru = {
  getVar: (n) => __call("purerequest.getVar", n),
  setVar: (n, v) => __call("purerequest.setVar", n, v),
  getEnvVar: (n) => __call("purerequest.getVar", n),
  getCollectionVar: (n) => __call("purerequest.getVar", n),
  getFolderVar: (n) => __call("purerequest.getVar", n),
  getRequestVar: (n) => __call("purerequest.getVar", n),
  getProcessEnv: (n) => __call("purerequest.getProcessEnv", n),
  getEnvName: () => __call("purerequest.getEnvName"),
  cwd: () => "",
};
// Postman's script API is \`pm\`. Like \`bru\`, alias the reachable surface onto the
// host: the four variable stores collapse to purerequest's single var space (get/set ->
// purerequest.getVar/setVar), pm.response maps onto res.* (post stage only), and pm.test
// runs its fn swallowing a thrown assertion (purerequest doesn't report pass/fail), so
// imported Postman scripts run instead of \`ReferenceError: pm is not defined\`.
const __pmStore = {
  get: (n) => __call("purerequest.getVar", n),
  set: (n, v) => __call("purerequest.setVar", n, v),
};
globalThis.pm = {
  variables: __pmStore,
  environment: __pmStore,
  collectionVariables: __pmStore,
  globals: __pmStore,
  test: (name, fn) => {
    try {
      if (typeof fn === "function") {
        fn();
      }
    } catch (e) {
      void e;
    }
  },
};
if (globalThis.__hasRes) {
  globalThis.pm.response = {
    get code() {
      return __call("res.getStatus");
    },
    get responseTime() {
      return __call("res.getResponseTime");
    },
    json: () => __call("res.getJson"),
    text: () => __call("res.getBody"),
    headers: { get: (n) => __call("res.getHeader", n) },
  };
}
globalThis.console = {
  log: (...a) => __call("console.log", ...a),
  info: (...a) => __call("console.info", ...a),
  warn: (...a) => __call("console.warn", ...a),
  error: (...a) => __call("console.error", ...a),
  clear: () => __call("console.clear"),
};
if (globalThis.__hasReq) {
  globalThis.req = {
    getUrl: () => __call("req.getUrl"),
    setUrl: (v) => __call("req.setUrl", v),
    getMethod: () => __call("req.getMethod"),
    setMethod: (v) => __call("req.setMethod", v),
    getHeader: (n) => __call("req.getHeader", n),
    setHeader: (n, v) => __call("req.setHeader", n, v),
    getHeaders: () => __call("req.getHeaders"),
    getBody: () => __call("req.getBody"),
    setBody: (v) => __call("req.setBody", v),
  };
}
if (globalThis.__hasRes) {
  globalThis.res = {
    getStatus: () => __call("res.getStatus"),
    getBody: () => __call("res.getBody"),
    getJson: () => __call("res.getJson"),
    getHeader: (n) => __call("res.getHeader", n),
    getHeaders: () => __call("res.getHeaders"),
    getResponseTime: () => __call("res.getResponseTime"),
  };
}
`;

type Dispatch = (path: string, args: unknown[]) => unknown;

function buildDispatch(api: ScriptApi): Dispatch {
  const table: Record<string, (args: unknown[]) => unknown> = {
    "purerequest.getVar": (a) => api.purerequest.getVar(String(a[0])),
    "purerequest.setVar": (a) => api.purerequest.setVar(String(a[0]), String(a[1])),
    "purerequest.getProcessEnv": (a) => api.purerequest.getProcessEnv(String(a[0])),
    "purerequest.getEnvName": () => api.purerequest.getEnvName(),
    "console.log": (a) => api.console.log(...a),
    "console.info": (a) => api.console.info(...a),
    "console.warn": (a) => api.console.warn(...a),
    "console.error": (a) => api.console.error(...a),
    "console.clear": () => api.console.clear(),
    "req.getUrl": () => api.req?.getUrl(),
    "req.setUrl": (a) => api.req?.setUrl(String(a[0])),
    "req.getMethod": () => api.req?.getMethod(),
    "req.setMethod": (a) => api.req?.setMethod(String(a[0])),
    "req.getHeader": (a) => api.req?.getHeader(String(a[0])),
    "req.setHeader": (a) => api.req?.setHeader(String(a[0]), String(a[1])),
    "req.getHeaders": () => api.req?.getHeaders(),
    "req.getBody": () => api.req?.getBody(),
    "req.setBody": (a) => api.req?.setBody(String(a[0])),
    "res.getStatus": () => api.res?.getStatus(),
    "res.getBody": () => api.res?.getBody(),
    "res.getJson": () => api.res?.getJson(),
    "res.getHeader": (a) => api.res?.getHeader(String(a[0])),
    "res.getHeaders": () => api.res?.getHeaders(),
    "res.getResponseTime": () => api.res?.getResponseTime(),
  };
  return (path, args) => table[path]?.(args);
}

let modulePromise: Promise<QuickJSAsyncWASMModule> | null = null;
function loadModule(): Promise<QuickJSAsyncWASMModule> {
  if (!modulePromise) {
    modulePromise = newQuickJSAsyncWASMModuleFromVariant(releaseVariant);
  }
  return modulePromise;
}

export function createQuickJsScriptRunner(): ScriptRunner {
  return {
    run: async (code, api, opts): Promise<ScriptOutcome> => {
      let module: QuickJSAsyncWASMModule;
      try {
        module = await loadModule();
      } catch (error) {
        return { ok: false, error: `script runtime failed to load: ${error}` };
      }

      const context = module.newContext();
      const dispatch = buildDispatch(api);
      const deadline = Date.now() + (opts?.timeoutMs ?? SCRIPT_TIMEOUT_MS);
      context.runtime.setInterruptHandler(() => Date.now() > deadline);

      try {
        const bridge = context.newFunction("__bridge", (pathH, argsH) => {
          const path = context.getString(pathH);
          const argsJson = context.getString(argsH);
          let result: unknown;
          try {
            result = dispatch(path, JSON.parse(argsJson) as unknown[]);
          } catch {
            result = undefined;
          }
          return context.newString(result === undefined ? "null" : JSON.stringify(result));
        });
        context.setProp(context.global, "__bridge", bridge);
        bridge.dispose();

        const setFlag = (name: string, present: boolean) => {
          const handle = present ? context.true : context.false;
          context.setProp(context.global, name, handle);
        };
        setFlag("__hasReq", api.req !== undefined);
        setFlag("__hasRes", api.res !== undefined);

        const preludeResult = context.evalCode(PRELUDE);
        if (preludeResult.error) {
          preludeResult.error.dispose();
          return { ok: false, error: "script prelude failed" };
        }
        preludeResult.value.dispose();

        const evalResult = await context.evalCodeAsync(code, "script.js", {
          type: "module",
        });
        if (evalResult.error) {
          const message = context.dump(evalResult.error) as unknown;
          evalResult.error.dispose();
          return { ok: false, error: stringifyGuestError(message) };
        }

        const promiseHandle = evalResult.value;
        const settledPromise = context.resolvePromise(promiseHandle);
        context.runtime.executePendingJobs();
        const settled = await settledPromise;
        promiseHandle.dispose();
        if (settled.error) {
          const message = context.dump(settled.error) as unknown;
          settled.error.dispose();
          return { ok: false, error: stringifyGuestError(message) };
        }
        settled.value.dispose();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      } finally {
        context.dispose();
      }
    },
  };
}

function stringifyGuestError(message: unknown): string {
  if (message && typeof message === "object") {
    const record = message as Record<string, unknown>;
    if (typeof record.message === "string") {
      return record.name ? `${record.name}: ${record.message}` : record.message;
    }
  }
  return String(message);
}
