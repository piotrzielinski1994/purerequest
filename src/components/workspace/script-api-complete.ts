import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { ScriptStage } from "@/lib/scripts/model";

// The injected script API surface, by namespace. `req` is pre-only, `res`
// post-only; `requi`/`console` exist in both stages.
const REQUI = ["getVar", "setVar", "getProcessEnv", "getEnvName"];
const CONSOLE = ["log", "info", "warn", "error", "clear"];
const REQ = [
  "getUrl",
  "setUrl",
  "getMethod",
  "setMethod",
  "getHeader",
  "setHeader",
  "getHeaders",
  "getBody",
  "setBody",
];
const RES = [
  "getStatus",
  "getBody",
  "getJson",
  "getHeader",
  "getHeaders",
  "getResponseTime",
];

export function apiMembers(object: string, stage: ScriptStage): string[] {
  if (object === "requi") {
    return REQUI;
  }
  if (object === "console") {
    return CONSOLE;
  }
  if (object === "req") {
    return stage === "pre" ? REQ : [];
  }
  if (object === "res") {
    return stage === "post" ? RES : [];
  }
  return [];
}

const TOP_LEVEL: Completion[] = ["requi", "req", "res", "console"].map(
  (label) => ({ label, type: "namespace" }),
);

// CodeMirror completion source: after `<obj>.` suggests that namespace's
// methods (stage-aware); at a bare word suggests the top-level namespaces.
export function scriptApiCompletion(stage: ScriptStage) {
  return (context: CompletionContext): CompletionResult | null => {
    const member = context.matchBefore(/(\w+)\.(\w*)$/);
    if (member) {
      const object = member.text.slice(0, member.text.indexOf("."));
      const members = apiMembers(object, stage);
      if (members.length === 0) {
        return null;
      }
      return {
        from: member.from + object.length + 1,
        options: members.map((label) => ({ label, type: "method" })),
        validFor: /^\w*$/,
      };
    }
    const word = context.matchBefore(/\w+$/);
    if (!word || (word.from === word.to && !context.explicit)) {
      return null;
    }
    return { from: word.from, options: TOP_LEVEL, validFor: /^\w*$/ };
  };
}
