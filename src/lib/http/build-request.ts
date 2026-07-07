import type { EffectiveConfig } from "@/lib/workspace/resolve";
import type { Auth, KeyValue, RequestNode } from "@/lib/workspace/model";
import { keyValuesToRecord } from "@/lib/workspace/model";
import type { HttpRequest } from "@/lib/http/model";
import { interpolate } from "@/lib/http/interpolate";
import { encodeBody } from "@/lib/http/body-encode";
import { applyPathParams } from "@/lib/http/path-params";

const BODYLESS_METHODS = new Set(["GET", "DELETE"]);

function authHeader(
  auth: Auth,
  subst: (input: string) => string,
): KeyValue | null {
  if (auth.active === "bearer") {
    const token = subst(auth.types.bearer.token);
    return { key: "Authorization", value: `Bearer ${token}` };
  }
  if (auth.active === "basic") {
    const user = subst(auth.types.basic.username);
    const pass = subst(auth.types.basic.password);
    return { key: "Authorization", value: `Basic ${btoa(`${user}:${pass}`)}` };
  }
  return null;
}

function appendParams(url: string, params: KeyValue[]): string {
  if (params.length === 0) {
    return url;
  }
  const [base, existing] = url.split(/\?(.*)/s);
  const search = new URLSearchParams(existing ?? "");
  // A key already in the url's own query is the request's mirror of that param, so
  // skip it - the url value wins and the param is not sent twice (AC-015).
  const inUrl = new Set(search.keys());
  params
    .filter(({ key }) => !inUrl.has(key))
    .forEach(({ key, value }) => search.append(key, value));
  return `${base}?${search.toString()}`;
}

export function buildHttpRequest(
  node: RequestNode,
  effective: EffectiveConfig,
  processEnv: Record<string, string> = {},
): HttpRequest {
  const vars = Object.fromEntries(
    Object.entries(effective.variables).map(([key, resolved]) => [
      key,
      resolved.value,
    ]),
  );
  const subst = (input: string) => interpolate(input, vars, processEnv);

  const headers: KeyValue[] = Object.entries(effective.headers).map(
    ([key, resolved]) => ({ key, value: subst(resolved.value) }),
  );
  const auth = effective.auth.value;
  const authEntry = authHeader(auth, subst);
  if (authEntry) {
    headers.push(authEntry);
  }

  const params: KeyValue[] = node.params.query
    .filter((row) => row.enabled !== false)
    .map(({ key, value }) => ({ key: subst(key), value: subst(value) }))
    .filter((row) => row.key.trim() !== "");
  const pathResolved = applyPathParams(
    node.url,
    keyValuesToRecord(node.params.path),
    subst,
  );
  const url = appendParams(subst(pathResolved), params);

  if (BODYLESS_METHODS.has(node.method)) {
    return {
      method: node.method,
      url,
      headers,
      body: null,
      auth,
      timeoutMs: effective.timeoutMs.value,
      requestId: crypto.randomUUID(),
    };
  }

  const { body, contentType } = encodeBody(node.body, subst);
  const hasContentType = headers.some(
    (header) => header.key.toLowerCase() === "content-type",
  );
  if (contentType && !hasContentType) {
    headers.push({ key: "Content-Type", value: contentType });
  }

  return {
    method: node.method,
    url,
    headers,
    body,
    auth,
    timeoutMs: effective.timeoutMs.value,
    requestId: crypto.randomUUID(),
  };
}
