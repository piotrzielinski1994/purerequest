import type { ResponseTimings } from "@/lib/workspace/model";

export type { ResponseTimings };

export type WaterfallRow = { label: string; ms: number; percent: number };

const PHASES: readonly { label: string; key: keyof ResponseTimings }[] = [
  { label: "DNS", key: "dnsMs" },
  { label: "Connect", key: "connectMs" },
  { label: "Waiting", key: "waitingMs" },
  { label: "Download", key: "downloadMs" },
];

const RESIDUAL_ROW_LABEL = "Waiting";

// Turn phase durations into proportional rows for the waterfall. Percentages are
// rounded for display and the rounding residual is folded into the Waiting row so
// the four percentages sum to exactly 100 (a zero total yields all-zero percents).
export function buildWaterfallRows(
  timings: ResponseTimings,
  totalMs: number,
): WaterfallRow[] {
  const rows = PHASES.map((phase) => {
    const ms = timings[phase.key];
    return {
      label: phase.label,
      ms,
      percent: totalMs > 0 ? Math.round((ms / totalMs) * 100) : 0,
    };
  });

  if (totalMs <= 0) {
    return rows;
  }

  const residual = 100 - rows.reduce((sum, row) => sum + row.percent, 0);
  return rows.map((row) =>
    row.label === RESIDUAL_ROW_LABEL
      ? { ...row, percent: row.percent + residual }
      : row,
  );
}
