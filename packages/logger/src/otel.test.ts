import { describe, expect, test } from "bun:test";

import { shouldDropSpan } from "./otel";

// Minimal ReadableSpan shape: only the fields the filter reads.
function span(name: string, attributes: Record<string, unknown> = {}) {
  return { attributes, name } as unknown as Parameters<
    typeof shouldDropSpan
  >[0];
}

describe("shouldDropSpan", () => {
  test("drops the container health probe by route attribute", () => {
    expect(
      shouldDropSpan(span("GET /api/health", { "http.route": "/api/health" }), [
        "/api/health",
      ])
    ).toBe(true);
  });

  test("drops the health probe by span name alone", () => {
    expect(shouldDropSpan(span("GET /api/health"), ["/api/health"])).toBe(true);
  });

  test("matches Next.js route attribute names", () => {
    expect(
      shouldDropSpan(
        span("executing api route (app) /api/health", {
          "next.route": "/api/health",
        }),
        ["/api/health"]
      )
    ).toBe(true);
  });

  test("keeps real request spans", () => {
    expect(
      shouldDropSpan(span("GET /", { "http.route": "/", "http.target": "/" }), [
        "/api/health",
      ])
    ).toBe(false);
  });

  test("keeps everything when no patterns are configured", () => {
    expect(
      shouldDropSpan(
        span("GET /api/health", { "http.route": "/api/health" }),
        []
      )
    ).toBe(false);
  });

  test("is case-insensitive", () => {
    expect(
      shouldDropSpan(span("GET /API/HEALTH", { "http.route": "/API/HEALTH" }), [
        "/api/health",
      ])
    ).toBe(true);
  });
});
