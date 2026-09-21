import { describe, expect, test } from "bun:test";

import {
  FORBIDDEN_ERROR,
  GENERIC_AUTH_ERROR,
  INSTALL_TOKEN_ERROR,
  INVALID_CREDENTIALS_ERROR,
  NETWORK_ERROR,
  SOCIAL_UNAVAILABLE_ERROR,
  describeAuthError,
  describeOAuthRedirectError,
  describeSignupError,
  extractRedirectError,
} from "./auth-errors";

describe("describeAuthError", () => {
  test("recognises the install-token gate rejection", () => {
    expect(
      describeAuthError({
        error: "install-token-required",
        status: 403,
        statusText: "Forbidden",
      })
    ).toEqual({ kind: "install-token", message: INSTALL_TOKEN_ERROR });
  });

  test("surfaces rate limits with the retry window", () => {
    expect(
      describeAuthError({ error: "rate-limited", retryAfter: 42, status: 429 })
    ).toEqual({
      kind: "rate-limited",
      message: "Too many attempts, try again in 42s.",
      retryAfterSeconds: 42,
    });
  });

  test("rate limits without a window still read as rate limits", () => {
    const info = describeAuthError({ status: 429, statusText: "Too Many" });
    expect(info.kind).toBe("rate-limited");
    expect(info.retryAfterSeconds).toBeUndefined();
  });

  test("maps the edge guards to one forbidden message", () => {
    for (const error of [
      "origin-not-allowed",
      "internal-secret-required",
      "Forbidden",
    ]) {
      expect(describeAuthError({ error, status: 403 })).toEqual({
        detail: error,
        kind: "forbidden",
        message: FORBIDDEN_ERROR,
      });
    }
  });

  test("uses the web copy for bad credentials", () => {
    expect(
      describeAuthError({
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
        status: 401,
      })
    ).toEqual({ kind: "credentials", message: INVALID_CREDENTIALS_ERROR });
    expect(
      describeAuthError({ code: "INVALID_USERNAME_OR_PASSWORD", status: 401 })
        .kind
    ).toBe("credentials");
  });

  test("maps known better-auth codes to human copy", () => {
    expect(
      describeAuthError({
        code: "PROVIDER_NOT_FOUND",
        message: "Provider not found",
      })
    ).toEqual({
      detail: "PROVIDER_NOT_FOUND: Provider not found",
      kind: "unknown",
      message: SOCIAL_UNAVAILABLE_ERROR,
    });
    expect(describeAuthError({ code: "EMAIL_NOT_VERIFIED" }).message).toBe(
      "Verify your email first, check your inbox."
    );
    expect(describeAuthError({ code: "USER_NOT_FOUND" }).kind).toBe(
      "credentials"
    );
  });

  test("never shows a raw server sentence; it goes to detail", () => {
    const info = describeAuthError({
      code: "SOMETHING_NEW",
      message: "Internal adapter exploded",
    });
    expect(info.message).toBe(GENERIC_AUTH_ERROR);
    expect(info.detail).toBe("SOMETHING_NEW: Internal adapter exploded");
    expect(describeAuthError({ message: "Invalid token" }).message).toBe(
      GENERIC_AUTH_ERROR
    );
  });

  test("treats fetch failures as network problems", () => {
    expect(describeAuthError(new TypeError("Network request failed"))).toEqual({
      kind: "network",
      message: NETWORK_ERROR,
    });
    expect(describeAuthError({ message: "Failed to fetch" }).kind).toBe(
      "network"
    );
  });

  test("falls back for empty or unknown shapes", () => {
    expect(describeAuthError(null).message).toBe(GENERIC_AUTH_ERROR);
    expect(describeAuthError({}).message).toBe(GENERIC_AUTH_ERROR);
    expect(describeAuthError(undefined, "custom").message).toBe("custom");
  });
});

describe("extractRedirectError", () => {
  test("reads the code off a release-scheme deep link", () => {
    expect(extractRedirectError("asocialmedia:///login?error=oauthError")).toBe(
      "oauthError"
    );
  });

  test("reads the code off an Expo Go deep link", () => {
    expect(
      extractRedirectError(
        "exp://10.0.0.5:8082/--/login?foo=1&error=state_mismatch#x"
      )
    ).toBe("state_mismatch");
  });

  test("decodes percent-encoding", () => {
    expect(extractRedirectError("asocialmedia:///?error=access%5Fdenied")).toBe(
      "access_denied"
    );
  });

  test("returns null without an error param", () => {
    expect(extractRedirectError("asocialmedia:///?cookie=abc")).toBeNull();
    expect(extractRedirectError(null)).toBeNull();
    expect(extractRedirectError("asocialmedia:///?error=")).toBeNull();
  });
});

describe("describeSignupError", () => {
  test("maps the web signup route codes", () => {
    expect(describeSignupError("user-exists", "x")).toBe(
      "That email or username is already taken."
    );
    expect(describeSignupError("invalid-otp", "x")).toContain("expired");
    expect(describeSignupError("network-error", "x")).toBe(NETWORK_ERROR);
  });

  test("passes through sentences written for people", () => {
    expect(
      describeSignupError(
        "Account creation is temporarily unavailable. Please try again later.",
        "x"
      )
    ).toBe(
      "Account creation is temporarily unavailable. Please try again later."
    );
  });

  test("hides unknown codes behind the fallback", () => {
    expect(describeSignupError("weird-new-code", "Try again?")).toBe(
      "Try again?"
    );
    expect(describeSignupError(undefined, "Try again?")).toBe("Try again?");
  });
});

describe("describeOAuthRedirectError", () => {
  test("mirrors the web error page copy", () => {
    expect(describeOAuthRedirectError("oauthError")).toBe(
      "Error connecting with social provider."
    );
    expect(describeOAuthRedirectError("emailExists")).toBe(
      "This email is already registered."
    );
  });

  test("defaults unknown provider codes to the generic social error", () => {
    expect(describeOAuthRedirectError("something_new")).toBe(
      "Error connecting with social provider."
    );
  });

  test("is silent without a code", () => {
    expect(describeOAuthRedirectError(null)).toBeNull();
    expect(describeOAuthRedirectError("")).toBeNull();
  });
});
