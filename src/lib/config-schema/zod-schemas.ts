import { z } from "zod";

// zod is the single source for the IntelliSense JSON Schema. Each schema is
// authored to match the hand-written TS model (drift guarded by a type-level
// test) and is `.strict()` so unknown keys surface as warnings in the editor.
// `.describe(...)` text flows through to the hover tooltips.

const keyValueSchema = z
  .object({
    key: z.string(),
    value: z.string(),
    enabled: z.boolean().optional(),
  })
  .strict();

// Single-member `z.enum([...])` per variant (not `z.literal`) so the generated
// JSON Schema carries a `type.enum` array for `auth.type` while the inferred
// type stays the exact discriminated `Auth` union.
const authSchema = z.union([
  z.object({ type: z.enum(["inherit"]) }).strict(),
  z.object({ type: z.enum(["none"]) }).strict(),
  z.object({ type: z.enum(["bearer"]), token: z.string() }).strict(),
  z
    .object({
      type: z.enum(["basic"]),
      username: z.string(),
      password: z.string(),
    })
    .strict(),
]);

const scriptConfigSchema = z
  .object({
    pre: z.string().optional(),
    post: z.string().optional(),
  })
  .strict();

export const configScopeSchema = z
  .object({
    variables: z
      .record(z.string(), z.string())
      .describe("Named values usable as {{var}} in this scope.")
      .optional(),
    environments: z
      .record(z.string(), z.record(z.string(), z.string()))
      .describe("Per-environment variable overrides, keyed by environment name.")
      .optional(),
    headers: z
      .array(keyValueSchema)
      .describe("Request headers applied to this scope.")
      .optional(),
    params: z
      .array(keyValueSchema)
      .describe("Query parameters applied to this scope.")
      .optional(),
    auth: authSchema
      .describe("Authentication: inherit, none, bearer token, or basic.")
      .optional(),
    scripts: scriptConfigSchema
      .describe("Pre-request / post-response scripts.")
      .optional(),
    timeoutMs: z
      .number()
      .describe("Request timeout in milliseconds.")
      .optional(),
  })
  .strict();

// Plain z.union (not z.discriminatedUnion): the inferred StoredBody type is
// identical, but it emits `anyOf` in the generated JSON Schema instead of
// `oneOf`. The codemirror-json-schema completion drops object properties whose
// value schema is `oneOf` (no top-level `type`), so a `oneOf` body would be
// missing from key autocomplete; `anyOf` is kept.
const storedBodySchema = z.union([
  z.object({ type: z.literal("json"), payload: z.unknown() }),
  z.object({ type: z.literal("text"), payload: z.string() }),
]);

export const requestSettingsSchema = z
  .object({
    name: z.string().describe("Request name."),
    method: z
      .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
      .describe("HTTP method."),
    url: z.string().describe("Request URL (supports {{var}})."),
    body: storedBodySchema.describe("Request body, tagged json or text."),
    bodyMode: z
      .enum(["json", "none", "form", "multipart"])
      .describe("How the body is encoded.")
      .optional(),
    bodyForm: z
      .array(keyValueSchema)
      .describe("Form / multipart field rows.")
      .optional(),
    config: configScopeSchema.describe("Scope config for this request."),
  })
  .strict();

const APP_TOKEN_NAMES = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
] as const;

const EDITOR_TOKEN_NAMES = [
  "caret",
  "selection",
  "gutter",
  "keyword",
  "string",
  "number",
  "property",
  "comment",
  "invalid",
] as const;

const overridesSchema = z
  .object({
    tokens: z
      .partialRecord(z.enum(APP_TOKEN_NAMES), z.string())
      .describe("App color tokens for this mode."),
    editor: z
      .partialRecord(z.enum(EDITOR_TOKEN_NAMES), z.string())
      .describe("Editor syntax/chrome color tokens for this mode."),
  })
  .strict();

export const themeColorsSchema = z
  .object({
    light: overridesSchema.describe("Color overrides for light mode."),
    dark: overridesSchema.describe("Color overrides for dark mode."),
  })
  .strict();

export type ConfigScopeSchema = z.infer<typeof configScopeSchema>;
export type RequestSettingsSchema = z.infer<typeof requestSettingsSchema>;
export type ThemeColorsSchema = z.infer<typeof themeColorsSchema>;
