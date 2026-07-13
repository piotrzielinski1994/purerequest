import { CodeEditor } from "@/components/workspace/code-editor";
import { useEditorExtensions } from "@/components/workspace/use-editor-extensions";

function prettify(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function JsonViewer({ text }: { text: string }) {
  const { responseViewerExtensions } = useEditorExtensions();
  // `editable` stays true so CodeMirror renders a caret for keyboard navigation;
  // edits are blocked by EditorState.readOnly inside responseViewerExtensions.
  return (
    <CodeEditor
      value={prettify(text)}
      editable
      withFold
      extensions={responseViewerExtensions}
    />
  );
}
