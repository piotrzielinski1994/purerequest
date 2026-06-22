import type { ScriptApi, ScriptRunner } from "@/lib/scripts/model";

// Test/browser adapter: runs an injected impl directly against the host api (no
// WASM), so the send loop is exercised WASM-free. A thrown error maps to the ADT
// failure; the default (no impl) is a no-op success.
export function createFakeScriptRunner(
  impl?: (api: ScriptApi) => void | Promise<void>,
): ScriptRunner {
  return {
    run: async (_code, api) => {
      if (!impl) {
        return { ok: true };
      }
      try {
        await impl(api);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
  };
}
