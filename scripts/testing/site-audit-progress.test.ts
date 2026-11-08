import { expect, test } from "bun:test";

import { routeAuditComplete, withAuditDeadline } from "./site-audit-progress";

test("a stalled device measurement rejects instead of blocking route coverage forever", async () => {
  await expect(
    withAuditDeadline(Promise.withResolvers<never>().promise, 10)
  ).rejects.toThrow("Lighthouse exceeded its 10 ms deadline");
});

test("a completed measurement retains its result and clears its deadline", async () => {
  expect(await withAuditDeadline(Promise.resolve("report"), 100)).toBe(
    "report"
  );
});

test("a failed measurement preserves the original failure", async () => {
  const failure = new Error("Browser disconnected");
  await expect(withAuditDeadline(Promise.reject(failure), 100)).rejects.toBe(
    failure
  );
});

test("resume retries a failed mobile audit even when desktop finished", () => {
  expect(
    routeAuditComplete(
      [
        { formFactor: "mobile", route: "/login", state: "lighthouse-error" },
        { formFactor: "desktop", route: "/login", state: "audited" },
      ],
      "/login"
    )
  ).toBe(false);
});

test("both completed device audits or an explicit HTTP redirect complete a route", () => {
  expect(
    routeAuditComplete(
      [
        { formFactor: "mobile", route: "/about", state: "audited" },
        { formFactor: "desktop", route: "/about", state: "audited" },
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
