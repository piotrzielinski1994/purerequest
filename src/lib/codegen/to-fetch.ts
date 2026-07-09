import type { HttpRequest } from "@/lib/http/model";

// Serialize an already-RESOLVED wire request to a runnable `fetch` call. Every
// string (url, header key, header value, body) is emitted via JSON.stringify so
// quotes / newlines / backslashes always yield a valid JS string literal. Auth is
// already an Authorization header on the wire request, so it is not re-emitted.
export function toFetch(req: HttpRequest): string {
  const options = [`method: ${JSON.stringify(req.method)}`];
  if (req.headers.length > 0) {
    const entries = req.headers
      .map(
        (header) =>
          `    ${JSON.stringify(header.key)}: ${JSON.stringify(header.value)}`,
      )
      .join(",\n");
    options.push(`headers: {\n${entries}\n  }`);
  }
  if (req.body !== null && req.body !== "") {
    options.push(`body: ${JSON.stringify(req.body)}`);
  }
  const optionsBlock = options.map((option) => `  ${option}`).join(",\n");
  return `fetch(${JSON.stringify(req.url)}, {\n${optionsBlock}\n});`;
}
