import { Linter } from "eslint-linter-browserify";
import type { EditorView } from "@codemirror/view";
import type { Diagnostic } from "@codemirror/lint";
import type { ScriptStage } from "@/lib/scripts/model";

const linter = new Linter();

// The injected API names that exist in EACH stage, as ESLint readonly globals.
// `req` is pre-only, `res` post-only; everything else (Promise/JSON/Math/...) is
// a standard ES global ESLint already knows via ecmaVersion.
function globalsFor(stage: ScriptStage): Record<string, "readonly"> {
  const shared = { requi: "readonly", console: "readonly" } as const;
  if (stage === "pre") {
    return { ...shared, req: "readonly" };
  }
  return { ...shared, res: "readonly" };
}

// Semantic linter: flags undefined variables (no-undef) - an undeclared
// assignment (`csd = 2`) or a call to an unknown name (`nope()`, an API typo).
// Complements jsSyntaxLinter (parse errors); together they mirror the body
// editor's lint. Pure over the view's doc + stage, so it is unit-tested directly.
export function jsUndefLinter(
  stage: ScriptStage,
): (view: EditorView) => Diagnostic[] {
  return (view) => {
    const doc = view.state.doc;
    const code = doc.toString();
    if (code.trim() === "") {
      return [];
    }
    const messages = linter.verify(code, {
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        globals: globalsFor(stage),
      },
      rules: { "no-undef": "error" },
    });
    return messages.map((message) => {
      const from = doc.line(message.line).from + (message.column - 1);
      const to =
        message.endLine !== undefined && message.endColumn !== undefined
          ? doc.line(message.endLine).from + (message.endColumn - 1)
          : Math.min(from + 1, doc.length);
      return {
        from: Math.min(from, doc.length),
        to: Math.min(Math.max(to, from + 1), doc.length),
        severity: "error",
        message: message.message,
      };
    });
  };
}
