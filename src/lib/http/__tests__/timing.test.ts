import { describe, it, expect } from "vitest";

import { buildWaterfallRows, type ResponseTimings } from "@/lib/http/timing";

const TIMINGS: ResponseTimings = {
  dnsMs: 12,
  connectMs: 34,
  waitingMs: 88,
  downloadMs: 8,
};

describe("buildWaterfallRows", () => {
  // TC-008, AC-006 - behavior: four rows in fixed order, ms mapped through,
  // percents sum to 100 (rounding residual folded into Waiting).
  it("should return four ordered rows whose percents sum to 100 if given timings and a total", () => {
    const rows = buildWaterfallRows(TIMINGS, 142);

    expect(rows.map((row) => row.label)).toEqual([
      "DNS",
      "Connect",
      "Waiting",
      "Download",
    ]);
    expect(rows.map((row) => row.ms)).toEqual([12, 34, 88, 8]);

    const totalPercent = rows.reduce((sum, row) => sum + row.percent, 0);
    expect(totalPercent).toBe(100);
  });

  // TC-009, AC-007 - behavior: a zero total yields 0% for every row, no NaN.
  it("should return zero percent for every row and no NaN if the total is zero", () => {
    const rows = buildWaterfallRows(TIMINGS, 0);

    for (const row of rows) {
      expect(row.percent).toBe(0);
      expect(Number.isNaN(row.percent)).toBe(false);
    }
  });
});
