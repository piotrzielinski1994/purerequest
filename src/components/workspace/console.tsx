import type { Extension } from "@codemirror/state";
import { ScrollArea } from "@pziel/pureui";
import { Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { CodeEditor } from "@/components/workspace/code-editor";
import {
  type ConsoleLevel,
  consoleLineLevel,
  parseConsoleObjectLine,
  type TokenKind,
  tokenizeConsoleLine,
} from "@/components/workspace/console-line";
import { useEditorExtensions } from "@/components/workspace/use-editor-extensions";
import { useWorkspace } from "@/components/workspace/workspace-context";

const LEVEL_CLASS: Record<ConsoleLevel, string> = {
  log: "text-foreground/80",
  warn: "text-amber-500 dark:text-amber-400",
  error: "text-red-500 dark:text-red-400",
  muted: "text-muted-foreground",
};

// JSON token colors follow the active editor scheme so a logged object/value
// reads the same as the body editor / response viewer (and recolors with the
// theme). The console token kinds map onto the editor syntax tokens.
type TokenColors = Record<Exclude<TokenKind, "plain">, string>;

function TokenizedLine({
  level,
  line,
  tokenColors,
}: {
  level: ConsoleLevel;
  line: string;
  tokenColors: TokenColors;
}) {
  return (
    <span className={LEVEL_CLASS[level]}>
      {tokenizeConsoleLine(line).map((token, index) =>
        token.kind === "plain" ? (
          <span key={index}>{token.text}</span>
        ) : (
          <span key={index} style={{ color: tokenColors[token.kind] }}>
            {token.text}
          </span>
        ),
      )}
    </span>
  );
}

function ConsoleLine({
  line,
  viewerExtensions,
  tokenColors,
}: {
  line: string;
  viewerExtensions: Extension[];
  tokenColors: TokenColors;
}) {
  const level = consoleLineLevel(line);
  // warn/error stay a solid severity color (readability of the level wins over
  // token coloring); log/muted lines get JSON syntax coloring.
  if (level === "warn" || level === "error") {
    return <span className={LEVEL_CLASS[level]}>{line}</span>;
  }
  // A line that is a single logged object/array renders in the read-only JSON
  // viewer (CodeMirror) so its `{}`/`[]` blocks are collapsible via the fold
  // gutter, same as the response viewer.
  const object = parseConsoleObjectLine(line);
  if (object) {
    return (
      <span className="block">
        {object.prefix !== "" ? (
          <span className="text-muted-foreground">{object.prefix}</span>
        ) : null}
        <CodeEditor
          value={object.json}
          editable={false}
          withFold
          extensions={viewerExtensions}
          height={null}
          className="text-xs"
        />
      </span>
    );
  }
  return <TokenizedLine level={level} line={line} tokenColors={tokenColors} />;
}

export function Console() {
  const { consoleLines, clearConsole, pendingPanelFocus, consumePanelFocus } =
    useWorkspace();
  const { consoleViewerExtensions, editorColors } = useEditorExtensions();
  const sectionRef = useRef<HTMLElement>(null);
  const tokenColors: TokenColors = {
    key: editorColors.property,
    string: editorColors.string,
    number: editorColors.number,
    keyword: editorColors.keyword,
  };

  // Toggling the console visible focuses its scroll region so keyboard scrolling
  // (arrows/PageUp/PageDown) works right away. Console has no item nav, so the
  // section itself is the focus target.
  useEffect(() => {
    if (pendingPanelFocus !== "console") {
      return;
    }
    sectionRef.current?.focus();
    consumePanelFocus();
  }, [pendingPanelFocus, consumePanelFocus]);

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label="Console"
      className="flex h-full flex-col bg-muted/30 font-mono text-xs outline-none"
    >
      <div className="flex items-center border-b pr-1 pl-3 tracking-wide text-muted-foreground uppercase">
        <span className="py-1.5">Console</span>
        <button
          type="button"
          aria-label="Clear console"
          title="Clear console"
          disabled={consoleLines.length === 0}
          onClick={clearConsole}
          className="ml-auto px-2 py-1.5 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <ScrollArea className="flex-1">
        <ul className="p-2">
          {consoleLines.map((line, index) => (
            <li key={index} className="py-0.5 whitespace-pre-wrap">
              <ConsoleLine
                line={line}
                viewerExtensions={consoleViewerExtensions}
                tokenColors={tokenColors}
              />
            </li>
          ))}
        </ul>
      </ScrollArea>
    </section>
  );
}
