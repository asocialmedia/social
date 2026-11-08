import { describe, expect, test } from "bun:test";

import { authDeepLinkPath } from "./auth-deep-link";
import {
  VERIFY_EMAIL_FALLBACK_ERROR,
  isVerifyEmailSuccess,
  resolveVerifyEmailState,
} from "./email-verification";

describe("resolveVerifyEmailState", () => {
  test("a token starts verification", () => {
    expect(resolveVerifyEmailState({ token: " abc " })).toEqual({
      kind: "verify",
      token: "abc",
    });
  });

  test("a known error code maps to the web copy", () => {
    expect(
      resolveVerifyEmailState({ error: "token-expired", token: "abc" })
    ).toEqual({
      kind: "error",
      message: "The verification link has expired.",
    });
  });

  test("an unknown error code and a bare link use the fallback", () => {
    expect(resolveVerifyEmailState({ error: "weird" })).toEqual({
      kind: "error",
      message: VERIFY_EMAIL_FALLBACK_ERROR,
    });
    expect(resolveVerifyEmailState({})).toEqual({
      kind: "error",
      message: VERIFY_EMAIL_FALLBACK_ERROR,
    });
  });

  test("verified wins over everything and arrays use the first value", () => {
    expect(resolveVerifyEmailState({ error: "x", verified: ["1"] })).toEqual({
      kind: "verified",
    });
    expect(resolveVerifyEmailState({ token: ["t1", "t2"] })).toEqual({
      kind: "verify",
      token: "t1",
    });
  });
});

describe("isVerifyEmailSuccess", () => {
  test("the body ok flag decides when present", () => {
    expect(isVerifyEmailSuccess(true, { ok: false })).toBe(false);
    expect(isVerifyEmailSuccess(false, { ok: true })).toBe(true);
  });

  test("falls back to the HTTP status without a body", () => {
    expect(isVerifyEmailSuccess(true, null)).toBe(true);
    expect(isVerifyEmailSuccess(false, "nope")).toBe(false);
  });
});

describe("authDeepLinkPath", () => {
  test("maps emailed verification links with their query", () => {
    expect(
      authDeepLinkPath("https://asocialmedia.cc/verify-email?token=a%2Bb&x=1")
    ).toBe("/verify-email?token=a%2Bb");
    expect(authDeepLinkPath("/verify-email?error=token-expired")).toBe(
      "/verify-email?error=token-expired"
    );
  });

  test("maps the web reset confirm page to the native screen", () => {
    expect(
      authDeepLinkPath(
        "https://www.asocialmedia.cc/reset-password/confirm/?token=t"
      )
    ).toBe("/confirm-reset?token=t");
    expect(authDeepLinkPath("asocialmedia://reset-password")).toBe(
      "/reset-password"
    );
  });

  test("ignores other hosts, other paths and unsafe input", () => {
    expect(authDeepLinkPath("https://evil.example/verify-email?token=t")).toBe(
      null
    );
    expect(authDeepLinkPath("/posts/1")).toBe(null);
    expect(authDeepLinkPath("//evil.example/verify-email")).toBe(null);
    expect(authDeepLinkPath("/verify-email\\x")).toBe(null);
  });
});
