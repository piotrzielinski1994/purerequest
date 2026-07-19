import { describe, it, expect } from "vitest";

import {
  createCollectionWriter,
  createNoopCollectionWriter,
} from "@/lib/export/collection-writer";

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

const FILES: Record<string, string> = {
  "my-api.postman_collection.json": '{"info":{}}',
  "dev.postman_environment.json": '{"name":"dev"}',
};

describe("createCollectionWriter - save (AC-011)", () => {
  // TC-013 - side-effect-contract: when the picker returns null (user cancels),
  // save resolves false and writes nothing.
  it("should resolve false and write nothing if the picker is cancelled", async () => {
    const { written, writeFile } = fakeWrites();
    const writer = createCollectionWriter({
      pickDir: () => Promise.resolve(null),
      writeFile,
    });

    const result = await writer.save(FILES, "My API");

    expect(result).toBe(false);
    expect(Object.keys(written)).toHaveLength(0);
  });

  // TC-014 - side-effect-contract: with a picker returning a dir, every file in the
  // map is written under <dir>/<slug(name)>/, and save resolves true.
  it("should write every file under <dir>/<slug(name)>/ and resolve true", async () => {
    const { written, writeFile } = fakeWrites();
    const writer = createCollectionWriter({
      pickDir: () => Promise.resolve("/tmp/out"),
      writeFile,
    });

    const result = await writer.save(FILES, "My API");

    expect(result).toBe(true);
    expect(written["/tmp/out/my-api/my-api.postman_collection.json"]).toBe(
      '{"info":{}}',
    );
    expect(written["/tmp/out/my-api/dev.postman_environment.json"]).toBe(
      '{"name":"dev"}',
    );
    expect(Object.keys(written)).toHaveLength(2);
  });
});

describe("createNoopCollectionWriter (AC-011)", () => {
  // behavior: the dev-browser no-op writer never writes and always resolves false.
  it("should resolve false without writing", async () => {
    const result = await createNoopCollectionWriter().save(FILES, "My API");

    expect(result).toBe(false);
  });
});
