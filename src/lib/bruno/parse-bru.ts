import type {
  Auth,
  BodyMode,
  HttpMethod,
  KeyValue,
  ScriptConfig,
} from "@/lib/workspace/model";
import { authOf } from "@/lib/workspace/model";

// A single `.bru` file parsed into the fields ReqUI needs. Total function -
// never throws; missing blocks leave the optionals undefined / collections empty.
export type ParsedBru = {
  name?: string;
  method?: HttpMethod;
  url?: string;
  headers: KeyValue[];
  params: KeyValue[];
  bodyMode?: BodyMode;
  body: string;
  bodyForm: KeyValue[];
  // Raw variables text from a `body:graphql:vars` block; "" when absent. Only the
  // graphql body path uses it.
  graphqlVariables: string;
  auth?: Auth;
  variables: Record<string, string>;
  scripts?: ScriptConfig;
  environments: Record<string, Record<string, string>>;
};

type Block = { name: string; inner: string };

const METHOD_NAMES = new Set(["get", "post", "put", "patch", "delete", "query"]);

// Split a bru document into top-level `name { ... }` blocks, brace-counting so a
// nested `{`/`}` inside a body block doesn't close the block early. Anything with
// no opening brace (garbage) yields no blocks.
function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const braceIndex = text.indexOf("{", cursor);
    if (braceIndex === -1) {
      break;
    }
    const header = text.slice(cursor, braceIndex).trim();
    const name = header.split(/\s+/).pop() ?? "";
    let depth = 1;
    let end = braceIndex + 1;
    while (end < text.length && depth > 0) {
      const ch = text[end];
      if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
      }
      end += 1;
    }
    const inner = text.slice(braceIndex + 1, depth === 0 ? end - 1 : end);
    if (name !== "") {
      blocks.push({ name, inner });
    }
    cursor = end;
  }
  return blocks;
}

// Dictionary block -> rows. A leading `~` on the key marks a disabled row.
function parseDict(inner: string): KeyValue[] {
  return inner
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .flatMap<KeyValue>((line) => {
      const colon = line.indexOf(":");
      if (colon === -1) {
        return [];
      }
      const rawKey = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      const enabled = !rawKey.startsWith("~");
      const key = enabled ? rawKey : rawKey.slice(1).trim();
      return [{ key, value, enabled }];
    });
}

function dictToRecord(inner: string): Record<string, string> {
  return parseDict(inner).reduce<Record<string, string>>(
    (acc, { key, value }) => ({ ...acc, [key]: value }),
    {},
  );
}

// Text block -> its inner content with the wrapping blank lines dropped and the
// common leading indentation removed, so a captured body/script reads cleanly.
function dedentText(inner: string): string {
  const trimmedEdges = inner
    .replace(/^[ \t]*\r?\n/, "")
    .replace(/\r?\n[ \t]*$/, "");
  const lines = trimmedEdges.split("\n");
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  return lines
    .map((line) => line.slice(common))
    .join("\n")
    .trim();
}

type BodyKind =
  | "json"
  | "text"
  | "xml"
  | "form"
  | "multipart"
  | "graphql"
  | "other";

function bodyKindOf(name: string): BodyKind {
  if (name === "body" || name === "body:json") {
    return "json";
  }
  if (name === "body:text") {
    return "text";
  }
  if (name === "body:xml") {
    return "xml";
  }
  if (name === "body:form-urlencoded") {
    return "form";
  }
  if (name === "body:multipart-form") {
    return "multipart";
  }
  if (name === "body:graphql") {
    return "graphql";
  }
  return "other";
}

function selectorToKind(selector: string): BodyKind {
  if (selector === "form-urlencoded") {
    return "form";
  }
  if (selector === "multipart-form") {
    return "multipart";
  }
  if (
    selector === "json" ||
    selector === "text" ||
    selector === "xml" ||
    selector === "graphql"
  ) {
    return selector;
  }
  return "other";
}

// Pick the active body block: the method block's `body:` selector wins; else the
// first usable block. `none` (or no body block) means no body. The `body:graphql`
// query block is usable; its `body:graphql:vars` sibling is captured separately.
function chooseBody(blocks: Block[], selector: string | undefined): Block | null {
  const usable = blocks.filter(
    (block) =>
      (block.name === "body" || block.name.startsWith("body:")) &&
      block.name !== "body:graphql:vars",
  );
  if (selector === "none") {
    return null;
  }
  if (selector !== undefined) {
    const wanted = selectorToKind(selector);
    const matched = usable.find((block) => bodyKindOf(block.name) === wanted);
    return matched ?? usable[0] ?? null;
  }
  return usable[0] ?? null;
}

function resolveAuth(blocks: Block[], selector: string | undefined): Auth | undefined {
  const bearer = blocks.find((block) => block.name === "auth:bearer");
  if (bearer) {
    return authOf({
      active: "bearer",
      token: dictToRecord(bearer.inner).token ?? "",
    });
  }
  const basic = blocks.find((block) => block.name === "auth:basic");
  if (basic) {
    const record = dictToRecord(basic.inner);
    return authOf({
      active: "basic",
      username: record.username ?? "",
      password: record.password ?? "",
    });
  }
  if (selector === "none") {
    return authOf({ active: "none" });
  }
  if (selector === "inherit") {
    return authOf({ active: "inherit" });
  }
  return undefined;
}

export function parseBru(text: string): ParsedBru {
  const blocks = splitBlocks(text);

  const metaBlock = blocks.find((block) => block.name === "meta");
  const name = metaBlock ? dictToRecord(metaBlock.inner).name : undefined;

  const methodBlock = blocks.find((block) => METHOD_NAMES.has(block.name));
  const methodRecord = methodBlock ? dictToRecord(methodBlock.inner) : {};

  const headersBlock = blocks.find((block) => block.name === "headers");
  const paramsBlock = blocks.find((block) => block.name === "params:query");

  const variables = blocks
    .filter((block) => block.name === "vars" || block.name === "vars:pre-request")
    .reduce<Record<string, string>>(
      (acc, block) => ({ ...acc, ...dictToRecord(block.inner) }),
      {},
    );

  const preBlock = blocks.find((block) => block.name === "script:pre-request");
  const postBlock = blocks.find((block) => block.name === "script:post-response");
  const scripts: ScriptConfig | undefined =
    preBlock || postBlock
      ? {
          ...(preBlock ? { pre: dedentText(preBlock.inner) } : {}),
          ...(postBlock ? { post: dedentText(postBlock.inner) } : {}),
        }
      : undefined;

  const chosenBody = chooseBody(blocks, methodRecord.body);
  const bodyKind = chosenBody ? bodyKindOf(chosenBody.name) : null;
  const bodyMode: BodyMode | undefined =
    bodyKind === "form"
      ? "form"
      : bodyKind === "multipart"
        ? "multipart"
        : bodyKind === "graphql"
          ? "graphql"
          : undefined;
  const bodyForm =
    chosenBody && (bodyKind === "form" || bodyKind === "multipart")
      ? parseDict(chosenBody.inner)
      : [];
  const body =
    chosenBody && bodyKind !== "form" && bodyKind !== "multipart"
      ? dedentText(chosenBody.inner)
      : "";
  const varsBlock = blocks.find((block) => block.name === "body:graphql:vars");
  const graphqlVariables =
    bodyKind === "graphql" && varsBlock ? dedentText(varsBlock.inner) : "";

  return {
    ...(name !== undefined ? { name } : {}),
    ...(methodBlock ? { method: methodBlock.name.toUpperCase() as HttpMethod } : {}),
    ...(methodRecord.url !== undefined ? { url: methodRecord.url } : {}),
    headers: headersBlock ? parseDict(headersBlock.inner) : [],
    params: paramsBlock ? parseDict(paramsBlock.inner) : [],
    ...(bodyMode ? { bodyMode } : {}),
    body,
    bodyForm,
    graphqlVariables,
    ...(resolveAuth(blocks, methodRecord.auth)
      ? { auth: resolveAuth(blocks, methodRecord.auth) }
      : {}),
    variables,
    ...(scripts ? { scripts } : {}),
    environments: {},
  };
}
