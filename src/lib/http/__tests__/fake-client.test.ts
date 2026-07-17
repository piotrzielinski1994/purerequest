import { describe, it, expect } from "vitest";

import { createFakeHttpClient } from "@/lib/http/fake-client";
import type { HttpRequest } from "@/lib/http/model";
import { DEMO_RESPONSE } from "@/lib/workspace/demo-seed";
import { emptyAuth } from "@/lib/workspace/model";

const PROBE_REQUEST: HttpRequest = {
  method: "GET",
  url: "https://demo.example/ping",
  headers: [],
  body: null,
  auth: emptyAuth(),
  timeoutMs: 5000,
  httpVersion: "auto",
  requestId: "probe",
};

describe("createFakeHttpClient - cancel", () => {
  // TC-008, AC-007 - side-effect-contract: cancel is a no-op that resolves.
  it("should resolve without throwing if cancel is called", async () => {
    const client = createFakeHttpClient();

    await expect(client.cancel("any-id")).resolves.toBeUndefined();
  });
});

describe("createFakeHttpClient - dev-browser timings", () => {
  // TC-010, AC-011 - side-effect-contract: the dev-browser fake success carries
  // representative timings so the Timing tab is populated without a Tauri host.
  it("should return a success response with four numeric timing phases", async () => {
    const client = createFakeHttpClient({ ok: true, response: DEMO_RESPONSE });

    const result = await client.send(PROBE_REQUEST);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const timings = result.response.timings;
      expect(timings).toBeDefined();
      expect(typeof timings?.dnsMs).toBe("number");
      expect(typeof timings?.connectMs).toBe("number");
      expect(typeof timings?.waitingMs).toBe("number");
      expect(typeof timings?.downloadMs).toBe("number");
    }
  });
});
