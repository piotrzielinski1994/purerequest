import type { HttpRequest } from "@/lib/http/model";

// POSIX single-quote escaping: wrap in single quotes; an embedded single quote
// closes the quote, adds an escaped quote, and reopens ('\'' idiom). Everything
// else (incl. newlines) survives verbatim inside the quotes.
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// Serialize an already-RESOLVED wire request to a runnable curl command. Auth is
// already an Authorization header on the wire request, so it is not re-emitted.
export function toCurl(req: HttpRequest): string {
  const parts = [`curl -X ${req.method} ${shellQuote(req.url)}`];
  req.headers.forEach((header) => {
    parts.push(`-H ${shellQuote(`${header.key}: ${header.value}`)}`);
  });
  if (req.body !== null && req.body !== "") {
    parts.push(`--data-raw ${shellQuote(req.body)}`);
  }
  return parts.join(" \\\n  ");
}
