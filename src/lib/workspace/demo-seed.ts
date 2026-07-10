import type { HttpResponse } from "@/lib/http/model";
import {
  deserialize,
  serialize,
  type FileMap,
} from "@/lib/workspace/disk-format";
import type {
  KeyValue,
  RequestBody,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";

// In-memory fs key + dev-build settings `workspacePath`. The `npm run dev`
// browser build seeds this path so the workspace renders instead of the empty
// state (see `isDevBrowser`).
export const DEMO_WORKSPACE_PATH = "demo";

const WORKSPACE_NAME = "Demo";

const jsonBody = (json: string): RequestBody => ({
  active: "json",
  types: { json, form: [], multipart: [], graphql: { query: "", variables: "" } },
});
const queryParams = (query: KeyValue[]) => ({ path: [], query });

const tokenRequest: RequestNode = {
  kind: "request",
  id: "r-token",
  name: "/oauth/token",
  method: "POST",
  url: "{{baseUrl}}/oauth/token",
  body: jsonBody('{\n  "grant_type": "client_credentials"\n}'),
  params: queryParams([
    { key: "grant_type", value: "client_credentials" },
    { key: "scope", value: "read write" },
  ]),
  config: {
    headers: [
      { key: "Content-Type", value: "application/x-www-form-urlencoded" },
    ],
    auth: authOf({ active: "bearer", token: "ey.mock.token" }),
    scripts: { pre: "// pre-request script", post: "// post-response script" },
  },
  response: {
    status: 200,
    timeMs: 142,
    sizeBytes: 248,
    body: '{\n  "access_token": "ey.mock.token",\n  "expires_in": 3600\n}',
    headers: [
      { key: "Content-Type", value: "application/json" },
      { key: "Cache-Control", value: "no-store" },
    ],
  },
};

const refreshRequest: RequestNode = {
  kind: "request",
  id: "r-refresh",
  name: "/oauth/refresh",
  method: "GET",
  url: "{{baseUrl}}/oauth/refresh",
  body: emptyBody(),
  params: emptyParams(),
  config: {
    headers: [{ key: "Accept", value: "application/json" }],
    auth: authOf({ active: "bearer", token: "ey.refresh.token" }),
  },
  response: {
    status: 200,
    timeMs: 96,
    sizeBytes: 180,
    body: '{\n  "access_token": "ey.new.token"\n}',
    headers: [{ key: "Content-Type", value: "application/json" }],
  },
};

const userinfoRequest: RequestNode = {
  kind: "request",
  id: "r-userinfo",
  name: "/oauth/userinfo",
  method: "GET",
  url: "{{baseUrl}}/oauth/userinfo",
  body: emptyBody(),
  params: emptyParams(),
  config: {
    headers: [{ key: "Authorization", value: "Bearer ey.mock.token" }],
    auth: authOf({ active: "bearer", token: "ey.mock.token" }),
  },
  response: {
    status: 200,
    timeMs: 71,
    sizeBytes: 132,
    body: '{\n  "sub": "user-1",\n  "name": "Ada"\n}',
    headers: [{ key: "Content-Type", value: "application/json" }],
  },
};

const getUserRequest: RequestNode = {
  kind: "request",
  id: "r-getuser",
  name: "/users/:id",
  method: "GET",
  url: "{{baseUrl}}/users/:id",
  body: emptyBody(),
  params: { path: [{ key: "id", value: "1" }], query: [{ key: "expand", value: "roles" }] },
  config: {
    headers: [{ key: "Accept", value: "application/json" }],
    auth: authOf({ active: "basic", username: "admin", password: "s3cret" }),
  },
  response: {
    status: 200,
    timeMs: 64,
    sizeBytes: 210,
    body: '{\n  "id": 1,\n  "name": "Ada"\n}',
    headers: [{ key: "Content-Type", value: "application/json" }],
  },
};

const invoicesRequest: RequestNode = {
  kind: "request",
  id: "r-invoices",
  name: "/billing/invoices",
  method: "GET",
  url: "{{baseUrl}}/billing/invoices",
  body: emptyBody(),
  params: queryParams([{ key: "status", value: "open" }]),
  config: {
    headers: [{ key: "Accept", value: "application/json" }],
    auth: authOf({ active: "bearer", token: "ey.billing.token" }),
  },
  response: {
    status: 200,
    timeMs: 188,
    sizeBytes: 540,
    body: '{\n  "invoices": []\n}',
    headers: [{ key: "Content-Type", value: "application/json" }],
  },
};

const chargeRequest: RequestNode = {
  kind: "request",
  id: "r-charge",
  name: "/billing/charge",
  method: "POST",
  url: "{{baseUrl}}/billing/charge",
  body: jsonBody('{\n  "amount": 1999,\n  "currency": "eur"\n}'),
  params: emptyParams(),
  config: {
    headers: [{ key: "Content-Type", value: "application/json" }],
    auth: authOf({ active: "bearer", token: "ey.billing.token" }),
  },
  response: {
    status: 201,
    timeMs: 233,
    sizeBytes: 96,
    body: '{\n  "charge_id": "ch_1"\n}',
    headers: [{ key: "Content-Type", value: "application/json" }],
  },
};

const healthRequest: RequestNode = {
  kind: "request",
  id: "r-health",
  name: "/health",
  method: "GET",
  url: "{{baseUrl}}/health",
  body: emptyBody(),
  params: emptyParams(),
  config: {
    auth: authOf({ active: "none" }),
  },
  response: {
    status: 200,
    timeMs: 12,
    sizeBytes: 18,
    body: '{\n  "ok": true\n}',
    headers: [{ key: "Content-Type", value: "application/json" }],
  },
};

// Hand-authored source. `serialize` drops `response`/synthetic ids and
// `deserialize` regenerates path-based ids, so the exported `demoTree` below is
// the round-tripped (canonical, loader-shaped) form - a fixed point of the disk
// format, which is exactly what the dev-build loader reads back.
const seedSource: TreeNode[] = [
  {
    kind: "folder",
    id: "f-auth",
    name: "auth",
    config: { variables: [{ key: "baseUrl", value: "https://api.example.com" }] },
    children: [
      {
        kind: "folder",
        id: "f-oauth",
        name: "oauth",
        config: {},
        children: [
          {
            kind: "folder",
            id: "f-tokens",
            name: "tokens",
            config: {},
            children: [tokenRequest, refreshRequest],
          },
          userinfoRequest,
        ],
      },
    ],
  },
  {
    kind: "folder",
    id: "f-users",
    name: "users",
    config: {},
    children: [getUserRequest],
  },
  {
    kind: "folder",
    id: "f-billing",
    name: "billing",
    config: {},
    children: [invoicesRequest, chargeRequest],
  },
  healthRequest,
];

const seedFiles: FileMap = serialize(seedSource, WORKSPACE_NAME);

const parsedSeed = deserialize(seedFiles);

// The canonical, loader-shaped demo tree (path-based ids, no `response`). Equal
// to `deserialize(demoFiles()).tree` by construction.
export const demoTree: TreeNode[] = parsedSeed.ok ? parsedSeed.tree : seedSource;

export const demoConsoleLines: string[] = [
  "[12:00:00] Ready.",
  "→ POST {{baseUrl}}/oauth/token  200",
  "← 142ms · 248B",
  "[script] pre-request ok",
];

// Canned success the fake HTTP client returns in the dev-browser build, so a
// Send shows a real response instead of the "no Tauri host" fake error.
export const DEMO_RESPONSE: HttpResponse = {
  status: 200,
  timeMs: 142,
  sizeBytes: 36,
  body: '{\n  "ok": true,\n  "demo": true\n}',
  headers: [{ key: "Content-Type", value: "application/json" }],
  timings: { dnsMs: 12, connectMs: 34, waitingMs: 88, downloadMs: 8 },
};

// The demo tree serialized to the on-disk format, so the dev-build loader reads
// it back through the real `deserialize` path (and the seed can't drift from a
// shape the loader would reject).
export function demoFiles(): FileMap {
  return seedFiles;
}
