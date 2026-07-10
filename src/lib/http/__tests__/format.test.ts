import { describe, it, expect } from "vitest";

import {
  formatBytes,
  formatDuration,
  RESPONSE_RENDER_LIMIT_BYTES,
} from "@/lib/http/format";

describe("formatBytes", () => {
  // TC-001, AC-004 - behavior: small sizes render as bytes (no space before the unit).
  it("should render bytes with a B suffix if under one kilobyte", () => {
    expect(formatBytes(512)).toBe("512B");
  });

  // TC-001, AC-004 - behavior: the 1024 boundary crosses into KB.
  it("should render 1024 bytes as 1.0KB if at the kilobyte boundary", () => {
    expect(formatBytes(1024)).toBe("1.0KB");
  });

  // TC-001, AC-004 - behavior: kilobytes render with a KB suffix.
  it("should render 2048 bytes as 2.0KB if in the kilobyte range", () => {
    expect(formatBytes(2048)).toBe("2.0KB");
  });

  // TC-001, AC-004 - behavior: megabytes render with an MB suffix.
  it("should render 2097152 bytes as 2.0MB if in the megabyte range", () => {
    expect(formatBytes(2_097_152)).toBe("2.0MB");
  });
});

describe("formatDuration", () => {
  // TC-001, AC-004 - behavior: sub-second durations render as milliseconds.
  it("should render 142 as 142ms if under one second", () => {
    expect(formatDuration(142)).toBe("142ms");
  });

  // TC-001, AC-004 - behavior: durations at/over a second render as seconds.
  it("should render 1523 as 1.52s if at least one second", () => {
    expect(formatDuration(1523)).toBe("1.52s");
  });
});

describe("RESPONSE_RENDER_LIMIT_BYTES", () => {
  // AC-005 - behavior: the render guard threshold is ~2 MB.
  it("should expose a render threshold of two mebibytes", () => {
    expect(RESPONSE_RENDER_LIMIT_BYTES).toBe(2 * 1024 * 1024);
  });
});
