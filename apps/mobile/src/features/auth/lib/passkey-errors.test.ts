import { describe, expect, test } from "bun:test";

import { PASSKEY_FAILED_ERROR } from "./auth-errors";
import {
  describePasskeyFailure,
  PASSKEY_NOT_REGISTERED_ERROR,
} from "./passkey-errors";

describe("native passkey failures", () => {
  test("cancelling the system prompt does not show a sign-in error", () => {
    expect(
      describePasskeyFailure({
        code: "AUTH_CANCELLED",
        message: "User cancelled",
      })
    ).toEqual({ cancelled: true });
    expect(describePasskeyFailure({ code: "CANCELLED" })).toEqual({
      cancelled: true,
    });
    expect(
      describePasskeyFailure({
        code: "AUTH_CANCELLED",
        message:
          "Call to function 'BetterAuthReactNativePasskey.authenticatePasskey' has been rejected.\n→ Caused by: User cancelled",
      })
    ).toEqual({ cancelled: true });
  });

  test("missing credentials gives a setup instruction even when the bridge reports AUTH_CANCELLED", () => {
    expect(
      describePasskeyFailure({
        code: "AUTH_CANCELLED",
        message: "No credentials available",
      })
    ).toEqual({ error: PASSKEY_NOT_REGISTERED_ERROR });
    expect(describePasskeyFailure(new Error("No passkeys found"))).toEqual({
      error: PASSKEY_NOT_REGISTERED_ERROR,
    });
  });

  test("verification and device errors remain failures rather than cancellation", () => {
    expect(
      describePasskeyFailure({
        code: "AUTH_CANCELLED",
        message: "Failed to get passkey",
      })
    ).toEqual({ error: PASSKEY_FAILED_ERROR });
    expect(describePasskeyFailure({ code: "CHALLENGE_NOT_FOUND" })).toEqual({
      error: PASSKEY_FAILED_ERROR,
    });
  });
});
