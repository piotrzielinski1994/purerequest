import CodeMirror from "@uiw/react-codemirror";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { jsonViewerExtensions } from "@/components/workspace/editor-theme";
import {
  consoleLineLevel,
  parseConsoleObjectLine,
  tokenizeConsoleLine,
  type ConsoleLevel,
  type TokenKind,
} from "@/components/workspace/console-line";

const LEVEL_CLASS: Record<ConsoleLevel, string> = {
  log: "text-foreground/80",
  warn: "text-amber-500 dark:text-amber-400",
  error: "text-red-500 dark:text-red-400",
  muted: "text-muted-foreground",
};

// JSON token colors, matching the Darcula scheme of the body editor / response
// viewer so a logged object reads the same everywhere.
const TOKEN_COLOR: Record<Exclude<TokenKind, "plain">, string> = {
  key: "#9876aa",
  string: "#6a8759",
  number: "#6897bb",
  keyword: "#cc7832",
};

function TokenizedLine({ level, line }: { level: ConsoleLevel; line: string }) {
  return (
    <span className={LEVEL_CLASS[level]}>
      {tokenizeConsoleLine(line).map((token, index) =>
        token.kind === "plain" ? (
          <span key={index}>{token.text}</span>
        ) : (
          <span key={index} style={{ color: TOKEN_COLOR[token.kind] }}>
            {token.text}
          </span>
        ),
      )}
    </span>
  );
}

function ConsoleLine({ line }: { line: string }) {
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
        <CodeMirror
          value={object.json}
          theme="none"
          editable={false}
          extensions={jsonViewerExtensions}
          basicSetup={{ lineNumbers: false, foldGutter: true }}
          className="text-xs"
        />
      </span>
    );
  }
  return <TokenizedLine level={level} line={line} />;
}

export function Console() {
  const { consoleLines } = useWorkspace();

  return (
    <section
      aria-label="Console"
      className="flex h-full flex-col bg-muted/30 font-mono text-xs"
    >
      <div className="border-b px-3 py-1.5 tracking-wide text-muted-foreground uppercase">
        Console
      </div>
      <ScrollArea className="flex-1">
        <ul className="p-2">
          {consoleLines.map((line, index) => (
            <li key={index} className="py-0.5 whitespace-pre-wrap">
              <ConsoleLine line={line} />
            </li>
          ))}
        </ul>
      </ScrollArea>
    </section>
  );
}
