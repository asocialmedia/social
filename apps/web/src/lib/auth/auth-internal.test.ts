import { describe, expect, test } from "bun:test";

import {
  authInternalHeaders,
  authSessionHeaders,
  resolveAuthBaseUrl,
} from "./auth-internal";

describe("resolveAuthBaseUrl", () => {
  test("server uses the internal URL when configured", () => {
    expect(
      resolveAuthBaseUrl(
        "http://zephverse-zephauth-uoiank:3001",
        "https://auth.asocialmedia.cc",
        false
      )
    ).toBe("http://zephverse-zephauth-uoiank:3001");
  });

  test("server falls back to the public URL when internal is unset", () => {
    expect(
      resolveAuthBaseUrl(undefined, "https://auth.asocialmedia.cc", false)
    ).toBe("https://auth.asocialmedia.cc");
  });

  test("browser always uses the public URL", () => {
    expect(
      resolveAuthBaseUrl(
        "http://zephverse-zephauth-uoiank:3001",
        "https://auth.asocialmedia.cc",
        true
      )
    ).toBe("https://auth.asocialmedia.cc");
  });
});

describe("authInternalHeaders", () => {
  test("includes origin and referer headers by default", () => {
    const headers = authInternalHeaders({ "content-type": "application/json" });
    expect(headers.origin).toBeDefined();
    expect(headers.referer).toBeDefined();
    expect(headers["content-type"]).toBe("application/json");
  });

  test("preserves caller-provided origin and referer alongside content-type", () => {
    const headers = authInternalHeaders({
      "content-type": "application/json",
      origin: "https://custom.asocialmedia.cc",
      referer: "https://custom.asocialmedia.cc/ref",
    });
    expect(headers.origin).toBe("https://custom.asocialmedia.cc");
    expect(headers.referer).toBe("https://custom.asocialmedia.cc/ref");
    expect(headers["content-type"]).toBe("application/json");
  });
});

test("session calls retain trusted ingress without accepting production forwarded-IP spoofing", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.8",
    "x-forwarded-for": "198.51.100.2",
  });
  expect(authSessionHeaders(headers, {}, true)["cf-connecting-ip"]).toBe(
    "203.0.113.8"
  );
  expect(
    authSessionHeaders(
      new Headers({ "x-forwarded-for": "198.51.100.2" }),
      {},
      true
    )["cf-connecting-ip"]
  ).toBeUndefined();
  expect(
    authSessionHeaders(
      new Headers({ "x-forwarded-for": "198.18.0.2" }),
      {},
      false
    )["x-forwarded-for"]
  ).toBe("198.18.0.2");
});
