import { describe, expect, it } from "vitest";

import { consoleLineLevel } from "@/components/workspace/console-line";

describe("consoleLineLevel", () => {
  it("should classify a script error line as error", () => {
    expect(
      consoleLineLevel("[pre] error: ReferenceError: 'csd' is not defined"),
    ).toBe("error");
    expect(consoleLineLevel("[post] error: boom")).toBe("error");
  });

  it("should classify a console.error script line as error", () => {
    expect(consoleLineLevel("[pre] error: something bad")).toBe("error");
  });

  it("should classify a console.warn script line as warn", () => {
    expect(consoleLineLevel("[post] warn: deprecated")).toBe("warn");
  });

  it("should classify a plain script log line as log", () => {
    expect(consoleLineLevel("[pre] Hello World")).toBe("log");
    expect(consoleLineLevel('[post] {"id":7}')).toBe("log");
  });

  it("should classify a failed workspace persist line as error", () => {
    expect(
      consoleLineLevel("[workspace] failed to persist script: disk full"),
    ).toBe("error");
  });

  it("should classify a non-failure workspace line as muted", () => {
    expect(
      consoleLineLevel('[workspace] Set "workspacePath" in settings.json'),
    ).toBe("muted");
    expect(
      consoleLineLevel("[workspace] skipped malformed file: a.req.json"),
    ).toBe("muted");
  });

  it("should classify an unprefixed line as log", () => {
    expect(consoleLineLevel("just some text")).toBe("log");
  });
});
