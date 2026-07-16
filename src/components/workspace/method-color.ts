import type { HttpMethod } from "@/lib/workspace/model";

export const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: "text-green-600 dark:text-green-400",
  POST: "text-amber-600 dark:text-amber-400",
  PUT: "text-blue-600 dark:text-blue-400",
  PATCH: "text-purple-600 dark:text-purple-400",
  DELETE: "text-red-600 dark:text-red-400",
  QUERY: "text-teal-600 dark:text-teal-400",
};
