import type { FileMap } from "@/lib/workspace/disk-format";

const MANAGED_FILE =
  /(?:^|\/)folder\.json$|\.req\.json$|^purerequest\.workspace\.json$/;

export type ReconcilePlan = { write: FileMap; remove: string[] };

const ENV_FILE = /(?:^|\/)\.env$/;

export function planReconcile(current: FileMap, next: FileMap): ReconcilePlan {
  const write: FileMap = {};
  for (const [path, content] of Object.entries(next)) {
    if (current[path] !== content) {
      write[path] = content;
    }
  }
  // Every dir that still has a file under it in `next` - a `.env` may only be
  // reconciled away when NO next file lives in its folder subtree (the folder is
  // gone), else a per-folder `.env` that `next` simply didn't re-emit would be
  // wrongly deleted.
  const survivingDirs = new Set(
    Object.keys(next).flatMap((path) => ancestorDirs(path)),
  );
  const isRemovable = (path: string): boolean => {
    if (path in next) {
      return false;
    }
    if (MANAGED_FILE.test(path)) {
      return true;
    }
    const dir = parentDir(path);
    return ENV_FILE.test(path) && dir !== null && !survivingDirs.has(dir);
  };
  const remove = Object.keys(current).filter(isRemovable);
  return { write, remove };
}

export function parentDir(relPath: string): string | null {
  const slash = relPath.lastIndexOf("/");
  return slash === -1 ? null : relPath.slice(0, slash);
}

function ancestorDirs(relPath: string): string[] {
  const dirs: string[] = [];
  let dir = parentDir(relPath);
  while (dir !== null) {
    dirs.push(dir);
    dir = parentDir(dir);
  }
  return dirs;
}

export function emptyDirsAfterRemoval(
  next: FileMap,
  removed: string[],
): string[] {
  const surviving = new Set(
    Object.keys(next).flatMap((path) => ancestorDirs(path)),
  );
  const candidates = new Set(removed.flatMap((path) => ancestorDirs(path)));
  return [...candidates]
    .filter((dir) => !surviving.has(dir))
    .sort((a, b) => b.length - a.length);
}
