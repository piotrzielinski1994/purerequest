import type { Auth, HttpMethod, KeyValue } from "@/lib/workspace/model";
import { authOf } from "@/lib/workspace/model";

export type ParsedCurl = {
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  body: string | null;
  auth?: Auth;
};

export type CurlParseResult =
  | { ok: true; request: ParsedCurl }
  | { ok: false; error: string };

const METHODS = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "QUERY",
]);

const DATA_FLAGS = new Set([
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
]);

// Tokenize a shell command respecting single quotes (literal), double quotes
// (literal here - we never expand variables), backslash escapes, and the
// backslash-newline line continuation that multi-line curls use.
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let mode: "none" | "single" | "double" = "none";
  let i = 0;

  const flush = () => {
    if (hasToken) {
      tokens.push(current);
      current = "";
      hasToken = false;
    }
  };

  while (i < input.length) {
    const ch = input[i];
    if (mode === "single") {
      if (ch === "'") {
        mode = "none";
      } else {
        current += ch;
        hasToken = true;
      }
      i += 1;
      continue;
    }
    if (mode === "double") {
      if (ch === '"') {
        mode = "none";
        i += 1;
        continue;
      }
      if (ch === "\\" && (input[i + 1] === '"' || input[i + 1] === "\\")) {
        current += input[i + 1];
        hasToken = true;
        i += 2;
        continue;
      }
      current += ch;
      hasToken = true;
      i += 1;
      continue;
    }
    if (ch === "'") {
      mode = "single";
      hasToken = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      mode = "double";
      hasToken = true;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      const next = input[i + 1];
      if (next === "\n" || next === undefined) {
        i += 2;
        continue;
      }
      current += next;
      hasToken = true;
      i += 2;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      flush();
      i += 1;
      continue;
    }
    current += ch;
    hasToken = true;
    i += 1;
  }
  flush();
  return tokens;
}

function toHeader(raw: string): KeyValue {
  const index = raw.indexOf(":");
  if (index === -1) {
    return { key: raw.trim(), value: "", enabled: true };
  }
  return {
    key: raw.slice(0, index).trim(),
    value: raw.slice(index + 1).trim(),
    enabled: true,
  };
}

function toBasicAuth(raw: string): Auth {
  const index = raw.indexOf(":");
  if (index === -1) {
    return authOf({ active: "basic", username: raw, password: "" });
  }
  return authOf({
    active: "basic",
    username: raw.slice(0, index),
    password: raw.slice(index + 1),
  });
}

export function parseCurl(text: string): CurlParseResult {
  const tokens = tokenize(text);
  if (tokens[0] === "$") {
    tokens.shift();
  }
  if (tokens[0] === "curl") {
    tokens.shift();
  }

  let explicitMethod: HttpMethod | null = null;
  let url: string | null = null;
  const headers: KeyValue[] = [];
  const dataParts: string[] = [];
  let auth: Auth | undefined;

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const next = tokens[i + 1];
    if (token === "-X" || token === "--request") {
      const candidate = (next ?? "").toUpperCase() as HttpMethod;
      if (METHODS.has(candidate)) {
        explicitMethod = candidate;
      }
      i += 2;
      continue;
    }
    if (token === "--url") {
      url = next ?? url;
      i += 2;
      continue;
    }
    if (token === "-H" || token === "--header") {
      if (next !== undefined) {
        headers.push(toHeader(next));
      }
      i += 2;
      continue;
    }
    if (token === "-b" || token === "--cookie") {
      if (next !== undefined) {
        headers.push({ key: "Cookie", value: next, enabled: true });
      }
      i += 2;
      continue;
    }
    if (token === "-u" || token === "--user") {
      if (next !== undefined) {
        auth = toBasicAuth(next);
      }
      i += 2;
      continue;
    }
    if (DATA_FLAGS.has(token)) {
      if (next !== undefined) {
        dataParts.push(next);
      }
      i += 2;
      continue;
    }
    if (token.startsWith("-")) {
      i += 1;
      continue;
    }
    if (url === null) {
      url = token;
    }
    i += 1;
  }

  if (url === null) {
    return { ok: false, error: "No URL found in the curl command." };
  }

  const body = dataParts.length > 0 ? dataParts.join("&") : null;
  const method = explicitMethod ?? (body !== null ? "POST" : "GET");

  const request: ParsedCurl = { method, url, headers, body };
  if (auth) {
    request.auth = auth;
  }
  return { ok: true, request };
}
