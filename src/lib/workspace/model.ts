export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

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

export type RequestResponse = {
  status: number;
  timeMs: number;
  sizeBytes: number;
  body: string;
  headers: KeyValue[];
  timings?: ResponseTimings;
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
  response?: RequestResponse;
};

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
