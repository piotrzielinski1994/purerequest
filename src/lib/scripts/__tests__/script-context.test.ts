import { describe, expect, it } from "vitest";
import type { HttpResponse } from "@/lib/http/model";
import {
  applyPreToEffective,
  buildScriptApi,
  type ReqDraft,
  type VarWrite,
} from "@/lib/scripts/script-context";
import { authOf } from "@/lib/workspace/model";
import type { EffectiveConfig } from "@/lib/workspace/resolve";

const PROV = { scopeId: "s", scopeName: "Scope" };

function effective(overrides: Partial<EffectiveConfig> = {}): EffectiveConfig {
  return {
    variables: {},
    headers: {},
    auth: { value: authOf({ active: "none" }), from: PROV },
    scripts: {
      pre: { value: "", from: PROV },
      post: { value: "", from: PROV },
    },
    timeoutMs: { value: 30000, from: PROV },
    ...overrides,
  };
}

function preCtx(eff: EffectiveConfig, draft: ReqDraft) {
  return {
    stage: "pre" as const,
    effective: eff,
    processEnv: {} as Record<string, string>,
    envName: null,
    runtimeVars: new Map<string, string>(),
    varWrites: [] as VarWrite[],
    log: () => {},
    clear: () => {},
    reqDraft: draft,
  };
}

const draftOf = (): ReqDraft => ({
  method: "GET",
  url: "https://x",
  body: "",
  headerOverrides: {},
});

describe("buildScriptApi - purerequest", () => {
  it("should read a runtime var before the resolved value if both are set", () => {
    const eff = effective({
      variables: { token: { value: "resolved", from: PROV } },
    });
    const ctx = preCtx(eff, draftOf());
    ctx.runtimeVars.set("token", "runtime");
    const api = buildScriptApi(ctx);

    expect(api.purerequest.getVar("token")).toBe("runtime");
  });

  it("should fall back to the resolved value if no runtime var is set", () => {
    const eff = effective({
      variables: { token: { value: "resolved", from: PROV } },
    });
    const api = buildScriptApi(preCtx(eff, draftOf()));

    expect(api.purerequest.getVar("token")).toBe("resolved");
  });

  // A var whose value is a {{...}} token is interpolated before it reaches a
  // script (Bruno returns resolved values); otherwise scripts that string-op the
  // value (split/toLowerCase) crash on the raw token.
  it("should interpolate a {{process.env.X}} var value via processEnv", () => {
    const eff = effective({
      variables: {
        CULTURE: { value: "{{process.env.CULTURE}}", from: PROV },
      },
    });
    const ctx = {
      ...preCtx(eff, draftOf()),
      processEnv: { CULTURE: "en-CA" },
    };
    const api = buildScriptApi(ctx);

    expect(api.purerequest.getVar("CULTURE")).toBe("en-CA");
  });

  it("should interpolate a var that references another var", () => {
    const eff = effective({
      variables: {
        base: { value: "https://api", from: PROV },
        url: { value: "{{base}}/v1", from: PROV },
      },
    });
    const api = buildScriptApi(preCtx(eff, draftOf()));

    expect(api.purerequest.getVar("url")).toBe("https://api/v1");
  });

  it("should record a setVar to both the runtime map and the var-writes list", () => {
    const ctx = preCtx(effective(), draftOf());
    const api = buildScriptApi(ctx);

    api.purerequest.setVar("a", "1");

    expect(ctx.runtimeVars.get("a")).toBe("1");
    expect(ctx.varWrites).toEqual([{ name: "a", value: "1" }]);
  });

  it("should read processEnv via getProcessEnv and the env name via getEnvName", () => {
    const api = buildScriptApi({
      ...preCtx(effective(), draftOf()),
      processEnv: { KEY: "secret" },
      envName: "local",
    });

    expect(api.purerequest.getProcessEnv("KEY")).toBe("secret");
    expect(api.purerequest.getEnvName()).toBe("local");
  });
});

describe("buildScriptApi - req", () => {
  it("should read a header from the resolved config if no override is set yet", () => {
    const eff = effective({
      headers: { "X-Token": { value: "abc", from: PROV } },
    });
    const api = buildScriptApi(preCtx(eff, draftOf()));

    expect(api.req?.getHeader("x-token")).toBe("abc");
  });

  it("should overwrite an existing header case-insensitively on setHeader", () => {
    const draft = draftOf();
    const api = buildScriptApi(preCtx(effective(), draft));

    api.req?.setHeader("X-A", "1");
    api.req?.setHeader("x-a", "2");

    expect(api.req?.getHeaders()).toEqual({ "x-a": "2" });
  });

  it("should return the url with {{var}} tokens interpolated", () => {
    const eff = effective({
      variables: {
        SOME_ENV: { value: "env211", from: PROV },
        var1: { value: "var21", from: PROV },
      },
    });
    const draft = draftOf();
    draft.url = "https://x/get?env={{SOME_ENV}}&v={{var1}}";
    const api = buildScriptApi(preCtx(eff, draft));

    expect(api.req?.getUrl()).toBe("https://x/get?env=env211&v=var21");
  });

  it("should interpolate the url using a runtime var set earlier in the run", () => {
    const draft = draftOf();
    draft.url = "https://x/{{tok}}";
    const ctx = preCtx(effective(), draft);
    const api = buildScriptApi(ctx);

    api.purerequest.setVar("tok", "abc");

    expect(api.req?.getUrl()).toBe("https://x/abc");
  });

  it("should expose url/method/body mutations on the draft", () => {
    const draft = draftOf();
    const api = buildScriptApi(preCtx(effective(), draft));

    api.req?.setUrl("https://y");
    api.req?.setMethod("POST");
    api.req?.setBody("payload");

    expect(draft).toMatchObject({
      url: "https://y",
      method: "POST",
      body: "payload",
    });
  });
});

describe("buildScriptApi - res", () => {
  const response: HttpResponse = {
    status: 201,
    timeMs: 12,
    sizeBytes: 9,
    body: '{"id":7}',
    headers: [{ key: "Content-Type", value: "application/json" }],
  };

  function postApi(body: string) {
    return buildScriptApi({
      stage: "post",
      effective: effective(),
      processEnv: {},
      envName: null,
      runtimeVars: new Map(),
      varWrites: [],
      log: () => {},
      clear: () => {},
      response: { ...response, body },
    });
  }

  it("should parse a JSON body via getJson", () => {
    expect(postApi('{"id":7}').res?.getJson()).toEqual({ id: 7 });
  });

  it("should return undefined from getJson for a non-JSON body", () => {
    expect(postApi("not json").res?.getJson()).toBeUndefined();
  });

  it("should read status/responseTime and a header case-insensitively", () => {
    const api = postApi('{"id":7}');

    expect(api.res?.getStatus()).toBe(201);
    expect(api.res?.getResponseTime()).toBe(12);
    expect(api.res?.getHeader("content-type")).toBe("application/json");
  });

  it("should not expose req in a post-stage api", () => {
    expect(postApi("{}").req).toBeUndefined();
  });
});

describe("buildScriptApi - console", () => {
  it("should prefix a console line with the stage and join args with a space", () => {
    const lines: string[] = [];
    const api = buildScriptApi({
      ...preCtx(effective(), draftOf()),
      log: (line) => lines.push(line),
    });

    api.console.log("hello", { n: 1 }, 42);

    // objects pretty-print (2-space) so the Console can syntax-color them.
    expect(lines).toEqual(['[pre] hello {\n  "n": 1\n} 42']);
  });

  it("should invoke the clear callback on console.clear", () => {
    let cleared = 0;
    const api = buildScriptApi({
      ...preCtx(effective(), draftOf()),
      clear: () => {
        cleared += 1;
      },
    });

    api.console.clear();

    expect(cleared).toBe(1);
  });
});

describe("applyPreToEffective", () => {
  it("should inject runtime vars over the resolved variables", () => {
    const eff = effective({
      variables: { a: { value: "old", from: PROV } },
    });
    const runtime = new Map([["a", "new"]]);

    const result = applyPreToEffective(eff, runtime, {});

    expect(result.variables.a.value).toBe("new");
  });

  it("should merge header overrides case-insensitively, replacing a resolved header", () => {
    const eff = effective({
      headers: { "X-A": { value: "old", from: PROV } },
    });

    const result = applyPreToEffective(eff, new Map(), { "x-a": "new" });

    const keys = Object.keys(result.headers).filter(
      (k) => k.toLowerCase() === "x-a",
    );
    expect(keys).toEqual(["x-a"]);
    expect(result.headers["x-a"].value).toBe("new");
  });

  it("should not mutate the input effective config", () => {
    const eff = effective({
      variables: { a: { value: "old", from: PROV } },
    });

    applyPreToEffective(eff, new Map([["a", "new"]]), { "x-b": "1" });

    expect(eff.variables.a.value).toBe("old");
    expect(eff.headers["x-b"]).toBeUndefined();
  });
});
