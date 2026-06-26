import { CodeEditor } from "@/components/workspace/code-editor";
import { useEditorExtensions } from "@/components/workspace/use-editor-extensions";

type BodyEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

export function BodyEditor({ value, onChange }: BodyEditorProps) {
  const { bodyExtensions } = useEditorExtensions();
  return (
    <CodeEditor
      value={value}
      onChange={onChange}
      withFold
      extensions={bodyExtensions}
    />
  );
}
