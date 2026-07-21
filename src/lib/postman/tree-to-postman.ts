import type { PostmanFileMap } from "@/lib/postman/postman-to-tree";
import type {
  Auth,
  ConfigScope,
  Environment,
  FolderNode,
  KeyValue,
  RequestBody,
  RequestNode,
  ScriptConfig,
  TreeNode,
} from "@/lib/workspace/model";
import { slugify, uniqueSlug } from "@/lib/workspace/slug";

export type PostmanExportRoot = {
  name: string;
  config: ConfigScope;
  children: TreeNode[];
};

const SCHEMA =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

type PostmanRow = { key: string; value: string; disabled?: true };

type PostmanEvent = {
  listen: "prerequest" | "test";
  script: { type: "text/javascript"; exec: string[] };
};

function rowsOf(rows: KeyValue[]): PostmanRow[] {
  return rows.map((row) =>
    row.enabled === false
      ? { key: row.key, value: row.value, disabled: true }
      : { key: row.key, value: row.value },
  );
}

function urlObject(node: RequestNode): Record<string, unknown> {
  const { query, path } = node.params;
  return {
    raw: node.url,
    ...(query.length > 0 ? { query: rowsOf(query) } : {}),
    ...(path.length > 0
      ? { variable: path.map((row) => ({ key: row.key, value: row.value })) }
      : {}),
  };
}

function bodyObject(body: RequestBody): Record<string, unknown> | null {
  if (body.active === "none") {
    return null;
  }
  if (body.active === "json") {
    return {
      mode: "raw",
      raw: body.types.json,
      options: { raw: { language: "json" } },
    };
  }
  if (body.active === "form") {
    return { mode: "urlencoded", urlencoded: rowsOf(body.types.form) };
  }
  if (body.active === "multipart") {
    return { mode: "formdata", formdata: rowsOf(body.types.multipart) };
  }
  return { mode: "graphql", graphql: body.types.graphql };
}

function authObject(auth: Auth | undefined): Record<string, unknown> | null {
  if (!auth || auth.active === "inherit") {
    return null;
  }
  if (auth.active === "bearer") {
    return {
      type: "bearer",
      bearer: [{ key: "token", value: auth.types.bearer.token }],
    };
  }
  if (auth.active === "basic") {
    return {
      type: "basic",
      basic: [
        { key: "username", value: auth.types.basic.username },
        { key: "password", value: auth.types.basic.password },
      ],
    };
  }
  return { type: "noauth" };
}

function eventsOf(scripts: ScriptConfig | undefined): PostmanEvent[] {
  return [
    ...(scripts?.pre ? [scriptEvent("prerequest", scripts.pre)] : []),
    ...(scripts?.post ? [scriptEvent("test", scripts.post)] : []),
  ];
}

function scriptEvent(
  listen: "prerequest" | "test",
  text: string,
): PostmanEvent {
  return {
    listen,
    script: { type: "text/javascript", exec: text.split("\n") },
  };
}

function requestItem(node: RequestNode): Record<string, unknown> {
  const body = bodyObject(node.body);
  const auth = authObject(node.config.auth);
  const headers = node.config.headers ?? [];
  const events = eventsOf(node.config.scripts);
  return {
    name: node.name,
    request: {
      method: node.method,
      url: urlObject(node),
      ...(headers.length > 0 ? { header: rowsOf(headers) } : {}),
      ...(body ? { body } : {}),
      ...(auth ? { auth } : {}),
    },
    ...(events.length > 0 ? { event: events } : {}),
  };
}

function scopeExtras(config: ConfigScope): Record<string, unknown> {
  const auth = authObject(config.auth);
  const events = eventsOf(config.scripts);
  const variables = config.variables ?? [];
  return {
    ...(variables.length > 0
      ? {
          variable: variables.map((row) => ({
            key: row.key,
            value: row.value,
          })),
        }
      : {}),
    ...(auth ? { auth } : {}),
    ...(events.length > 0 ? { event: events } : {}),
  };
}

function folderItem(node: FolderNode): Record<string, unknown> {
  return {
    name: node.name,
    item: node.children.map(itemOf),
    ...scopeExtras(node.config),
  };
}

function itemOf(node: TreeNode): Record<string, unknown> {
  return node.kind === "folder" ? folderItem(node) : requestItem(node);
}

function collectionDoc(root: PostmanExportRoot): Record<string, unknown> {
  return {
    info: { name: root.name, schema: SCHEMA },
    item: root.children.map(itemOf),
    ...scopeExtras(root.config),
  };
}

function environmentDoc(env: Environment): Record<string, unknown> {
  return {
    name: env.name,
    values: env.variables.map((row) => ({
      key: row.key,
      value: row.value,
      enabled: row.enabled !== false,
    })),
  };
}

export function treeToPostmanFiles(root: PostmanExportRoot): PostmanFileMap {
  const files: PostmanFileMap = {
    [`${slugify(root.name)}.postman_collection.json`]: JSON.stringify(
      collectionDoc(root),
      null,
      2,
    ),
  };
  const used = new Set<string>();
  (root.config.environments ?? []).forEach((env) => {
    const slug = uniqueSlug(slugify(env.name), used);
    files[`${slug}.postman_environment.json`] = JSON.stringify(
      environmentDoc(env),
      null,
      2,
    );
  });
  return files;
}
