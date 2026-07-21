import { isTauri } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDevBrowser } from "@/lib/runtime/environment";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(),
}));

const mockedIsTauri = vi.mocked(isTauri);

describe("isDevBrowser", () => {
  beforeEach(() => {
    mockedIsTauri.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // AC-004, TC-003 - behavior: the `npm run dev` browser build is the only case.
  it("should return true if MODE is development and there is no Tauri host", () => {
    vi.stubEnv("MODE", "development");
    mockedIsTauri.mockReturnValue(false);

    expect(isDevBrowser()).toBe(true);
  });

  // AC-004, TC-003 - behavior: `npm start` runs Vite dev under a Tauri host.
  it("should return false if MODE is development but a Tauri host is present", () => {
    vi.stubEnv("MODE", "development");
    mockedIsTauri.mockReturnValue(true);

    expect(isDevBrowser()).toBe(false);
  });

  // AC-004, TC-003 - behavior: Vitest reports MODE "test" (DEV is also true here,
  // so gating on MODE not DEV keeps the jsdom suite on the empty state).
  it("should return false if MODE is test regardless of the Tauri host", () => {
    vi.stubEnv("MODE", "test");
    mockedIsTauri.mockReturnValue(false);

    expect(isDevBrowser()).toBe(false);
  });

  // AC-004, TC-003 - behavior: the production build uses real native adapters.
  it("should return false if MODE is production", () => {
    vi.stubEnv("MODE", "production");
    mockedIsTauri.mockReturnValue(false);

    expect(isDevBrowser()).toBe(false);
  });
});
