import { autocompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@pziel/pureui";
import { graphqlLanguageSupport } from "cm6-graphql";
import { useMemo } from "react";
import { BodyEditor } from "@/components/workspace/body-editor";
import { CodeEditor } from "@/components/workspace/code-editor";
import type { TokenCandidate } from "@/components/workspace/token-complete";
import { tokenCompletionSource } from "@/components/workspace/token-complete-source";
import { tokenCompletionConfig } from "@/components/workspace/token-suggestion-style";
import { useEditorExtensions } from "@/components/workspace/use-editor-extensions";

type GraphqlBodyEditorProps = {
  query: string;
  variables: string;
  onQueryChange: (value: string) => void;
  onVariablesChange: (value: string) => void;
  // In-scope `{{token}}` candidates for the active request; absent -> no token
  // completion (the editor is used in contexts with no resolvable scope).
  candidates?: TokenCandidate[];
};

const PANE_LABEL =
  "px-3 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase";

export function GraphqlBodyEditor({
  query,
  variables,
  onQueryChange,
  onVariablesChange,
  candidates,
}: GraphqlBodyEditorProps) {
  const { scriptChrome, scriptHighlight, findExtension } =
    useEditorExtensions();
  const candidatesKey = (candidates ?? [])
    .map((c) => `${c.name}:${c.source}`)
    .join("|");
  const queryExtensions = useMemo(() => {
    const hasCandidates = candidates && candidates.length > 0;
    return [
      graphqlLanguageSupport(),
      scriptChrome,
      scriptHighlight,
      findExtension,
      // Mirror the aria-label onto the CM content node so the label query resolves
      // the editor (matches ScriptEditor).
      EditorView.contentAttributes.of({ "aria-label": "GraphQL query" }),
      ...(hasCandidates
        ? [
            tokenCompletionConfig,
            autocompletion({ override: [tokenCompletionSource(candidates)] }),
          ]
        : []),
    ];
    // candidates captured via candidatesKey (stable identity); the deps lint
    // can't see through that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptChrome, scriptHighlight, findExtension, candidatesKey]);

  return (
    <ResizablePanelGroup orientation="vertical" className="h-full">
      <ResizablePanel id="graphql-query" defaultSize="65%" minSize="20%">
        <div className="flex h-full min-h-0 flex-col">
          <div className={PANE_LABEL}>Query</div>
          <div className="min-h-0 flex-1">
            <CodeEditor
              value={query}
              onChange={onQueryChange}
              extensions={queryExtensions}
            />
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="graphql-variables" defaultSize="35%" minSize="15%">
        <div className="flex h-full min-h-0 flex-col">
          <div className={PANE_LABEL}>Variables</div>
          <div className="min-h-0 flex-1">
            <BodyEditor
              value={variables}
              candidates={candidates}
              onChange={onVariablesChange}
            />
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
