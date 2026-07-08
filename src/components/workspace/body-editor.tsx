import { useMemo } from "react";
import { jsonLanguage } from "@codemirror/lang-json";
import { CodeEditor } from "@/components/workspace/code-editor";
import { useEditorExtensions } from "@/components/workspace/use-editor-extensions";
import { tokenCompletionSource } from "@/components/workspace/token-complete-source";
import { tokenCompletionConfig } from "@/components/workspace/token-suggestion-style";
import type { TokenCandidate } from "@/components/workspace/token-complete";

type BodyEditorProps = {
  value: string;
  onChange: (value: string) => void;
  // In-scope `{{token}}` candidates for the active request; absent -> no token
  // completion (the editor is used in contexts with no resolvable scope).
  candidates?: TokenCandidate[];
};

export function BodyEditor({ value, onChange, candidates }: BodyEditorProps) {
  const { bodyExtensions } = useEditorExtensions();
  // Stable key so a same-content candidates array doesn't rebuild the extension
  // (and thus reconfigure CodeMirror) on every render.
  const candidatesKey = (candidates ?? [])
    .map((c) => `${c.name}:${c.source}`)
    .join("|");
  const extensions = useMemo(() => {
    if (!candidates || candidates.length === 0) {
      return bodyExtensions;
    }
    return [
      ...bodyExtensions,
      tokenCompletionConfig,
      jsonLanguage.data.of({ autocomplete: tokenCompletionSource(candidates) }),
    ];
    // candidates is captured via candidatesKey (stable identity); the deps lint
    // can't see through that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyExtensions, candidatesKey]);
  return (
    <CodeEditor
      value={value}
      onChange={onChange}
      withFold
      extensions={extensions}
    />
  );
}
