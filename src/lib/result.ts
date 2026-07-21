export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function toResult<T>(promise: Promise<T>): Promise<Result<T>> {
  return promise
    .then((value): Result<T> => ({ ok: true, value }))
    .catch(
      (error): Result<T> => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
}
