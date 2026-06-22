export type ConsoleLevel = "log" | "warn" | "error" | "muted";

export type TokenKind = "plain" | "key" | "string" | "number" | "keyword";

// Split a console line into any leading text + a trailing JSON object/array, so
// the Console can render the object in a foldable viewer. The prefix may be just
// `[pre] ` or carry extra text (`console.log('asd: ', obj)` -> `[pre] asd: `).
// Returns null unless the line ENDS with a valid `{...}`/`[...]` (text trailing
// the object, a scalar, or plain text all yield null).
export function parseConsoleObjectLine(
  line: string,
): { prefix: string; json: string } | null {
  if (!/[\]}]$/.test(line)) {
    return null;
  }
  // Try each `{`/`[` start left-to-right; the first whose slice-to-end parses as
  // an object/array is the JSON tail (so the `[` in a `[pre]` prefix is skipped).
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "{" && line[i] !== "[") {
      continue;
    }
    const json = line.slice(i);
    try {
      const parsed: unknown = JSON.parse(json);
      if (parsed !== null && typeof parsed === "object") {
        return { prefix: line.slice(0, i), json };
      }
    } catch {
      // not a valid JSON tail at this position; try the next bracket
    }
  }
  return null;
}

export type ConsoleToken = { kind: TokenKind; text: string };

// Lightweight JSON-ish lexer for a console line: splits out quoted strings
// (a string immediately followed by `:` is a key), numbers, and true/false/null
// keywords; everything else (prefix, braces, whitespace) stays plain. It is a
// SCANNER, not a parser - it colors tokens wherever they appear in the line
// (a console.log obj is pretty-printed JSON, so its tokens light up), and a
// plain log string with no JSON shape comes back as one plain segment.
export function tokenizeConsoleLine(line: string): ConsoleToken[] {
  const tokens: ConsoleToken[] = [];
  let plain = "";
  const flushPlain = () => {
    if (plain !== "") {
      tokens.push({ kind: "plain", text: plain });
      plain = "";
    }
  };
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (char === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') {
        j += line[j] === "\\" ? 2 : 1;
      }
      const text = line.slice(i, Math.min(j + 1, line.length));
      let k = j + 1;
      while (k < line.length && (line[k] === " " || line[k] === "\t")) {
        k += 1;
      }
      flushPlain();
      tokens.push({ kind: line[k] === ":" ? "key" : "string", text });
      i = j + 1;
      continue;
    }
    const rest = line.slice(i);
    const number = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (number && !/[A-Za-z0-9_]/.test(line[i - 1] ?? "")) {
      flushPlain();
      tokens.push({ kind: "number", text: number[0] });
      i += number[0].length;
      continue;
    }
    const keyword = /^(?:true|false|null)\b/.exec(rest);
    if (keyword && !/[A-Za-z0-9_]/.test(line[i - 1] ?? "")) {
      flushPlain();
      tokens.push({ kind: "keyword", text: keyword[0] });
      i += keyword[0].length;
      continue;
    }
    plain += char;
    i += 1;
  }
  flushPlain();
  return tokens;
}

// Classify a console line by its prefix/marker into a severity used for color.
// Lines are plain strings: script output is `[pre]/[post] <text>` (a warn/error
// from console.warn/error carries a `warn:`/`error:` marker after the stage
// prefix, and a thrown-script error is `[pre] error: ...`); workspace lines are
// `[workspace] ...` (a `failed`-to-persist line is an error, the rest muted).
export function consoleLineLevel(line: string): ConsoleLevel {
  const stage = line.match(/^\[(?:pre|post)\] (\w+):/);
  if (stage) {
    if (stage[1] === "error") {
      return "error";
    }
    if (stage[1] === "warn") {
      return "warn";
    }
  }
  if (line.startsWith("[workspace]")) {
    return line.includes("failed") ? "error" : "muted";
  }
  return "log";
}
