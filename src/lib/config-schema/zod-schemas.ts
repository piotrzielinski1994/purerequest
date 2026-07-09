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
// Auth mirrors the body model: `active` picks the sent auth, `types` keeps each
// fielded variant's values side-by-side (so switching type preserves them).
const authSchema = z
  .object({
    active: z
      .enum(["inherit", "none", "bearer", "basic"])
      .describe("Which auth is sent."),
    types: z
      .object({
        bearer: z.object({ token: z.string() }).strict(),
        basic: z
          .object({ username: z.string(), password: z.string() })
          .strict(),
      })
      .strict()
      .describe("Per-type auth values, retained across type switches."),
  })
  .strict();

const scriptConfigSchema = z
  .object({
    pre: z.string().optional(),
    post: z.string().optional(),
  })
  .strict();

export const configScopeSchema = z
  .object({
    variables: z
      .array(keyValueSchema)
      .describe("Named values usable as {{var}} in this scope.")
      .optional(),
    environments: z
      .array(
        z
          .object({
            name: z.string(),
            variables: z.array(keyValueSchema),
          })
          .strict(),
      )
      .describe("Per-environment variable overrides, one entry per environment.")
      .optional(),
    headers: z
      .array(keyValueSchema)
      .describe("Request headers applied to this scope.")
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

// The folder Settings JSON doc: the config fields, but `environments` entries may
// carry an optional `color` (the folder's env border hex, folded in on disk). Kept
// separate from configScopeSchema so that stays a pure ConfigScope mirror for the
// drift guard - only the folder editor's doc allows the color key.
export const folderConfigSchema = configScopeSchema.extend({
  environments: z
    .array(
      z
        .object({
          name: z.string(),
          color: z
            .string()
            .describe("Folder border color for this env (#rrggbb/#rrggbbaa).")
            .optional(),
          variables: z.array(keyValueSchema),
        })
        .strict(),
    )
    .describe("Per-environment variable overrides + optional folder border color.")
    .optional(),
});

// The `body` object: `active` selects the mode, `types` holds each payload
// side-by-side. The json slot is the body's natural JSON value (real nested JSON
// on disk) or a raw string; form/multipart are field-row arrays. Every slot is
// optional so a minimal-diff doc can omit the empty ones.
const requestBodySchema = z
  .object({
    active: z
      .enum(["json", "none", "form", "multipart", "graphql"])
      .describe("Which body type is sent."),
    types: z
      .object({
        json: z
          .unknown()
          .describe("JSON body (nested JSON) or a raw string.")
          .optional(),
        form: z
          .array(keyValueSchema)
          .describe("Form URL-encoded field rows.")
          .optional(),
        multipart: z
          .array(keyValueSchema)
          .describe("Multipart form field rows.")
          .optional(),
        graphql: z
          .object({
            query: z.string().describe("GraphQL query text.").optional(),
            variables: z
              .string()
              .describe("GraphQL variables as raw JSON text.")
              .optional(),
          })
          .strict()
          .describe("GraphQL query + variables text.")
          .optional(),
      })
      .strict()
      .describe("Payload per body type, retained across mode switches."),
  })
  .strict();

// The `params` object: request-only `path` (rows naming each URL `:name`) and
// `query` (the Query grid, mirrored to the URL). Both KeyValue[] arrays (like
// headers), both optional for a minimal-diff doc.
const requestParamsSchema = z
  .object({
    path: z
      .array(keyValueSchema)
      .describe("Path params: rows naming each URL `:name` -> value.")
      .optional(),
    query: z
      .array(keyValueSchema)
      .describe("Query parameters, mirrored to the URL.")
      .optional(),
  })
  .strict();

export const requestSettingsSchema = z
  .object({
    name: z.string().describe("Request name."),
    method: z
      .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
      .describe("HTTP method."),
    url: z.string().describe("Request URL (supports {{var}})."),
    body: requestBodySchema
      .describe("Request body: active type + per-type payloads.")
      .optional(),
    params: requestParamsSchema
      .describe("Request params: path + query.")
      .optional(),
  })
  // Config fields sit FLAT at the top level (no `config` wrapper): everything on a
  // request is config, so it's mixed in alongside name/method/url/body/params.
  .extend(configScopeSchema.shape)
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
