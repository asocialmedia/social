import { describe, expect, test } from "bun:test";

import { authDeepLinkPath } from "./auth-deep-link";

describe("authDeepLinkPath", () => {
  test("passes verify and reset links through with their params", () => {
    expect(authDeepLinkPath("asocialmedia://verify-email?token=abc")).toBe(
      "/verify-email?token=abc"
    );
    expect(
      authDeepLinkPath("https://asocialmedia.cc/reset-password/confirm?token=x")
    ).toBe("/confirm-reset?token=x");
    expect(authDeepLinkPath("asocialmedia://signup")).toBe("/signup");
  });

  test("routes login errors to the login-error screen with code and email", () => {
    expect(
      authDeepLinkPath(
        "asocialmedia://login/error?error=account_not_linked&email=a@b.c"
      )
    ).toBe("/login-error?error=account_not_linked&email=a%40b.c");
  });

  test("falls back to the login challenge for the standalone 2FA page", () => {
    expect(authDeepLinkPath("https://asocialmedia.cc/two-factor")).toBe(
      "/login"
    );
  });

  test("rejects non-auth links and control characters", () => {
    expect(authDeepLinkPath("asocialmedia://posts/abc")).toBeNull();
    expect(authDeepLinkPath("asocialmedia://login/error\n?error=x")).toBeNull();
    expect(
      authDeepLinkPath("https://evil.example/login/error?error=x")
    ).toBeNull();
  });
});
