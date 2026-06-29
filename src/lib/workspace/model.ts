export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// `enabled` defaults to true when absent (legacy rows + the common case); a row
// explicitly `enabled: false` is kept on disk but excluded from the sent request.
export type KeyValue = { key: string; value: string; enabled?: boolean };

export type Auth =
  | { type: "inherit" }
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string };

export type ScriptConfig = { pre?: string; post?: string };

export type BodyMode = "json" | "none" | "form" | "multipart";

export type ConfigScope = {
  variables?: Record<string, string>;
  environments?: Record<string, Record<string, string>>;
  headers?: KeyValue[];
  params?: KeyValue[];
  auth?: Auth;
  scripts?: ScriptConfig;
  timeoutMs?: number;
};

export type RequestResponse = {
  status: number;
  timeMs: number;
  sizeBytes: number;
  body: string;
  headers: KeyValue[];
};

export type RequestNode = {
  kind: "request";
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  body: string;
  bodyMode?: BodyMode;
  bodyForm?: KeyValue[];
  config: ConfigScope;
  response?: RequestResponse;
};

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
