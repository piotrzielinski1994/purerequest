const KB = 1024;
const MB = KB * 1024;

export const RESPONSE_RENDER_LIMIT_BYTES = 2 * MB;

export function formatBytes(bytes: number): string {
  if (bytes < KB) {
    return `${bytes}B`;
  }
  if (bytes < MB) {
    return `${(bytes / KB).toFixed(1)}KB`;
  }
  return `${(bytes / MB).toFixed(1)}MB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}
