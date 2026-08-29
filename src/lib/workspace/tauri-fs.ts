import { toResult } from "@pziel/pureui";
import { invoke } from "@tauri-apps/api/core";
import {
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { FileMap } from "@/lib/workspace/disk-format";
import type { ReadResult, WorkspaceFs, WriteResult } from "@/lib/workspace/fs";
import {
  emptyDirsAfterRemoval,
  parentDir,
  planReconcile,
} from "@/lib/workspace/reconcile";

const MANAGED_FILE =
  /(?:^|\/)folder\.json$|\.req\.json$|^purerequest\.workspace\.json$/;

// Read-only inputs captured into the FileMap but NOT matched by MANAGED_FILE,
// so reconcile never removes them: the workspace-root `.env` and any per-folder
// `.env` at any depth. Folder `.env` files ARE written (serialize emits them),
// but reconcile's MANAGED_FILE filter never targets `.env` for removal.
const READONLY_FILE = /(?:^|\/)\.env$/;

async function collectPaths(
  absDir: string,
  relPrefix: string,
  out: { relPath: string; absPath: string }[],
): Promise<void> {
  const entries = await readDir(absDir);
  await Promise.all(
    entries.map(async (entry) => {
      const relPath = `${relPrefix}${entry.name}`;
      const absPath = `${absDir}/${entry.name}`;
      if (entry.isDirectory) {
        await collectPaths(absPath, `${relPath}/`, out);
        return;
      }
      if (
        entry.isFile &&
        (MANAGED_FILE.test(relPath) || READONLY_FILE.test(relPath))
      ) {
        out.push({ relPath, absPath });
      }
    }),
  );
}

async function collect(
  absDir: string,
  relPrefix: string,
  files: FileMap,
): Promise<void> {
  const paths: { relPath: string; absPath: string }[] = [];
  await collectPaths(absDir, relPrefix, paths);
  const contents = await Promise.all(
    paths.map(async ({ relPath, absPath }) => ({
      relPath,
      content: await readTextFile(absPath),
    })),
  );
  for (const { relPath, content } of contents) {
    files[relPath] = content;
  }
}

export function createTauriWorkspaceFs(): WorkspaceFs {
  return {
    readWorkspace: async (rootPath): Promise<ReadResult> => {
      // Single-IPC Rust read: ~10x faster than 438× plugin-fs IPC on WSL UNC.
      const rust = await toResult(
        invoke<FileMap>("read_workspace", { rootPath }),
      );
      if (rust.ok) {
        return { ok: true, files: rust.value };
      }
      const files: FileMap = {};
      const read = await toResult(collect(rootPath, "", files));
      if (!read.ok) {
        return { ok: false, error: `Failed to read workspace: ${read.error}` };
      }
      return { ok: true, files };
    },
    writeWorkspace: async (rootPath, files): Promise<WriteResult> => {
      const current: FileMap = {};
      // Fresh/unreadable target: treat as empty, write everything.
      // Prefer the Rust bulk read for speed on WSL UNC.
      const rustCurrent = await toResult(
        invoke<FileMap>("read_workspace", { rootPath }),
      );
      if (rustCurrent.ok) {
        Object.assign(current, rustCurrent.value);
      } else {
        await toResult(collect(rootPath, "", current));
      }
      const plan = planReconcile(current, files);
      const written = await toResult(
        (async (): Promise<void> => {
          // Ensure the workspace root itself exists: a root-level file (the
          // manifest, a top-level *.req.json) has no parent dir to mkdir, so a
          // fresh/never-created rootPath would otherwise ENOENT on first write.
          await mkdir(rootPath, { recursive: true });
          for (const [relPath, content] of Object.entries(plan.write)) {
            const dir = parentDir(relPath);
            if (dir !== null) {
              await mkdir(`${rootPath}/${dir}`, { recursive: true });
            }
            await writeTextFile(`${rootPath}/${relPath}`, content);
          }
          for (const relPath of plan.remove) {
            await remove(`${rootPath}/${relPath}`);
          }
          for (const dir of emptyDirsAfterRemoval(files, plan.remove)) {
            await remove(`${rootPath}/${dir}`).catch(() => undefined);
          }
        })(),
      );
      if (!written.ok) {
        return {
          ok: false,
          error: `Failed to write workspace: ${written.error}`,
        };
      }
      return { ok: true };
    },
    writeEnv: async (rootPath, content): Promise<WriteResult> => {
      const written = await toResult(
        writeTextFile(`${rootPath}/.env`, content),
      );
      if (!written.ok) {
        return { ok: false, error: `Failed to write .env: ${written.error}` };
      }
      return { ok: true };
    },
  };
}
