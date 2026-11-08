import { expect, test } from "bun:test";

import { auditCountryHeaders, parseAuditCountry } from "./site-audit-headers";

test("country simulation augments only the audited origin without mutating its headers", () => {
  const headers = { accept: "text/html" };
  expect(
    auditCountryHeaders(
      "http://localhost:4001/",
      "http://localhost:4001",
      headers,
      "IN"
    )
  ).toEqual({ accept: "text/html", "cf-ipcountry": "IN" });
  expect(headers).toEqual({ accept: "text/html" });
});

test("third-party and different-port requests retain their own headers", () => {
  const headers = { accept: "image/*" };
  for (const url of [
    "https://cdn.bsky.app/image",
    "http://localhost:3001/api/health",
    "data:image/png;base64,AA",
  ]) {
    expect(
      auditCountryHeaders(url, "http://localhost:4001", headers, "IN")
    ).toBe(headers);
  }
});

test("an unspecified country preserves direct-origin behavior", () => {
  const headers = { accept: "text/html" };
  expect(
    auditCountryHeaders(
      "http://localhost:4001/",
      "http://localhost:4001",
      headers
    )
  ).toBe(headers);
});

test("country input normalizes case and permits omission", () => {
  expect(parseAuditCountry("in")).toBe("IN");
  expect(parseAuditCountry()).toBeUndefined();
});

test("malformed country values cannot become request headers", () => {
  expect(() => parseAuditCountry("India")).toThrow("two-letter country code");
  expect(() => parseAuditCountry("IN\r\nX-Test: injected")).toThrow(
    "two-letter country code"
  );
});
