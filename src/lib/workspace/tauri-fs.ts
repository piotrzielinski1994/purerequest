import { mkdir, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import type { FileMap } from "@/lib/workspace/disk-format";
import type { ReadResult, WorkspaceFs, WriteResult } from "@/lib/workspace/fs";
import {
  emptyDirsAfterRemoval,
  parentDir,
  planReconcile,
} from "@/lib/workspace/reconcile";

const MANAGED_FILE =
  /(?:^|\/)folder\.json$|\.req\.json$|^requi\.workspace\.json$/;

async function collect(
  absDir: string,
  relPrefix: string,
  files: FileMap,
): Promise<void> {
  const entries = await readDir(absDir);
  for (const entry of entries) {
    const relPath = `${relPrefix}${entry.name}`;
    const absPath = `${absDir}/${entry.name}`;
    if (entry.isDirectory) {
      await collect(absPath, `${relPath}/`, files);
      continue;
    }
    if (entry.isFile && MANAGED_FILE.test(relPath)) {
      files[relPath] = await readTextFile(absPath);
    }
  }
}

export function createTauriWorkspaceFs(): WorkspaceFs {
  return {
    readWorkspace: async (rootPath): Promise<ReadResult> => {
      const files: FileMap = {};
      try {
        await collect(rootPath, "", files);
        return { ok: true, files };
      } catch (error) {
        return { ok: false, error: `Failed to read workspace: ${error}` };
      }
    },
    writeWorkspace: async (rootPath, files): Promise<WriteResult> => {
      const current: FileMap = {};
      try {
        await collect(rootPath, "", current);
      } catch {
        // Fresh/unreadable target: treat as empty, write everything.
      }
      const plan = planReconcile(current, files);
      try {
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
        return { ok: true };
      } catch (error) {
        return { ok: false, error: `Failed to write workspace: ${error}` };
      }
    },
  };
}
