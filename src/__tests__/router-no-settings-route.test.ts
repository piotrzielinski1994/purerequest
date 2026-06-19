import { describe, it, expect } from "vitest";

import { router } from "@/router";

describe("app router structure", () => {
  // AC-005 — behavior: settings is no longer a route, so there is no path to navigate to.
  it("should not register a /settings route", () => {
    expect(Object.keys(router.routesByPath)).not.toContain("/settings");
    expect(Object.keys(router.routesById)).not.toContain("/settings");
  });

  // AC-005 — behavior: the only navigable child route is the home route.
  it("should expose only the home route as a navigable path", () => {
    expect(Object.keys(router.routesByPath)).toEqual(["/"]);
  });
});
