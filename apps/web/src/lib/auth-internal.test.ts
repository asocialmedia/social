import { describe, expect, test } from "bun:test";

import { resolveAuthBaseUrl } from "./auth-internal";

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
