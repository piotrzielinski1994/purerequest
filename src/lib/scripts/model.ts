export const SCRIPT_TIMEOUT_MS = 5000;

export type ScriptStage = "pre" | "post";

export type ScriptOutcome = { ok: true } | { ok: false; error: string };

// Host-side script API. `req` is present only in a pre-request script, `res`
// only in a post-response script; `requi` + `console` exist in both. The real
// QuickJS adapter marshals these callbacks into sandbox globals; the fake runner
// passes this object straight to an injected impl.
export type ScriptApi = {
  requi: {
    getVar: (name: string) => string | undefined;
    setVar: (name: string, value: string) => void;
    getProcessEnv: (name: string) => string | undefined;
    getEnvName: () => string | null;
  };
  req?: {
    getUrl: () => string;
    setUrl: (value: string) => void;
    getMethod: () => string;
    setMethod: (value: string) => void;
    getHeader: (name: string) => string | undefined;
    setHeader: (name: string, value: string) => void;
    getHeaders: () => Record<string, string>;
    getBody: () => string;
    setBody: (value: string) => void;
  };
  res?: {
    getStatus: () => number;
    getBody: () => string;
    getJson: () => unknown;
    getHeader: (name: string) => string | undefined;
    getHeaders: () => Record<string, string>;
    getResponseTime: () => number;
  };
  console: {
    log: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    clear: () => void;
  };
};

export type ScriptRunner = {
  run: (
    code: string,
    api: ScriptApi,
    opts?: { timeoutMs?: number },
  ) => Promise<ScriptOutcome>;
};
