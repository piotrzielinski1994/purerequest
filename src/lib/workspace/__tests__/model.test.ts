import { describe, expect, it } from "vitest";
import type { KeyValue } from "@/lib/workspace/model";
import { upsertRow } from "@/lib/workspace/model";

describe("upsertRow", () => {
  // behavior: appends a new row when the key is absent.
  it("should append a new row if the key is not present", () => {
    const rows: KeyValue[] = [{ key: "a", value: "1" }];

    expect(upsertRow(rows, "b", "2")).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ]);
  });

  // behavior: overwrites the matching row's value when the key exists.
  it("should overwrite the value if the key is already present", () => {
    const rows: KeyValue[] = [
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ];

    expect(upsertRow(rows, "b", "9")).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "9" },
    ]);
  });

  // behavior: preserves other fields (enabled) on the updated row.
  it("should preserve the enabled flag when overwriting a row", () => {
    const rows: KeyValue[] = [{ key: "a", value: "1", enabled: false }];

    expect(upsertRow(rows, "a", "2")).toEqual([
      { key: "a", value: "2", enabled: false },
    ]);
  });

  // behavior: appends into an empty list.
  it("should append into an empty list", () => {
    expect(upsertRow([], "a", "1")).toEqual([{ key: "a", value: "1" }]);
  });

  // side-effect-contract: the input rows array is not mutated.
  it("should not mutate the input rows", () => {
    const rows: KeyValue[] = [{ key: "a", value: "1" }];

    upsertRow(rows, "a", "2");

    expect(rows).toEqual([{ key: "a", value: "1" }]);
  });
});
