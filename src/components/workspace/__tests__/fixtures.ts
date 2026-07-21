import type {
  FolderNode,
  KeyValue,
  RequestBody,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";
import { authOf } from "@/lib/workspace/model";

// Test builders mirroring the runtime helpers: a json body with the given text,
// and request params carrying just query rows (path empty unless a test sets it).
const jsonBody = (json: string): RequestBody => ({
  active: "json",
  types: {
    json,
    form: [],
    multipart: [],
    graphql: { query: "", variables: "" },
  },
});
const emptyBody = (): RequestBody => jsonBody("");
const queryParams = (query: KeyValue[]) => ({ path: [], query });

// Small, explicit fixture tree used by all workspace tests.
// Shape mirrors spec section 4 (TreeNode/RequestNode/FolderNode discriminated unions).
// IDs are stable so initialExpandedIds / initialActiveRequestId are deterministic.
//
//   v Auth
//      v OAuth
//         POST token        (bearer)   -> nested 3 folders deep
//   > Users                            (collapsed sibling folder)
//   GET profile             (basic)    (root request leaf)
//   DELETE session          (none)     (root request leaf)

export const tokenRequest: RequestNode = {
  kind: "request",
  id: "req-token",
  name: "token",
  method: "POST",
  url: "{{baseUrl}}/oauth/token",
  body: emptyBody(),
  params: queryParams([
    { key: "grant_type", value: "client_credentials" },
    { key: "scope", value: "read" },
  ]),
  config: {
    headers: [
      { key: "Content-Type", value: "application/x-www-form-urlencoded" },
    ],
    auth: authOf({ active: "bearer", token: "tok-abc-123" }),
    scripts: { pre: "", post: "" },
  },
  response: {
    status: 200,
    timeMs: 142,
    sizeBytes: 512,
    body: '{ "access_token": "abc" }',
    headers: [
      { key: "X-Response-Header", value: "resp-value" },
      { key: "Content-Type", value: "application/json" },
    ],
  },
};

export const profileRequest: RequestNode = {
  kind: "request",
  id: "req-profile",
  name: "profile",
  method: "GET",
  url: "{{baseUrl}}/users/:id",
  body: emptyBody(),
  params: {
    path: [{ key: "id", value: "1" }],
    query: [{ key: "expand", value: "roles" }],
  },
  config: {
    headers: [{ key: "Accept", value: "application/json" }],
    auth: authOf({ active: "basic", username: "admin", password: "s3cret" }),
    scripts: { pre: "", post: "" },
  },
  response: {
    status: 201,
    timeMs: 88,
    sizeBytes: 256,
    body: '{ "id": 1 }',
    headers: [{ key: "X-Profile", value: "yes" }],
  },
};

export const sessionRequest: RequestNode = {
  kind: "request",
  id: "req-session",
  name: "session",
  method: "DELETE",
  url: "{{baseUrl}}/session",
  body: emptyBody(),
  params: { path: [], query: [] },
  config: {
    auth: authOf({ active: "none" }),
    scripts: { pre: "", post: "" },
  },
  response: {
    status: 204,
    timeMs: 30,
    sizeBytes: 0,
    body: "",
    headers: [],
  },
};

const oauthFolder: FolderNode = {
  kind: "folder",
  id: "folder-oauth",
  name: "OAuth",
  config: {},
  children: [tokenRequest],
};

const authFolder: FolderNode = {
  kind: "folder",
  id: "folder-auth",
  name: "Auth",
  config: { variables: [{ key: "baseUrl", value: "https://api.example.com" }] },
  children: [oauthFolder],
};

const usersFolder: FolderNode = {
  kind: "folder",
  id: "folder-users",
  name: "Users",
  config: {},
  children: [profileRequest],
};

export const fixtureTree: TreeNode[] = [
  authFolder,
  usersFolder,
  profileRequest,
  sessionRequest,
];

// Body-editor fixtures: the shared tree above has only empty bodies, but the
// body-editor spec (TC-001/AC-004) needs a request seeded with real JSON text,
// plus a sibling with a distinct body to prove per-id isolation (TC-005/AC-006).
export const JSON_BODY = '{\n  "grant_type": "client_credentials"\n}';
export const OTHER_BODY = '{\n  "id": 42\n}';

export const jsonBodyRequest: RequestNode = {
  ...tokenRequest,
  id: "req-json-body",
  name: "json-body",
  body: jsonBody(JSON_BODY),
};

export const otherBodyRequest: RequestNode = {
  ...profileRequest,
  id: "req-other-body",
  name: "other-body",
  body: jsonBody(OTHER_BODY),
};

export const emptyBodyRequest: RequestNode = {
  ...sessionRequest,
  id: "req-empty-body",
  name: "empty-body",
  body: emptyBody(),
};

export const bodyFixtureTree: TreeNode[] = [
  jsonBodyRequest,
  otherBodyRequest,
  emptyBodyRequest,
];
