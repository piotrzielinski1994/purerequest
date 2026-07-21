import type { BrunoFileMap } from "@/lib/bruno/bruno-to-tree";
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

export type BrunoExportRoot = {
  name: string;
  config: ConfigScope;
  dotenv?: string;
  children: TreeNode[];
};

const INDENT = "  ";

function dictBlock(name: string, rows: KeyValue[]): string {
  const lines = rows.map((row) => {
    const key = row.enabled === false ? `~${row.key}` : row.key;
    return `${INDENT}${key}: ${row.value}`;
  });
  return `${name} {\n${lines.join("\n")}\n}`;
}

function textBlock(name: string, text: string): string {
  const indented = text
    .split("\n")
    .map((line) => `${INDENT}${line}`)
    .join("\n");
  return `${name} {\n${indented}\n}`;
}

function bodySelector(body: RequestBody): string | null {
  if (body.active === "none") {
    return null;
  }
  if (body.active === "form") {
    return "form-urlencoded";
  }
  if (body.active === "multipart") {
    return "multipart-form";
  }
  if (body.active === "graphql") {
    const { query, variables } = body.types.graphql;
    return query !== "" || variables !== "" ? "graphql" : null;
  }
  return body.types.json !== "" ? "json" : null;
}

function authSelector(auth: Auth | undefined): string | null {
  if (!auth) {
    return null;
  }
  if (
    auth.active === "bearer" ||
    auth.active === "basic" ||
    auth.active === "none"
  ) {
    return auth.active;
  }
  return null;
}

function methodBlock(node: RequestNode): string {
  const bodySel = bodySelector(node.body);
  const authSel = authSelector(node.config.auth);
  const lines = [
    `${INDENT}url: ${node.url}`,
    ...(bodySel ? [`${INDENT}body: ${bodySel}`] : []),
    ...(authSel ? [`${INDENT}auth: ${authSel}`] : []),
  ];
  return `${node.method.toLowerCase()} {\n${lines.join("\n")}\n}`;
}

function bodyBlocks(body: RequestBody): string[] {
  if (body.active === "form") {
    return [dictBlock("body:form-urlencoded", body.types.form)];
  }
  if (body.active === "multipart") {
    return [dictBlock("body:multipart-form", body.types.multipart)];
  }
  if (body.active === "graphql") {
    const { query, variables } = body.types.graphql;
    return [
      ...(query !== "" ? [textBlock("body:graphql", query)] : []),
      ...(variables !== "" ? [textBlock("body:graphql:vars", variables)] : []),
    ];
  }
  if (body.active === "json" && body.types.json !== "") {
    return [textBlock("body:json", body.types.json)];
  }
  return [];
}

function authBlocks(auth: Auth | undefined): string[] {
  if (auth?.active === "bearer") {
    return [
      dictBlock("auth:bearer", [
        { key: "token", value: auth.types.bearer.token },
      ]),
    ];
  }
  if (auth?.active === "basic") {
    return [
      dictBlock("auth:basic", [
        { key: "username", value: auth.types.basic.username },
        { key: "password", value: auth.types.basic.password },
      ]),
    ];
  }
  return [];
}

function scriptBlocks(scripts: ScriptConfig | undefined): string[] {
  return [
    ...(scripts?.pre ? [textBlock("script:pre-request", scripts.pre)] : []),
    ...(scripts?.post ? [textBlock("script:post-response", scripts.post)] : []),
  ];
}

function configBlocks(config: ConfigScope): string[] {
  return [
    ...(config.headers && config.headers.length > 0
      ? [dictBlock("headers", config.headers)]
      : []),
    ...(config.variables && config.variables.length > 0
      ? [dictBlock("vars:pre-request", config.variables)]
      : []),
    ...authBlocks(config.auth),
    ...scriptBlocks(config.scripts),
  ];
}

function joinBlocks(blocks: string[]): string {
  return `${blocks.join("\n\n")}\n`;
}

function requestFile(node: RequestNode, seq: number): string {
  return joinBlocks([
    `meta {\n${INDENT}name: ${node.name}\n${INDENT}type: http\n${INDENT}seq: ${seq}\n}`,
    methodBlock(node),
    ...(node.params.query.length > 0
      ? [dictBlock("params:query", node.params.query)]
      : []),
    ...bodyBlocks(node.body),
    ...configBlocks(node.config),
  ]);
}

function folderFile(node: FolderNode): string {
  return joinBlocks([
    `meta {\n${INDENT}name: ${node.name}\n}`,
    ...configBlocks(node.config),
  ]);
}

function environmentFile(env: Environment): string {
  return `${dictBlock("vars", env.variables)}\n`;
}

function serializeEnvironments(
  files: BrunoFileMap,
  environments: Environment[] | undefined,
  prefix: string,
): void {
  if (!environments || environments.length === 0) {
    return;
  }
  const used = new Set<string>();
  environments.forEach((env) => {
    const slug = uniqueSlug(slugify(env.name), used);
    files[`${prefix}environments/${slug}.bru`] = environmentFile(env);
  });
}

function serializeLevel(
  files: BrunoFileMap,
  nodes: TreeNode[],
  prefix: string,
): void {
  const used = new Set<string>();
  nodes.forEach((node, index) => {
    const slug = uniqueSlug(slugify(node.name), used);
    if (node.kind === "folder") {
      const dir = `${prefix}${slug}`;
      files[`${dir}/folder.bru`] = folderFile(node);
      if (node.dotenv) {
        files[`${dir}/.env`] = node.dotenv;
      }
      serializeEnvironments(files, node.config.environments, `${dir}/`);
      serializeLevel(files, node.children, `${dir}/`);
      return;
    }
    files[`${prefix}${slug}.bru`] = requestFile(node, index + 1);
  });
}

export function treeToBrunoFiles(root: BrunoExportRoot): BrunoFileMap {
  const files: BrunoFileMap = {
    "bruno.json": JSON.stringify(
      { version: "1", name: root.name, type: "collection" },
      null,
      2,
    ),
  };
  const collectionBlocks = configBlocks(root.config);
  if (collectionBlocks.length > 0) {
    files["collection.bru"] = joinBlocks(collectionBlocks);
  }
  if (root.dotenv) {
    files[".env"] = root.dotenv;
  }
  serializeEnvironments(files, root.config.environments, "");
  serializeLevel(files, root.children, "");
  return files;
}
