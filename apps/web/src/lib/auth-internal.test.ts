import { describe, expect, test } from "bun:test";

import { authInternalHeaders, resolveAuthBaseUrl } from "./auth-internal";

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
