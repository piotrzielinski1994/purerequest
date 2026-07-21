export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "QUERY";

// The request's transport-version choice. `auto` negotiates HTTP/1.1 or HTTP/2 over
// TCP (today's behaviour); `h3` forces HTTP/3 over QUIC. Absent on a node means `auto`.
export type HttpVersion = "auto" | "h3";

// `enabled` defaults to true when absent (legacy rows + the common case); a row
// explicitly `enabled: false` is kept on disk but excluded from the sent request.
export type KeyValue = { key: string; value: string; enabled?: boolean };

export type AuthMode = "inherit" | "none" | "bearer" | "basic";

// Auth mirrors the body model: `active` selects which auth is sent, while `types`
// keeps every fielded variant's values side-by-side so switching type never
// discards the other's fields. `inherit`/`none` carry no fields (not in `types`):
// inherit falls through to the nearest ancestor scope, none sends nothing.
export type Auth = {
  active: AuthMode;
  types: {
    bearer: { token: string };
    basic: { username: string; password: string };
  };
};

// Empty auth for a fresh scope (and the default the disk layer + migration fall
// back to): inherit active, both variant slots blank.
export function emptyAuth(): Auth {
  return {
    active: "inherit",
    types: { bearer: { token: "" }, basic: { username: "", password: "" } },
  };
}

// Build an Auth with `active` selected and (for bearer/basic) that slot filled;
// the other slots stay blank. Used by importers (curl/bruno) that produce a
// single known auth.
export function authOf(
  variant:
    | { active: "inherit" | "none" }
    | { active: "bearer"; token: string }
    | { active: "basic"; username: string; password: string },
): Auth {
  const auth = emptyAuth();
  auth.active = variant.active;
  if (variant.active === "bearer") {
    auth.types.bearer = { token: variant.token };
  }
  if (variant.active === "basic") {
    auth.types.basic = {
      username: variant.username,
      password: variant.password,
    };
  }
  return auth;
}

export type ScriptConfig = { pre?: string; post?: string };

export type BodyMode = "json" | "none" | "form" | "multipart" | "graphql";

// A request body holds every type's payload side-by-side so switching `active`
// never discards the others. `none` carries no payload (it's not in `types`).
// `json` is the raw editor text (written as its natural JSON value at the disk
// boundary, so a JSON body renders as real nested JSON, not an escaped string).
// `graphql` holds the raw query + variables text; the send-time encoder folds
// them into the canonical `{ query, variables }` JSON.
export type RequestBody = {
  active: BodyMode;
  types: {
    json: string;
    form: KeyValue[];
    multipart: KeyValue[];
    graphql: { query: string; variables: string };
  };
};

// Request-only params. Both grids are KeyValue[] (consistent with headers/query).
// `path` rows name each URL `:name` (colon stripped) -> value (may hold
// {{tokens}}); `query` is the Query grid, mirrored to the URL `?query`. Array,
// not a record, so order + a grid-only row survive; a `:name` still maps to one
// value, so keyed lookups fold rows via keyValuesToRecord (last row wins).
export type RequestParams = {
  path: KeyValue[];
  query: KeyValue[];
};

// Fold KeyValue rows into a name -> value record for the keyed boundaries (URL
// `:name` substitution, token hover, {{var}} lookups). A key maps to exactly one
// value, so a dup key resolves last-row-wins.
export function keyValuesToRecord(rows: KeyValue[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

// Update-or-append a `{key, value}` in a KeyValue[] rows list: overwrite the
// first row whose key matches (preserving its other fields, e.g. `enabled`),
// else append. Immutable - returns a new array.
export function upsertRow(
  rows: KeyValue[],
  key: string,
  value: string,
): KeyValue[] {
  return rows.some((row) => row.key === key)
    ? rows.map((row) => (row.key === key ? { ...row, value } : row))
    : [...rows, { key, value }];
}

// One named environment on a scope: its variable overrides as KeyValue[] rows
// (consistent with the plain `variables` grid and headers). Array, not a record,
// so order survives and the shape matches every other grid.
export type Environment = {
  name: string;
  variables: KeyValue[];
};

export type ConfigScope = {
  variables?: KeyValue[];
  environments?: Environment[];
  headers?: KeyValue[];
  auth?: Auth;
  scripts?: ScriptConfig;
  timeoutMs?: number;
};

// Look up one environment's variable rows by name (folded to a record for keyed
// lookups); returns {} when the env isn't declared on the scope.
export function environmentVars(
  environments: Environment[] | undefined,
  name: string,
): Record<string, string> {
  const env = environments?.find((e) => e.name === name);
  return env ? keyValuesToRecord(env.variables) : {};
}

export type ResponseTimings = {
  dnsMs: number;
  connectMs: number;
  waitingMs: number;
  downloadMs: number;
};

// A Wireshark-style network-stack dissection of a completed send: ordered layers
// (Socket -> TLS -> HTTP), each with flat "facts" fields plus byte-backed `segments`
// (a TLS record, an HTTP/2 frame) whose fields carry the exact byte/bit range they occupy
// so the UI can highlight them against a raw hex view. Decoded from the captured wire bytes
// on the Rust tap client. Absent for seeded/legacy/error/dev-browser responses (no capture).
export type DissectionField = {
  label: string;
  value: string;
  meaning: string;
  // Byte range within the parent segment's bytes (absent on flat "facts" fields).
  byteOffset?: number;
  byteLength?: number;
  // Sub-byte bit range, measured from the MSB of the field's first byte (a 0x01 mask is
  // bitOffset 7). Present only for true bit fields (HTTP/2 flags, reserved/stream-id split).
  bitOffset?: number;
  bitLength?: number;
  // Nested fields (e.g. a flags byte with one child per flag bit).
  children?: DissectionField[];
};

export type DissectionSegment = {
  title: string;
  // Space-separated hex byte pairs (possibly head-truncated - see `truncated`).
  hex: string;
  byteLen: number;
  truncated: boolean;
  fields: DissectionField[];
};

// How much of an OSI layer a userspace HTTPS client can observe: "decoded" = real wire
// bytes decoded here; "facts" = socket-derived facts only (no header bytes); "privileged" =
// observable but only via a privileged capture driver (what Wireshark uses), a deliberate
// opt-out for an unprivileged app; "unreachable" = not observable by any software.
export type DissectionReach =
  | "decoded"
  | "facts"
  | "privileged"
  | "unreachable";

export type DissectionLayer = {
  osi: number;
  name: string;
  summary: string;
  reach: DissectionReach;
  fields: DissectionField[];
  segments: DissectionSegment[];
};

export type Dissection = {
  layers: DissectionLayer[];
};

export type RequestResponse = {
  status: number;
  timeMs: number;
  sizeBytes: number;
  body: string;
  headers: KeyValue[];
  timings?: ResponseTimings;
  dissection?: Dissection;
};

export type RequestNode = {
  kind: "request";
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  body: RequestBody;
  params: RequestParams;
  config: ConfigScope;
  httpVersion?: HttpVersion;
  response?: RequestResponse;
};

// A request's effective transport version: the stored value, or `auto` when absent
// (the on-disk default - an omitted field means auto). One source of truth for the
// default so no call site hardcodes it.
export function requestHttpVersion(node: RequestNode): HttpVersion {
  return node.httpVersion ?? "auto";
}

// Empty body/params for a fresh request (and the default both the disk layer and
// migration fall back to). Keeps every construction site on one source of truth.
export function emptyBody(): RequestBody {
  return {
    active: "json",
    types: {
      json: "",
      form: [],
      multipart: [],
      graphql: { query: "", variables: "" },
    },
  };
}

export function emptyParams(): RequestParams {
  return { path: [], query: [] };
}

export type FolderNode = {
  kind: "folder";
  id: string;
  name: string;
  config: ConfigScope;
  dotenv?: string;
  // Per-environment border colors: env name -> lowercase `#rrggbb`/`#rrggbbaa` hex
  // (the optional alpha pair is the chosen border opacity). A folder-only
  // presentation cue; requests inherit the nearest ancestor folder's color for the
  // active env. Absent/empty = no colors.
  environmentColors?: Record<string, string>;
  children: TreeNode[];
};

export type TreeNode = FolderNode | RequestNode;
