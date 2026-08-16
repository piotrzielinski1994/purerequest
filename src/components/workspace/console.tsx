import type { Extension } from "@codemirror/state";
import { cn, ScrollArea } from "@pziel/pureui";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor } from "@/components/workspace/code-editor";
import {
  type ConsoleLevel,
  consoleLineLevel,
  parseConsoleObjectLine,
  type TokenKind,
  tokenizeConsoleLine,
} from "@/components/workspace/console-line";
import { useEditorExtensions } from "@/components/workspace/use-editor-extensions";
import {
  useLogLines,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import type { LogLevel, LogLine } from "@/lib/workspace/log-line";
import {
  filterLogLines,
  type HighlightSegment,
  highlightLogSearch,
} from "@/lib/workspace/log-search";

type ConsoleTab = "console" | "logs";

const LEVEL_CLASS: Record<ConsoleLevel, string> = {
  log: "text-foreground/80",
  warn: "text-amber-500 dark:text-amber-400",
  error: "text-red-500 dark:text-red-400",
  muted: "text-muted-foreground",
};

// The message text is muted grey regardless of level - only the level BADGE carries the signal
// color, so an error is identified by its red badge alone. Kv VALUES set their own text-foreground.
const LEVEL_BADGE_CLASS: Record<LogLevel, string> = {
  error: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
  debug: "text-muted-foreground",
  trace: "text-muted-foreground",
};

const KV_KEY_CLASS = "text-orange-600 dark:text-orange-400";
const KV_VALUE_CLASS = "text-foreground";

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

// One application-log line: muted timestamp, colored level badge, and the message with its
// key=value pairs dimmed keys + accented values. Falls back to the raw text when the line was
// unparseable (empty timestamp).
function LogLineRow({ line }: { line: LogLine }) {
  const parts = line.message.split(/(\s+)/);
  return (
    <li className="py-0.5 break-all text-muted-foreground">
      {line.timestamp ? (
        <span className="text-muted-foreground">{line.timestamp} </span>
      ) : null}
      <span className={cn("uppercase", LEVEL_BADGE_CLASS[line.level])}>
        {line.level}
      </span>{" "}
      {parts.map((part, index) => {
        const kv = part.match(/^([A-Za-z_]+)=(\S+)$/);
        if (!kv) {
          return <span key={index}>{part}</span>;
        }
        return (
          <span key={index}>
            <span className={KV_KEY_CLASS}>{kv[1]}=</span>
            <span className={KV_VALUE_CLASS}>{kv[2]}</span>
          </span>
        );
      })}
    </li>
  );
}

const SEARCH_SEGMENT_CLASS: Record<HighlightSegment["kind"], string> = {
  key: KV_KEY_CLASS,
  value: KV_VALUE_CLASS,
  plain: "text-muted-foreground",
};

const SEARCH_BOX =
  "h-5 w-44 px-2 text-xs leading-5 whitespace-pre overflow-hidden";

function LogSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const segments = highlightLogSearch(value);
  return (
    <div className="relative bg-background">
      <div
        aria-hidden="true"
        className={cn(
          SEARCH_BOX,
          "pointer-events-none absolute inset-0 flex items-center border border-transparent",
        )}
      >
        {segments.map((segment, index) => (
          <span key={index} className={SEARCH_SEGMENT_CLASS[segment.kind]}>
            {segment.text}
          </span>
        ))}
      </div>
      <input
        type="search"
        aria-label="Search logs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="level:error GET ..."
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={cn(
          SEARCH_BOX,
          "relative border bg-transparent text-transparent caret-foreground placeholder:text-muted-foreground focus:outline-none",
        )}
      />
    </div>
  );
}

function ConsoleTabButton({
  isActive,
  onSelect,
  label,
}: {
  isActive: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-selected={isActive}
      className={cn(
        "h-full px-3 tracking-wide uppercase",
        isActive
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
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
  const { logLines, clearLogLines } = useLogLines();
  const { consoleViewerExtensions, editorColors } = useEditorExtensions();
  const sectionRef = useRef<HTMLElement>(null);
  const tokenColors: TokenColors = {
    key: editorColors.property,
    string: editorColors.string,
    number: editorColors.number,
    keyword: editorColors.keyword,
  };
  const [tab, setTab] = useState<ConsoleTab>("console");
  const [logSearch, setLogSearch] = useState("");
  const filteredLogs = useMemo(
    () => filterLogLines(logLines, logSearch),
    [logLines, logSearch],
  );
  // Stick the Logs list to the bottom as new lines arrive (only while Logs is active).
  const logsEndRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (tab === "logs") {
      logsEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [tab, filteredLogs.length]);

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

  const logsCount = logLines.length;

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label="Console"
      className="flex h-full flex-col bg-muted/30 font-mono text-xs outline-none"
    >
      <div className="flex items-stretch border-b pr-1">
        <ConsoleTabButton
          isActive={tab === "console"}
          onSelect={() => setTab("console")}
          label="Console"
        />
        <ConsoleTabButton
          isActive={tab === "logs"}
          onSelect={() => setTab("logs")}
          label={`Logs${logsCount > 0 ? ` (${logsCount})` : ""}`}
        />
        <div className="ml-auto flex items-center">
          {tab === "logs" ? (
            <LogSearchInput value={logSearch} onChange={setLogSearch} />
          ) : null}
          <button
            type="button"
            aria-label={tab === "logs" ? "Clear logs" : "Clear console"}
            title={tab === "logs" ? "Clear logs" : "Clear console"}
            disabled={(tab === "logs" ? logsCount : consoleLines.length) === 0}
            onClick={tab === "logs" ? clearLogLines : clearConsole}
            className="px-2 py-1.5 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      {tab === "logs" ? (
        <ScrollArea key="logs" className="flex-1">
          {logsCount === 0 ? (
            <p className="p-3 text-muted-foreground">
              No application logs yet this session.
            </p>
          ) : filteredLogs.length === 0 ? (
            <p className="p-3 text-muted-foreground">No matching log lines.</p>
          ) : (
            <ul aria-label="Application logs" className="p-2">
              {filteredLogs.map((line, index) => (
                <LogLineRow key={index} line={line} />
              ))}
              <li ref={logsEndRef} aria-hidden="true" />
            </ul>
          )}
        </ScrollArea>
      ) : (
        <ScrollArea key="console" className="flex-1">
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
      )}
    </section>
  );
}
