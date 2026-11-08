import { describe, expect, test } from "bun:test";

import {
  FORBIDDEN_ERROR,
  GENERIC_AUTH_ERROR,
  INSTALL_TOKEN_ERROR,
  INVALID_CREDENTIALS_ERROR,
  NETWORK_ERROR,
  SOCIAL_UNAVAILABLE_ERROR,
  describeAuthError,
  describeLoginError,
  describeOAuthRedirectError,
  describeSignupError,
  extractRedirectError,
  isAuthCallbackUrl,
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

describe("isAuthCallbackUrl", () => {
  test("accepts the login and root callbacks", () => {
    expect(isAuthCallbackUrl("asocialmedia:///login?error=oauthError")).toBe(
      true
    );
    expect(isAuthCallbackUrl("asocialmedia:///?error=access_denied")).toBe(
      true
    );
  });

  test("accepts wrapped Expo Go callbacks", () => {
    expect(
      isAuthCallbackUrl("exp://10.0.0.5:8082/--/login?error=state_mismatch")
    ).toBe(true);
  });

  test("rejects other links arriving mid-flow", () => {
    expect(
      isAuthCallbackUrl("asocialmedia:///verify-email?error=expired")
    ).toBe(false);
    expect(isAuthCallbackUrl("asocialmedia:///posts/abc?comment=x")).toBe(
      false
    );
    // An https universal link to the same callback path still counts: it is
    // the provider's answer, just delivered by the OS instead of the scheme.
    expect(isAuthCallbackUrl("https://asocialmedia.cc/login?error=x")).toBe(
      true
    );
    expect(isAuthCallbackUrl(null)).toBe(false);
  });
});

describe("describeLoginError", () => {
  test("names the fix for account collisions", () => {
    expect(describeLoginError("account_not_linked")).toContain(
      "connect this provider in Settings"
    );
    expect(describeLoginError("USERNAME_IS_ALREADY_TAKEN")).toContain(
      "connect this provider in Settings"
    );
  });

  test("covers every web login/error code", () => {
    expect(describeLoginError("accountNotFound")).toBe("Account not found.");
    expect(describeLoginError("emailExists")).toBe(
      "This email is already registered."
    );
    expect(describeLoginError("invalidCredentials")).toBe(
      "Invalid email or password."
    );
    expect(describeLoginError("oauthError")).toBe(
      "Error connecting with social provider."
    );
    expect(describeLoginError("oauth_email_not_verified")).toBe(
      "Verify your Google email before using it to sign in."
    );
    expect(describeLoginError("serverError")).toBe(
      "An unexpected error occurred."
    );
    expect(describeLoginError("unauthorized")).toBe(
      "You must be logged in to access this page."
    );
  });

  test("falls back with and without a code", () => {
    expect(describeLoginError("something_new")).toBe(
      "Couldn't complete sign-in. Please try again."
    );
    expect(describeLoginError(null)).toBe("An error occurred");
    const missing: string | undefined = undefined;
    expect(describeLoginError(missing)).toBe("An error occurred");
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
