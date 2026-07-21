import { toFetch } from "@/lib/codegen/to-fetch";
import { toCurl } from "@/lib/curl/to-curl";
import type { HttpRequest } from "@/lib/http/model";

export type CodeTargetId = "curl" | "fetch";

export type CodeTarget = {
  id: CodeTargetId;
  label: string;
  generate: (req: HttpRequest) => string;
};

// Order = dropdown order; the first target is the dialog default.
export const CODE_TARGETS: readonly CodeTarget[] = [
  { id: "curl", label: "cURL", generate: toCurl },
  { id: "fetch", label: "JavaScript - fetch", generate: toFetch },
];

export function codeTargetById(id: CodeTargetId): CodeTarget {
  const target = CODE_TARGETS.find((candidate) => candidate.id === id);
  if (!target) {
    throw new Error(`Unknown code target: ${id}`);
  }
  return target;
}
