import { describe, expect, it } from "vitest";
import type { BrunoFileMap } from "@/lib/bruno/bruno-to-tree";
import { createBrunoWriter, createNoopBrunoWriter } from "@/lib/bruno/writer";

function fakeWrites() {
  const written: Record<string, string> = {};
  return {
    written,
    writeFile: (path: string, content: string): Promise<void> => {
      written[path] = content;
      return Promise.resolve();
    },
  };
}

const FILES: BrunoFileMap = {
  "bruno.json": "{}",
  "get-users.bru": "get {\n  url: https://x.test\n}\n",
  "users/folder.bru": "meta {\n  name: users\n}\n",
};

describe("createBrunoWriter - save (AC-010)", () => {
  // TC-010 - behavior: when the picker returns null (user cancels), save resolves
  // false and writes nothing.
  it("should resolve false and write nothing if the picker is cancelled", async () => {
    const { written, writeFile } = fakeWrites();
    const writer = createBrunoWriter({
      pickDir: () => Promise.resolve(null),
      writeFile,
    });

    const result = await writer.save(FILES, "My API");

    expect(result).toBe(false);
    expect(Object.keys(written)).toHaveLength(0);
  });

  // TC-011 - behavior: with a picker returning a dir, every file in the map is
  // written under <dir>/<slug(name)>/, and save resolves true.
  it("should write every file under <dir>/<slug(name)>/ and resolve true", async () => {
    const { written, writeFile } = fakeWrites();
    const writer = createBrunoWriter({
      pickDir: () => Promise.resolve("/tmp/out"),
      writeFile,
    });

    const result = await writer.save(FILES, "My API");

    expect(result).toBe(true);
    expect(written["/tmp/out/my-api/bruno.json"]).toBe("{}");
    expect(written["/tmp/out/my-api/get-users.bru"]).toBe(
      "get {\n  url: https://x.test\n}\n",
    );
    expect(written["/tmp/out/my-api/users/folder.bru"]).toBe(
      "meta {\n  name: users\n}\n",
    );
    expect(Object.keys(written)).toHaveLength(3);
  });
});

describe("createNoopBrunoWriter (AC-010)", () => {
  // behavior: the dev-browser no-op writer never writes and always resolves false.
  it("should resolve false without writing", async () => {
    const result = await createNoopBrunoWriter().save(FILES, "My API");

    expect(result).toBe(false);
  });
});
