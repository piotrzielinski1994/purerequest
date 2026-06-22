import type {
  EffectiveConfig,
  Provenance,
  ResolvedValue,
} from "@/lib/workspace/resolve";
import type { HttpMethod } from "@/lib/workspace/model";
import type { HttpResponse } from "@/lib/http/model";
import type { ScriptApi, ScriptStage } from "@/lib/scripts/model";

export type ReqDraft = {
  method: HttpMethod;
  url: string;
  body: string;
  headerOverrides: Record<string, string>;
};

export type VarWrite = { name: string; value: string };

const SCRIPT_PROVENANCE: Provenance = {
  scopeId: "script",
  scopeName: "script",
};

function formatArg(arg: unknown): string {
  if (typeof arg === "string") {
    return arg;
  }
  try {
    // Pretty-print objects/arrays (2-space) so the Console can syntax-color the
    // tokens; scalars stringify to their bare form.
    return JSON.stringify(arg, null, 2) ?? String(arg);
  } catch {
    return String(arg);
  }
}

function headerKeyOf(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === lower);
}

export type ScriptContext = {
  stage: ScriptStage;
  effective: EffectiveConfig;
  processEnv: Record<string, string>;
  envName: string | null;
  runtimeVars: Map<string, string>;
  varWrites: VarWrite[];
  log: (line: string) => void;
  clear: () => void;
  reqDraft?: ReqDraft;
  response?: HttpResponse;
};

// Build the host-side script API for one stage. `req` is wired only when a
// reqDraft is present (pre), `res` only when a response is present (post).
export function buildScriptApi(ctx: ScriptContext): ScriptApi {
  // A warn/error carries its level as a marker after the stage prefix so the
  // Console can color it; log/info stay unmarked (the common, neutral case).
  const sink =
    (marker: string) =>
    (...args: unknown[]) =>
      ctx.log(`[${ctx.stage}] ${marker}${args.map(formatArg).join(" ")}`);

  const api: ScriptApi = {
    requi: {
      getVar: (name) =>
        ctx.runtimeVars.get(name) ?? ctx.effective.variables[name]?.value,
      setVar: (name, value) => {
        ctx.runtimeVars.set(name, value);
        ctx.varWrites.push({ name, value });
      },
      getProcessEnv: (name) => ctx.processEnv[name],
      getEnvName: () => ctx.envName,
    },
    console: {
      log: sink(""),
      info: sink(""),
      warn: sink("warn: "),
      error: sink("error: "),
      clear: ctx.clear,
    },
  };

  const draft = ctx.reqDraft;
  if (draft) {
    api.req = {
      getUrl: () => draft.url,
      setUrl: (value) => {
        draft.url = value;
      },
      getMethod: () => draft.method,
      setMethod: (value) => {
        draft.method = value as HttpMethod;
      },
      getHeader: (name) => {
        const key = headerKeyOf(draft.headerOverrides, name);
        if (key !== undefined) {
          return draft.headerOverrides[key];
        }
        const lower = name.toLowerCase();
        const match = Object.entries(ctx.effective.headers).find(
          ([key2]) => key2.toLowerCase() === lower,
        );
        return match?.[1].value;
      },
      setHeader: (name, value) => {
        const existing = headerKeyOf(draft.headerOverrides, name);
        if (existing !== undefined) {
          delete draft.headerOverrides[existing];
        }
        draft.headerOverrides[name] = value;
      },
      getHeaders: () => ({ ...draft.headerOverrides }),
      getBody: () => draft.body,
      setBody: (value) => {
        draft.body = value;
      },
    };
  }

  const response = ctx.response;
  if (response) {
    const headerMap = response.headers.reduce<Record<string, string>>(
      (acc, { key, value }) => ({ ...acc, [key]: value }),
      {},
    );
    api.res = {
      getStatus: () => response.status,
      getBody: () => response.body,
      getJson: () => {
        try {
          return JSON.parse(response.body);
        } catch {
          return undefined;
        }
      },
      getHeader: (name) => {
        const key = headerKeyOf(headerMap, name);
        return key !== undefined ? headerMap[key] : undefined;
      },
      getHeaders: () => ({ ...headerMap }),
      getResponseTime: () => response.timeMs,
    };
  }

  return api;
}

// Fold a pre-script's runtime vars + header overrides into the resolved config
// so buildHttpRequest interpolates/encodes them like any other resolved value.
export function applyPreToEffective(
  effective: EffectiveConfig,
  runtimeVars: Map<string, string>,
  headerOverrides: Record<string, string>,
): EffectiveConfig {
  const variables = { ...effective.variables };
  runtimeVars.forEach((value, name) => {
    variables[name] = {
      value,
      from: SCRIPT_PROVENANCE,
      origin: "variable",
    } satisfies ResolvedValue<string>;
  });

  const headers = { ...effective.headers };
  Object.entries(headerOverrides).forEach(([name, value]) => {
    const lower = name.toLowerCase();
    Object.keys(headers)
      .filter((key) => key.toLowerCase() === lower)
      .forEach((key) => delete headers[key]);
    headers[name] = { value, from: SCRIPT_PROVENANCE };
  });

  return { ...effective, variables, headers };
}
