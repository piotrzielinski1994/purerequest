import { describe, it, expect } from "vitest";

import { serialize } from "@/lib/workspace/disk-format";
import { createInMemoryWorkspaceFs } from "@/lib/workspace/in-memory-fs";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import type { RequestNode, TreeNode } from "@/lib/workspace/model";

const request = (id: string, name = id): RequestNode => ({
  kind: "request",
  id,
  name,
  method: "GET",
  url: `https://example.test/${name}`,
  body: emptyBody(),
  params: emptyParams(),
  config: {},
});

const PATH = "/tmp/ws";

describe("in-memory writeEnv", () => {
  // AC-014 - behavior: writeEnv stores the .env content under files[".env"].
  it('should store the env content so a later read returns it as files[".env"]', async () => {
    const tree: TreeNode[] = [request("r1", "Solo")];
    const fs = createInMemoryWorkspaceFs({ [PATH]: serialize(tree) });

    await fs.writeEnv(PATH, "TOKEN=abc123\nHOST=localhost");

    const read = await fs.readWorkspace(PATH);
    expect(read.ok).toBe(true);
    if (!read.ok) {
      throw new Error(read.error);
    }
    expect(read.files[".env"]).toBe("TOKEN=abc123\nHOST=localhost");
  });

  // AC-014 - side-effect-contract: writeEnv returns { ok: true } on success.
  it("should return ok true if the env write succeeds", async () => {
    const fs = createInMemoryWorkspaceFs({
      [PATH]: serialize([request("r1")]),
    });

    const result = await fs.writeEnv(PATH, "TOKEN=abc123");

    expect(result).toEqual({ ok: true });
  });

  // AC-014 - behavior: writeEnv does not clobber the rest of the file map.
  it("should leave the existing managed files intact if only .env is written", async () => {
    const tree: TreeNode[] = [request("r1", "Keep")];
    const files = serialize(tree);
    const fs = createInMemoryWorkspaceFs({ [PATH]: { ...files } });

    await fs.writeEnv(PATH, "TOKEN=zzz");

    const read = await fs.readWorkspace(PATH);
    if (!read.ok) {
      throw new Error(read.error);
    }
    // every previously-present managed file still has its original content
    Object.entries(files).forEach(([name, content]) => {
      expect(read.files[name]).toBe(content);
    });
    expect(read.files[".env"]).toBe("TOKEN=zzz");
  });

  // AC-014 - behavior: writing .env then reading round-trips the latest content.
  it("should return the latest env content if writeEnv is called twice", async () => {
    const fs = createInMemoryWorkspaceFs({
      [PATH]: serialize([request("r1")]),
    });

    await fs.writeEnv(PATH, "TOKEN=first");
    await fs.writeEnv(PATH, "TOKEN=second");

    const read = await fs.readWorkspace(PATH);
    if (!read.ok) {
      throw new Error(read.error);
    }
    expect(read.files[".env"]).toBe("TOKEN=second");
  });
});
