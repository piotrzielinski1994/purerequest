import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { linter, lintGutter } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { useMemo } from "react";
import { CodeEditor } from "@/components/workspace/code-editor";
import { scriptApiCompletion } from "@/components/workspace/script-api-complete";
import { jsUndefLinter } from "@/components/workspace/script-eslint";
import { jsSyntaxLinter } from "@/components/workspace/script-lint";
import { useEditorExtensions } from "@/components/workspace/use-editor-extensions";
import type { ScriptStage } from "@/lib/scripts/model";

type ScriptEditorProps = {
  value: string;
  stage: ScriptStage;
  onChange: (value: string) => void;
  onBlur?: () => void;
  ariaLabel: string;
};

export function ScriptEditor({
  value,
  stage,
  onChange,
  onBlur,
  ariaLabel,
}: ScriptEditorProps) {
  const { scriptChrome, scriptHighlight, findExtension } =
    useEditorExtensions();
  const extensions = useMemo(
    () => [
      javascript(),
      closeBrackets(),
      autocompletion({ override: [scriptApiCompletion(stage)] }),
      // Two linters: parse errors (Lezer) + undefined-variable semantics (ESLint
      // no-undef, stage-aware globals).
      linter((view) => [
        ...jsSyntaxLinter()(view),
        ...jsUndefLinter(stage)(view),
      ]),
      lintGutter(),
      scriptChrome,
      scriptHighlight,
      findExtension,
      // Mirror the aria-label onto the CM content node so the existing
      // getByLabelText query still resolves the editor.
      EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
    ],
    [stage, ariaLabel, scriptChrome, scriptHighlight, findExtension],
  );
  return (
    <CodeEditor
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      extensions={extensions}
    />
  );
}
