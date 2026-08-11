import { describe, expect, test } from "bun:test";
import { extractTokenFromUrl } from "./config";

describe("extractTokenFromUrl", () => {
  test("extracts token from better-auth reset url with callbackURL", () => {
    const url =
      "https://auth.localhost/reset-password/abc123def456?callbackURL=";
    expect(extractTokenFromUrl(url)).toBe("abc123def456");
  });

  test("extracts token from query param style url", () => {
    const url = "https://social.localhost/reset-password/confirm?token=tok123";
    expect(extractTokenFromUrl(url)).toBe("tok123");
  });

  test("extracts token from bare path", () => {
    expect(
      extractTokenFromUrl("https://auth.localhost/reset-password/mytoken")
    ).toBe("mytoken");
  });

  test("handles malformed url gracefully", () => {
    expect(extractTokenFromUrl("not-a-url")).toBe("not-a-url");
  });

  test("prefers query token over path token", () => {
    const url = "https://social.localhost/verify-email?token=querytok";
    expect(extractTokenFromUrl(url)).toBe("querytok");
  });
});
