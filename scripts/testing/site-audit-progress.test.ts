import { expect, test } from "bun:test";

import { routeAuditComplete } from "./site-audit-progress";

test("resume retries a failed mobile audit even when desktop finished", () => {
  expect(
    routeAuditComplete(
      [
        { route: "/login", formFactor: "mobile", state: "lighthouse-error" },
        { route: "/login", formFactor: "desktop", state: "audited" },
      ],
      "/login"
    )
  ).toBe(false);
});

test("both completed device audits or an explicit HTTP redirect complete a route", () => {
  expect(
    routeAuditComplete(
      [
        { route: "/about", formFactor: "mobile", state: "audited" },
        { route: "/about", formFactor: "desktop", state: "audited" },
      ],
      "/about"
    )
  ).toBe(true);
  expect(
    routeAuditComplete([{ route: "/alias", state: "redirect" }], "/alias")
  ).toBe(true);
});

test("HTTP failures and results for other routes do not suppress retries", () => {
  expect(
    routeAuditComplete([{ route: "/about", state: "http-error" }], "/about")
  ).toBe(false);
  expect(
    routeAuditComplete([{ route: "/other", state: "http-checked" }], "/about")
  ).toBe(false);
});
