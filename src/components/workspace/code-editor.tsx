import type { Extension } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";

type BasicSetup = NonNullable<
  React.ComponentProps<typeof CodeMirror>["basicSetup"]
>;

// The ONE CodeMirror wrapper every editor/viewer in the app goes through, so the
// chrome stays consistent: `theme="none"` (colors come from the themed extension
// sets) and `lineNumbers: false` are pinned here and cannot drift per call site
// (line numbers are off everywhere - the design contract). Callers vary only the
// extension set, value/onChange, editability, fold gutter, and sizing.
export function CodeEditor({
  value,
  extensions,
  onChange,
  onBlur,
  editable,
  withFold = false,
  ariaLabel,
  height = "100%",
  className = "h-full text-xs",
}: {
  value: string;
  extensions: Extension[];
  onChange?: (value: string) => void;
  onBlur?: () => void;
  editable?: boolean;
  withFold?: boolean;
  ariaLabel?: string;
  // `null` omits the height prop entirely (auto-size, e.g. the inline console
  // object viewer); a string sets it. Defaults to a full-height "100%".
  height?: string | null;
  className?: string;
}) {
  const basicSetup: BasicSetup = { lineNumbers: false, foldGutter: withFold };
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      editable={editable}
      aria-label={ariaLabel}
      theme="none"
      extensions={extensions}
      basicSetup={basicSetup}
      {...(height !== null ? { height } : {})}
      className={className}
    />
  );
}
